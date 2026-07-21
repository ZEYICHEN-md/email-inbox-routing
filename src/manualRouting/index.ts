/**
 * Shared classify-and-route logic for semi-automatic workflows:
 * CLI (`classify`, `classify-json`), inbox batch processor, and Outlook VBA bridge.
 */
import { resolveLlmConfig } from "../config/env.js";
import { LlmClient } from "../classifier/llmClient.js";
import { LlmEmailClassifier } from "../classifier/llmEmailClassifier.js";
import { applyClassificationCarveOuts, decide } from "../classifier/index.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../pipeline/index.js";
import { buildForwardTargets } from "../router/index.js";
import { SEED_RULE_ENTRIES } from "../ruleSet/index.js";
import { SubmitterExtractor } from "../submitterExtractor/index.js";
import type {
  ClassificationCandidate,
  ClassificationResult,
  Decision,
  ForwardedEmail,
  Submitter_Email,
} from "../types/index.js";
import { UNAVAILABLE } from "../types/index.js";
import {
  EXPECTED_SENDER,
  EXPECTED_SUBJECT,
} from "../notificationFilter/index.js";

export type ManualInputMode = "notification-body" | "form-content";

export interface ClassifyRouteOptions {
  /** Confidence threshold (default 0.5). */
  threshold?: number;
  /** How to interpret `body` (default notification-body). */
  mode?: ManualInputMode;
  messageId?: string;
}

export type RoutingActionKind = "FORWARD" | "NO_FORWARD" | "REVIEW_QUEUE";

export interface RoutingAction {
  action: RoutingActionKind;
  to?: string[];
  cc?: string[];
  guidanceNote?: string;
  reason?: string;
}

export interface ClassifyRouteResult {
  ok: boolean;
  error?: string;
  messageId: string;
  submitterEmail: Submitter_Email;
  formMessageContent: string;
  candidates: ClassificationCandidate[];
  decision: Decision;
  routing: RoutingAction;
  classificationFailed: boolean;
}

function makeForwardedEmail(body: string, messageId: string): ForwardedEmail {
  return {
    messageId,
    relayEnvelopeSender: EXPECTED_SENDER,
    submitterEmail: UNAVAILABLE,
    subject: EXPECTED_SUBJECT,
    body,
    formMessageContent: "",
    attachments: [],
    receivedAt: Date.now(),
  };
}

export function resolveRouting(decision: Decision): RoutingAction {
  const rules = new Map(SEED_RULE_ENTRIES.map((r) => [r.category, r]));

  if (decision.kind === "Ambiguous") {
    const names = decision.candidates.map((c) => c.category).join(", ");
    return {
      action: "REVIEW_QUEUE",
      reason: `Ambiguous — multiple categories qualify: ${names}`,
    };
  }

  if (decision.kind === "Unclassified") {
    return {
      action: "REVIEW_QUEUE",
      reason: decision.reasoning,
    };
  }

  const rule = rules.get(decision.category);
  if (!rule) {
    return {
      action: "REVIEW_QUEUE",
      reason: `No rule mapping for category ${decision.category}`,
    };
  }

  switch (rule.behavior) {
    case "FORWARD": {
      const targets = buildForwardTargets(rule.recipients);
      return {
        action: "FORWARD",
        to: targets.to,
        cc: targets.cc.length > 0 ? targets.cc : undefined,
      };
    }
    case "NO_FORWARD_RESOLVE":
      return {
        action: "NO_FORWARD",
        guidanceNote: rule.guidanceNote,
        reason: rule.guidanceNote
          ? `No forward needed — direct submitter to: ${rule.guidanceNote}`
          : "No forward needed — resolve locally",
      };
    case "NO_FORWARD_REVIEW":
      return {
        action: "REVIEW_QUEUE",
        reason: `Category ${decision.category} requires manual review`,
      };
  }
}

export function prepareFormContent(
  body: string,
  mode: ManualInputMode,
  messageId: string,
): { formMessageContent: string; submitterEmail: Submitter_Email } {
  if (mode === "form-content") {
    return { formMessageContent: body, submitterEmail: UNAVAILABLE };
  }
  const extractor = new SubmitterExtractor();
  const extracted = extractor.extract(makeForwardedEmail(body, messageId));
  return {
    formMessageContent: extracted.formMessageContent,
    submitterEmail: extracted.submitterEmail,
  };
}

export async function classifyAndRoute(
  body: string,
  options: ClassifyRouteOptions = {},
): Promise<ClassifyRouteResult> {
  const threshold = options.threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const mode = options.mode ?? "notification-body";
  const messageId = options.messageId ?? `manual-${Date.now()}`;

  const { formMessageContent, submitterEmail } = prepareFormContent(body, mode, messageId);

  if (formMessageContent.trim().length === 0) {
    return {
      ok: false,
      error: "Form message content is empty — check body or extraction marker",
      messageId,
      submitterEmail,
      formMessageContent,
      candidates: [],
      decision: { kind: "Unclassified", reasoning: "empty form message content" },
      routing: { action: "REVIEW_QUEUE", reason: "empty form message content" },
      classificationFailed: true,
    };
  }

  const categories = SEED_RULE_ENTRIES.map((r) => r.category);
  const llm = resolveLlmConfig();
  const client = new LlmClient({ ...llm, apiStyle: llm.apiStyle });
  const classifier = new LlmEmailClassifier({ client });

  let classification: ClassificationResult;
  try {
    classification = await classifier.classify(formMessageContent, categories);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: message,
      messageId,
      submitterEmail,
      formMessageContent,
      candidates: [],
      decision: { kind: "Unclassified", reasoning: message },
      routing: { action: "REVIEW_QUEUE", reason: message },
      classificationFailed: true,
    };
  }

  if (classification.failed) {
    const reason = classification.failureReason ?? "classification failed";
    return {
      ok: false,
      error: reason,
      messageId,
      submitterEmail,
      formMessageContent,
      candidates: classification.candidates,
      decision: { kind: "Unclassified", reasoning: reason },
      routing: { action: "REVIEW_QUEUE", reason },
      classificationFailed: true,
    };
  }

  const resolved = applyClassificationCarveOuts(formMessageContent, classification, threshold);
  const decision = decide(resolved, threshold);
  const routing = resolveRouting(decision);

  return {
    ok: true,
    messageId,
    submitterEmail,
    formMessageContent,
    candidates: resolved.candidates,
    decision,
    routing,
    classificationFailed: false,
  };
}

/** Formats To/CC lists for Outlook VBA (semicolon-separated). */
export function formatOutlookRecipients(addresses: readonly string[]): string {
  return addresses.join("; ");
}
