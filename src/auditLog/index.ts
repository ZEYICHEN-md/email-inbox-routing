/**
 * Audit_Log (Task 12): append-only audit log with bounded retry and an
 * error-channel fallback, plus a helper that assembles a complete
 * `AuditLogEntry` from classification + routing results.
 *
 * The Audit_Log persists one record per processed email — forwarded, silently
 * resolved, or queued for review (Req 15.3). Each record carries the
 * classification-phase fields (candidate categories + scores + AI-generated
 * per-candidate reasoning, the final decided category, and the final-category
 * reasoning) and the forward-phase fields (recipients + timestamp when
 * forwarded). Recording the reasoning is free: it is simply carried through from
 * the `ClassificationResult` already produced by the Email_Classifier (Req 15.7).
 *
 * Write path (Req 15.5): on write failure the entry is retried up to
 * `maxRetries` times (default 3). If every attempt fails the entry is written to
 * a separate error channel instead — the failure NEVER rolls back or blocks the
 * classification/forward action that already completed, and the email is never
 * silently dropped.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 4.5, 14.3
 */
import type {
  AuditLogEntry,
  AuditOutcome,
  ClassificationResult,
  Decision,
  ForwardedEmail,
  RoutingOutcome,
  Timestamp,
} from "../types/index.js";
import { UNCLASSIFIED } from "../types/index.js";

/**
 * The durable append-only sink for audit entries. `append` throws to signal a
 * write failure, which triggers the bounded retry / error-channel logic.
 */
export interface AuditLogStore {
  append(entry: AuditLogEntry): void;
}

/**
 * A separate error record channel, distinct from the Audit_Log store, used when
 * all bounded retries fail (Req 15.5).
 */
export interface ErrorChannel {
  record(entry: AuditLogEntry, error: string): void;
}

/** The result of a bounded audit write. Never thrown — always returned. */
export type AuditWriteResult =
  | { kind: "Written"; attempts: number }
  | { kind: "ErrorChannel"; attempts: number; error: string };

export interface AuditLogOptions {
  /** Maximum number of retry attempts after the initial write (default 3). */
  maxRetries?: number;
}

/**
 * Append-only Audit_Log with bounded retry and error-channel fallback.
 */
export class AuditLog {
  private readonly store: AuditLogStore;
  private readonly errorChannel: ErrorChannel;
  private readonly maxRetries: number;

  constructor(store: AuditLogStore, errorChannel: ErrorChannel, options: AuditLogOptions = {}) {
    this.store = store;
    this.errorChannel = errorChannel;
    this.maxRetries = options.maxRetries ?? 3;
  }

  /**
   * Writes an audit entry, retrying up to `maxRetries` times on failure (so at
   * most `maxRetries + 1` total attempts). If every attempt fails the entry is
   * routed to the error channel. Returns a result describing the outcome and the
   * number of attempts made; NEVER throws and NEVER blocks the already-completed
   * action (Req 15.5).
   */
  write(entry: AuditLogEntry): AuditWriteResult {
    const maxAttempts = this.maxRetries + 1;
    let lastError = "unknown audit write failure";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.store.append(entry);
        return { kind: "Written", attempts: attempt };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    // All bounded retries failed: fall back to the separate error channel
    // without rolling back or blocking the completed classification/forward.
    this.errorChannel.record(entry, lastError);
    return { kind: "ErrorChannel", attempts: maxAttempts, error: lastError };
  }
}

/** Inputs for {@link buildAuditEntry}. */
export interface BuildAuditEntryInput {
  email: ForwardedEmail;
  /** The full classifier output; supplies ALL candidate categories + reasoning. */
  classification: ClassificationResult;
  /** The decision derived from the classification result. */
  decision: Decision;
  /** The routing outcome produced by the Email_Router. */
  outcome: RoutingOutcome;
  /** The timestamp at which the classification decision completed. */
  decidedAt: Timestamp;
}

/** Maps a `RoutingOutcome` to its Audit_Log outcome label (Req 15.4). */
function outcomeLabel(outcome: RoutingOutcome): AuditOutcome {
  switch (outcome.kind) {
    case "Forwarded":
      return "FORWARDED";
    case "NoForwardResolved":
      return "NO_FORWARD";
    case "SentToReview":
    case "ForwardFailed":
      // Forward failure hands off to Review_Queue (Req 14.3).
      return "REVIEW_QUEUE";
  }
}

/**
 * Derives the final category label and its reasoning from the decision
 * (Req 15.1, 15.7). For Unclassified/classification-failure the reasoning holds
 * the failure-reason / "no confident category" note (Req 4.5, 15.7).
 */
function finalCategoryAndReasoning(decision: Decision): {
  finalCategory: AuditLogEntry["finalCategory"];
  finalCategoryReasoning: string;
} {
  switch (decision.kind) {
    case "SingleCategory":
      return {
        finalCategory: decision.category,
        finalCategoryReasoning:
          decision.candidate.reasoning.trim().length > 0
            ? decision.candidate.reasoning
            : `Decided category ${decision.category}.`,
      };
    case "Ambiguous": {
      const list = decision.candidates.map((c) => c.category).join(", ");
      return {
        finalCategory: "Ambiguous",
        finalCategoryReasoning: `Multiple candidate categories qualified (${list}); routed to Review_Queue.`,
      };
    }
    case "Unclassified":
      return {
        finalCategory: UNCLASSIFIED,
        finalCategoryReasoning:
          decision.reasoning.trim().length > 0
            ? decision.reasoning
            : "No confident category could be determined.",
      };
  }
}

/**
 * Assembles a complete {@link AuditLogEntry} from classification + routing
 * results. Persists ALL candidate categories with their scores and AI-generated
 * per-candidate reasoning for every processed email (Req 15.1, 15.7), the
 * final-category reasoning, the submitter (or "unavailable" marker, Req 15.6),
 * the outcome label (Req 15.4), and — when forwarded — the recipients and
 * forward timestamp (Req 15.2).
 */
export function buildAuditEntry(input: BuildAuditEntryInput): AuditLogEntry {
  const { email, classification, decision, outcome, decidedAt } = input;
  const { finalCategory, finalCategoryReasoning } = finalCategoryAndReasoning(decision);

  const entry: AuditLogEntry = {
    emailId: email.messageId,
    submitterEmail: email.submitterEmail,
    // Carry every candidate through unchanged from the classifier (Req 15.1, 15.7).
    candidates: classification.candidates.map((c) => ({ ...c })),
    finalCategory,
    finalCategoryReasoning,
    decidedAt,
    outcome: outcomeLabel(outcome),
  };

  // Forward-phase fields present only when actually forwarded (Req 15.2).
  if (outcome.kind === "Forwarded") {
    entry.recipients = [...outcome.recipients];
    entry.forwardedAt = outcome.forwardedAt;
  }

  return entry;
}

/**
 * A simple in-memory {@link AuditLogStore} for tests and local wiring. Can be
 * configured to fail a bounded number of initial writes (to exercise the retry
 * path) or to always fail (to exercise the error-channel fallback).
 */
export class InMemoryAuditLogStore implements AuditLogStore {
  private readonly entries: AuditLogEntry[] = [];
  /** Number of leading write attempts that should throw before succeeding. */
  private failuresRemaining: number;
  private readonly failForever: boolean;

  constructor(options: { failFirst?: number; failForever?: boolean } = {}) {
    this.failuresRemaining = options.failFirst ?? 0;
    this.failForever = options.failForever ?? false;
  }

  append(entry: AuditLogEntry): void {
    if (this.failForever) {
      throw new Error("simulated permanent audit store failure");
    }
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new Error("simulated transient audit store failure");
    }
    this.entries.push(entry);
  }

  getEntries(): readonly AuditLogEntry[] {
    return this.entries;
  }
}

/** A simple in-memory {@link ErrorChannel} for tests and local wiring. */
export class InMemoryErrorChannel implements ErrorChannel {
  private readonly records: { entry: AuditLogEntry; error: string }[] = [];

  record(entry: AuditLogEntry, error: string): void {
    this.records.push({ entry, error });
  }

  getRecords(): readonly { entry: AuditLogEntry; error: string }[] {
    return this.records;
  }
}

export { FileAuditLogStore, FileErrorChannel } from "./fileStores.js";
