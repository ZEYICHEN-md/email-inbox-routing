/**
 * CLI: classify a Contact Us notification body with the real Ada LLM backend.
 *
 * Usage:
 *   npm run classify -- --text "I have a complaint about my hotel booking"
 *   npm run classify -- --file path/to/body.txt
 *   npm run classify -- --body-file path/to/full-notification.txt
 *
 * --body-file expects the full notification body (with "The sender's email " marker).
 * --text / --file pass form message content directly.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveLlmConfig } from "../src/config/env.js";
import { LlmClient } from "../src/classifier/llmClient.js";
import { LlmEmailClassifier } from "../src/classifier/llmEmailClassifier.js";
import { applyClassificationCarveOuts, decide } from "../src/classifier/index.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../src/pipeline/index.js";
import { SubmitterExtractor } from "../src/submitterExtractor/index.js";
import { buildForwardTargets } from "../src/router/index.js";
import { SEED_RULE_ENTRIES } from "../src/ruleSet/index.js";
import type { ForwardedEmail, Submitter_Email } from "../src/types/index.js";
import { UNAVAILABLE } from "../src/types/index.js";
import {
  EXPECTED_SENDER,
  EXPECTED_SUBJECT,
} from "../src/notificationFilter/index.js";

function usage(): never {
  console.error(`Usage:
  npm run classify -- --text "<form message>"
  npm run classify -- --file <path>
  npm run classify -- --body-file <full-notification-body.txt>

Options:
  --threshold <0-1>   Confidence threshold (default 0.5)
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let text: string | undefined;
  let file: string | undefined;
  let bodyFile: string | undefined;
  let threshold = DEFAULT_CONFIDENCE_THRESHOLD;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--text") text = argv[++i];
    else if (arg === "--file") file = argv[++i];
    else if (arg === "--body-file") bodyFile = argv[++i];
    else if (arg === "--threshold") threshold = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") usage();
  }

  if (text === undefined && file === undefined && bodyFile === undefined) usage();
  return { text, file, bodyFile, threshold };
}

function readInput(opts: ReturnType<typeof parseArgs>): string {
  if (opts.text !== undefined) return opts.text;
  if (opts.file !== undefined) return readFileSync(resolve(opts.file), "utf8");
  if (opts.bodyFile !== undefined) return readFileSync(resolve(opts.bodyFile), "utf8");
  usage();
}

function makeForwardedFromBody(body: string): ForwardedEmail {
  return {
    messageId: "cli-manual",
    relayEnvelopeSender: EXPECTED_SENDER,
    submitterEmail: UNAVAILABLE,
    subject: EXPECTED_SUBJECT,
    body,
    formMessageContent: "",
    attachments: [],
    receivedAt: Date.now(),
  };
}

function formatDecision(
  decision: ReturnType<typeof decide>,
  threshold: number,
): void {
  console.log(`\n=== Decision (threshold ${threshold}) ===`);
  if (decision.kind === "SingleCategory") {
    console.log(`Category: ${decision.category}`);
    console.log(`Score:    ${decision.candidate.score.toFixed(2)}`);
    console.log(`Reason:   ${decision.candidate.reasoning}`);
  } else if (decision.kind === "Ambiguous") {
    console.log("Ambiguous — multiple categories qualify:");
    for (const c of decision.candidates) {
      console.log(`  - ${c.category}: ${c.score.toFixed(2)} — ${c.reasoning}`);
    }
  } else {
    console.log(`Unclassified: ${decision.reasoning}`);
  }
}

function formatRouting(decision: ReturnType<typeof decide>): void {
  console.log("\n=== Routing (dry-run) ===");
  const rules = new Map(SEED_RULE_ENTRIES.map((r) => [r.category, r]));

  if (decision.kind === "SingleCategory") {
    const rule = rules.get(decision.category);
    if (!rule) {
      console.log("No rule mapping — would go to REVIEW_QUEUE");
      return;
    }
    if (rule.behavior === "FORWARD") {
      const targets = buildForwardTargets(rule.recipients);
      console.log(`Action:   FORWARD`);
      console.log(`To:       ${targets.to.join(", ")}`);
      if (targets.cc.length > 0) {
        console.log(`CC:       ${targets.cc.join(", ")}`);
      }
    } else if (rule.behavior === "NO_FORWARD_RESOLVE") {
      console.log(`Action:   NO_FORWARD (resolve)`);
      if (rule.guidanceNote) console.log(`Guidance: ${rule.guidanceNote}`);
    } else {
      console.log(`Action:   REVIEW_QUEUE (category requires review)`);
    }
    return;
  }

  if (decision.kind === "Ambiguous") {
    console.log("Action:   REVIEW_QUEUE (ambiguous classification)");
    return;
  }

  console.log("Action:   REVIEW_QUEUE (unclassified)");
}

const opts = parseArgs(process.argv.slice(2));
const rawInput = readInput(opts);
const categories = SEED_RULE_ENTRIES.map((r) => r.category);

let formContent: string;
let submitter: Submitter_Email = UNAVAILABLE;

if (opts.bodyFile !== undefined) {
  const extractor = new SubmitterExtractor();
  const extracted = extractor.extract(makeForwardedFromBody(rawInput));
  formContent = extracted.formMessageContent;
  submitter = extracted.submitterEmail;
  console.log(`Submitter: ${submitter}`);
} else {
  formContent = rawInput;
}

console.log(`\nForm message (${formContent.length} chars):\n${formContent.slice(0, 500)}${formContent.length > 500 ? "…" : ""}`);

const llm = resolveLlmConfig();
const client = new LlmClient({ ...llm, apiStyle: llm.apiStyle });
const classifier = new LlmEmailClassifier({ client });

console.log(`\nCalling ${llm.baseUrl}${llm.apiPath} (model: ${llm.model})…`);

const result = await classifier.classify(formContent, categories);

if (result.failed) {
  console.error(`\nClassification failed: ${result.failureReason}`);
  process.exit(1);
}

const resolved = applyClassificationCarveOuts(formContent, result, opts.threshold);

console.log("\n=== Candidates ===");
const sorted = [...resolved.candidates].sort((a, b) => b.score - a.score);
for (const c of sorted) {
  console.log(`  ${c.score.toFixed(2)}  ${c.category}`);
  console.log(`         ${c.reasoning}`);
}

const decision = decide(resolved, opts.threshold);
formatDecision(decision, opts.threshold);
formatRouting(decision);
