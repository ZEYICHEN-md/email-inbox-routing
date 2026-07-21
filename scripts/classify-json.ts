/**
 * JSON-output classify CLI for Outlook VBA and automation.
 *
 * Usage:
 *   npm run classify:json -- --body-file path/to/body.txt --out result.json
 *   npm run classify:json -- --text "form message content"
 *
 * Writes machine-readable routing targets (To/CC/action) for semi-automatic forward.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  classifyAndRoute,
  formatOutlookRecipients,
  type ClassifyRouteResult,
} from "../src/manualRouting/index.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../src/pipeline/index.js";

function usage(): never {
  console.error(`Usage:
  npm run classify:json -- --body-file <full-notification-body.txt> [--out <path.json>]
  npm run classify:json -- --text "<form message>"
  npm run classify:json -- --file <form-content.txt> [--out <path.json>]

Options:
  --threshold <0-1>   Confidence threshold (default 0.5)
  --out <path>        Write JSON result to file (default: stdout only)
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let text: string | undefined;
  let file: string | undefined;
  let bodyFile: string | undefined;
  let out: string | undefined;
  let threshold = DEFAULT_CONFIDENCE_THRESHOLD;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--text") text = argv[++i];
    else if (arg === "--file") file = argv[++i];
    else if (arg === "--body-file") bodyFile = argv[++i];
    else if (arg === "--out") out = argv[++i];
    else if (arg === "--threshold") threshold = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") usage();
  }

  if (text === undefined && file === undefined && bodyFile === undefined) usage();
  return { text, file, bodyFile, out, threshold };
}

function readBody(opts: ReturnType<typeof parseArgs>): { body: string; mode: "notification-body" | "form-content" } {
  if (opts.text !== undefined) return { body: opts.text, mode: "form-content" };
  if (opts.file !== undefined) return { body: readFileSync(resolve(opts.file), "utf8"), mode: "form-content" };
  if (opts.bodyFile !== undefined) {
    return { body: readFileSync(resolve(opts.bodyFile), "utf8"), mode: "notification-body" };
  }
  usage();
}

function serializeDecision(result: ClassifyRouteResult) {
  const d = result.decision;
  if (d.kind === "SingleCategory") {
    return {
      kind: d.kind,
      category: d.category,
      score: d.candidate.score,
      reasoning: d.candidate.reasoning,
    };
  }
  if (d.kind === "Ambiguous") {
    return {
      kind: d.kind,
      categories: d.candidates.map((c) => ({
        category: c.category,
        score: c.score,
        reasoning: c.reasoning,
      })),
    };
  }
  return { kind: d.kind, reasoning: d.reasoning };
}

function serializeRouting(result: ClassifyRouteResult) {
  const r = result.routing;
  const base = { action: r.action, reason: r.reason, guidanceNote: r.guidanceNote };
  if (r.action === "FORWARD") {
    return {
      ...base,
      to: r.to ?? [],
      cc: r.cc ?? [],
      outlookTo: formatOutlookRecipients(r.to ?? []),
      outlookCc: r.cc && r.cc.length > 0 ? formatOutlookRecipients(r.cc) : "",
    };
  }
  return base;
}

const opts = parseArgs(process.argv.slice(2));
const { body, mode } = readBody(opts);

const result = await classifyAndRoute(body, {
  threshold: opts.threshold,
  mode,
});

const payload = {
  ok: result.ok,
  error: result.error ?? null,
  messageId: result.messageId,
  submitterEmail: result.submitterEmail,
  candidates: result.candidates.map((c) => ({
    category: c.category,
    score: c.score,
    reasoning: c.reasoning,
  })),
  decision: serializeDecision(result),
  routing: serializeRouting(result),
};

const json = JSON.stringify(payload, null, 2);

if (opts.out !== undefined) {
  const outPath = resolve(opts.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json, "utf8");
}

console.log(json);

if (!result.ok) process.exit(1);
