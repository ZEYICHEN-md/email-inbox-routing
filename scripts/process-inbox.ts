/**
 * L2/L3: batch-process Contact Us emails dropped into inbox/.
 *
 * Drop .eml or .txt files into inbox/ (or a subfolder). This script classifies
 * each file, writes a sidecar .routing.json, appends audit log, and moves the
 * source file to inbox/processed/.
 *
 * Usage:
 *   npm run process:inbox              # process all pending once
 *   npm run process:inbox -- --watch   # poll inbox/ every 5s
 *   npm run process:inbox -- --dry-run # classify only, do not move files
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, resolve } from "node:path";
import { classifyAndRoute } from "../src/manualRouting/index.js";
import { AuditLog, buildAuditEntry, FileAuditLogStore, FileErrorChannel } from "../src/auditLog/index.js";
import { parsedEmlToRaw, parseEml } from "../src/eml/parseEml.js";
import { NotificationFilter } from "../src/notificationFilter/index.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../src/pipeline/index.js";
import type { ForwardedEmail, RoutingOutcome } from "../src/types/index.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INBOX_DIR = join(PROJECT_ROOT, "inbox");
const PROCESSED_DIR = join(INBOX_DIR, "processed");
const AUDIT_PATH = join(PROJECT_ROOT, "data", "audit-log.jsonl");
const ERROR_PATH = join(PROJECT_ROOT, "data", "audit-errors.jsonl");

function usage(): never {
  console.error(`Usage:
  npm run process:inbox [-- --watch] [-- --dry-run] [-- --threshold 0.5]

Options:
  --watch       Poll inbox/ every 5 seconds
  --dry-run     Classify but do not move files or write sidecars
  --threshold   Confidence threshold (default 0.5)
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let watch = false;
  let dryRun = false;
  let threshold = DEFAULT_CONFIDENCE_THRESHOLD;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--watch") watch = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--threshold") threshold = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") usage();
  }

  return { watch, dryRun, threshold };
}

function ensureDirs(): void {
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(PROCESSED_DIR, { recursive: true });
  mkdirSync(dirname(AUDIT_PATH), { recursive: true });
}

function listPendingFiles(): string[] {
  if (!existsSync(INBOX_DIR)) return [];
  return readdirSync(INBOX_DIR)
    .filter((name) => {
      const full = join(INBOX_DIR, name);
      if (!statSync(full).isFile()) return false;
      const ext = extname(name).toLowerCase();
      return ext === ".eml" || ext === ".txt";
    })
    .map((name) => join(INBOX_DIR, name))
    .sort();
}

function readInboxFile(path: string): { body: string; from: string | null; subject: string | null } {
  const raw = readFileSync(path, "utf8");
  const ext = extname(path).toLowerCase();
  if (ext === ".eml") {
    const parsed = parseEml(raw);
    return { body: parsed.body, from: parsed.from, subject: parsed.subject };
  }
  return { body: raw, from: null, subject: null };
}

function routingOutcomeFromAction(
  result: Awaited<ReturnType<typeof classifyAndRoute>>,
): RoutingOutcome {
  const r = result.routing;
  if (r.action === "FORWARD") {
    const all = [...(r.to ?? []), ...(r.cc ?? [])];
    return { kind: "Forwarded", recipients: all, forwardedAt: Date.now() };
  }
  if (r.action === "NO_FORWARD") {
    return r.guidanceNote
      ? { kind: "NoForwardResolved", guidanceNote: r.guidanceNote }
      : { kind: "NoForwardResolved" };
  }
  return { kind: "SentToReview" };
}

function toAuditEmail(
  result: Awaited<ReturnType<typeof classifyAndRoute>>,
  sourceName: string,
  from: string | null,
  subject: string | null,
): ForwardedEmail {
  return {
    messageId: `inbox:${sourceName}`,
    relayEnvelopeSender: from ?? "manual-inbox",
    submitterEmail: result.submitterEmail,
    subject: subject ?? "manual-inbox",
    body: result.formMessageContent,
    formMessageContent: result.formMessageContent,
    attachments: [],
    receivedAt: Date.now(),
  };
}

async function processFile(
  path: string,
  opts: { dryRun: boolean; threshold: number },
  audit: AuditLog,
): Promise<void> {
  const name = basename(path);
  console.log(`\n--- ${name} ---`);

  const { body, from, subject } = readInboxFile(path);

  if (extname(path).toLowerCase() === ".eml") {
    const filter = new NotificationFilter();
    const raw = parsedEmlToRaw(parseEml(readFileSync(path, "utf8")), `inbox:${name}`);
    const admission = filter.admit(raw);
    if (admission.kind === "Ignored") {
      console.log("Skipped: not a Contact Us notification (from/subject mismatch)");
      if (!opts.dryRun) {
        const skippedDir = join(INBOX_DIR, "skipped");
        mkdirSync(skippedDir, { recursive: true });
        renameSync(path, join(skippedDir, name));
      }
      return;
    }
    if (admission.kind === "SkippedUnreadable") {
      console.log(`Skipped: unreadable headers — ${admission.reason}`);
      return;
    }
  }

  const result = await classifyAndRoute(body, {
    threshold: opts.threshold,
    mode: "notification-body",
    messageId: `inbox:${name}`,
  });

  console.log(`Submitter: ${result.submitterEmail}`);
  console.log(`Decision:  ${result.decision.kind}`);
  console.log(`Action:    ${result.routing.action}`);
  if (result.routing.action === "FORWARD") {
    console.log(`To:        ${(result.routing.to ?? []).join(", ")}`);
    if (result.routing.cc?.length) {
      console.log(`CC:        ${result.routing.cc.join(", ")}`);
    }
  } else if (result.routing.guidanceNote) {
    console.log(`Guidance:  ${result.routing.guidanceNote}`);
  } else if (result.routing.reason) {
    console.log(`Reason:    ${result.routing.reason}`);
  }

  const sidecar = {
    source: name,
    processedAt: new Date().toISOString(),
    ...result,
    routing: {
      ...result.routing,
      outlookTo:
        result.routing.to && result.routing.to.length > 0
          ? result.routing.to.join("; ")
          : "",
      outlookCc:
        result.routing.cc && result.routing.cc.length > 0
          ? result.routing.cc.join("; ")
          : "",
    },
  };

  if (!opts.dryRun) {
    const sidecarPath = join(INBOX_DIR, `${name}.routing.json`);
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf8");

    const auditEntry = buildAuditEntry({
      email: toAuditEmail(result, name, from, subject),
      classification: {
        candidates: result.candidates,
        failed: result.classificationFailed,
        failureReason: result.error,
      },
      decision: result.decision,
      outcome: routingOutcomeFromAction(result),
      decidedAt: Date.now(),
    });
    audit.write(auditEntry);

    renameSync(path, join(PROCESSED_DIR, name));
    renameSync(sidecarPath, join(PROCESSED_DIR, `${name}.routing.json`));
    console.log(`Moved to inbox/processed/${name}`);
  }
}

async function runBatch(opts: { dryRun: boolean; threshold: number }): Promise<number> {
  const audit = new AuditLog(new FileAuditLogStore(AUDIT_PATH), new FileErrorChannel(ERROR_PATH));
  const pending = listPendingFiles();
  if (pending.length === 0) {
    console.log("No pending files in inbox/");
    return 0;
  }
  console.log(`Processing ${pending.length} file(s)…`);
  for (const file of pending) {
    await processFile(file, opts, audit);
  }
  return pending.length;
}

const opts = parseArgs(process.argv.slice(2));
ensureDirs();

if (opts.watch) {
  console.log(`Watching ${INBOX_DIR} (poll every 5s). Ctrl+C to stop.`);
  const tick = async () => {
    await runBatch(opts);
  };
  await tick();
  setInterval(() => {
    void tick();
  }, 5000);
} else {
  await runBatch(opts);
}
