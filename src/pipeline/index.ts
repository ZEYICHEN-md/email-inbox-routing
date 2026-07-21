/**
 * RoutingPipeline (Task 15.1): wires the routing pipeline end-to-end.
 *
 * Connects, per the design notes's high-level flow:
 *   InboundEmailSource (mock) -> NotificationFilter -> IngestionTracker ->
 *   SubmitterExtractor -> EmailClassifier (mock) -> decide -> EmailRouter ->
 *   AuditLog / ReviewQueue
 *
 * Gating and enrichment semantics:
 *  - `NotificationFilter` GATES the pipeline: readable non-matches are left
 *    untouched (Ignored) and emails with missing/empty/unreadable From/Subject
 *    are skipped and logged (SkippedUnreadable). Neither enters
 *    extraction/classification/routing and neither produces an Audit_Log entry —
 *    they are simply not Contact_Us_Notifications (Req 2.2, 2.3).
 *  - `SubmitterExtractor` is a NON-BLOCKING enrichment step: a missing marker or
 *    invalid address yields `submitterEmail = "unavailable"` and the email still
 *    flows through normal classification/routing (Req 3.5). There is NO
 *    parse-failure -> review branch.
 *  - `EmailRouter` performs a native forward for FORWARD decisions; the
 *    Audit_Log records the extracted Submitter_Email value or "unavailable"
 *    (Req 15.6).
 *  - Every PROCESSED email (an admitted Contact_Us_Notification) results in at
 *    least one Audit_Log entry labeled with the correct outcome — FORWARDED,
 *    NO_FORWARD, or REVIEW_QUEUE (Req 15.3, 15.4). Read errors while processing
 *    an admitted email are recorded as REVIEW_QUEUE and the email is enqueued to
 *    the Review_Queue with reason READ_ERROR (Req 1.3).
 *  - Dedup + outage recovery are delegated to the IngestionTracker so each
 *    unseen notification triggers classification exactly once and outage-window
 *    arrivals are replayed (Req 1.1, 1.2, 1.5).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 15.3, 15.4, 15.6
 */
import type {
  AuditLogEntry,
  Category,
  ClassificationResult,
  Decision,
  ForwardedEmail,
  RawInboxEmail,
  ReviewReason,
  RoutingOutcome,
  RuleEntry,
  Timestamp,
} from "../types/index.js";
import type { InboundEmailSource } from "../inboundEmailSource/index.js";
import { NotificationFilter } from "../notificationFilter/index.js";
import { IngestionTracker } from "../ingestion/index.js";
import { SubmitterExtractor } from "../submitterExtractor/index.js";
import { applyClassificationCarveOuts, decide, type EmailClassifier } from "../classifier/index.js";
import { EmailRouter } from "../router/index.js";
import { AuditLog, buildAuditEntry } from "../auditLog/index.js";
import { ReviewQueue } from "../reviewQueue/index.js";
import { RuleManager } from "../ruleSet/index.js";

/** The default Confidence_Threshold used when none is configured. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

/** The disposition of a single raw inbox email after one pipeline pass. */
export type Disposition =
  | "IGNORED" // readable non-match; left untouched, not processed (Req 2.2)
  | "SKIPPED_UNREADABLE" // missing/empty/unreadable header; left untouched + logged (Req 2.3)
  | "FORWARDED" // admitted + natively forwarded (Req 5–10, 14)
  | "NO_FORWARD" // admitted + silently resolved (Req 11, 12)
  | "REVIEW_QUEUE"; // admitted + queued for human review (Req 1.3, 9.3, 13, 14.3)

/**
 * The result of processing one raw inbox email. For admitted emails an
 * `auditEntry` is always present (Req 15.3); `reviewReason` is present when the
 * email was enqueued to the Review_Queue.
 */
export interface ProcessedResult {
  messageId: string;
  disposition: Disposition;
  /** Present for every admitted (processed) email (Req 15.3). */
  auditEntry?: AuditLogEntry;
  /** Present when the email entered the Review_Queue. */
  reviewReason?: ReviewReason;
}

/** The collaborating components the pipeline orchestrates. */
export interface PipelineDependencies {
  source: InboundEmailSource;
  filter: NotificationFilter;
  ingestion: IngestionTracker;
  extractor: SubmitterExtractor;
  classifier: EmailClassifier;
  router: EmailRouter;
  ruleManager: RuleManager;
  auditLog: AuditLog;
  reviewQueue: ReviewQueue;
}

export interface RoutingPipelineOptions {
  /** Confidence_Threshold for the decision function (default 0.5). */
  threshold?: number;
  /** Clock used to stamp the forward-start time / decision time. */
  now?: () => Timestamp;
}

/**
 * The end-to-end orchestrator. `runOnce()` performs a single polling tick:
 * it collects pending messages (honoring dedup + outage recovery), then runs
 * each through the gate -> enrichment -> classification -> routing -> audit flow.
 */
export class RoutingPipeline {
  private readonly deps: PipelineDependencies;
  private readonly threshold: number;
  private readonly now: () => Timestamp;

  constructor(deps: PipelineDependencies, options: RoutingPipelineOptions = {}) {
    this.deps = deps;
    this.threshold = options.threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Performs one polling tick. Delegates fetch + dedup + outage recovery to the
   * IngestionTracker, then processes each pending raw email. Returns one
   * {@link ProcessedResult} per pending message (in poll order).
   */
  runOnce(): ProcessedResult[] {
    const pending = this.deps.ingestion.collectPending();
    return pending.map((raw) => this.processRaw(raw));
  }

  /** Async variant for production classifiers (e.g. live LLM API). */
  async runOnceAsync(): Promise<ProcessedResult[]> {
    const pending = this.deps.ingestion.collectPending();
    const results: ProcessedResult[] = [];
    for (const raw of pending) {
      results.push(await this.processRawAsync(raw));
    }
    return results;
  }

  /**
   * Processes a single raw inbox email through the full pipeline. The message is
   * assumed to have been marked in-flight by the IngestionTracker; this method
   * always marks it processed before returning so it is never re-triggered.
   */
  processRaw(raw: RawInboxEmail): ProcessedResult {
    try {
      const outcome = this.deps.filter.admit(raw);
      if (outcome.kind === "Ignored") {
        this.deps.ingestion.markProcessed(raw.messageId);
        return { messageId: raw.messageId, disposition: "IGNORED" };
      }
      if (outcome.kind === "SkippedUnreadable") {
        this.deps.ingestion.markProcessed(raw.messageId);
        return { messageId: raw.messageId, disposition: "SKIPPED_UNREADABLE" };
      }
      return this.processAdmittedSync(outcome.email);
    } catch (error) {
      return this.handleReadError(raw, error);
    }
  }

  async processRawAsync(raw: RawInboxEmail): Promise<ProcessedResult> {
    try {
      const outcome = this.deps.filter.admit(raw);
      if (outcome.kind === "Ignored") {
        this.deps.ingestion.markProcessed(raw.messageId);
        return { messageId: raw.messageId, disposition: "IGNORED" };
      }
      if (outcome.kind === "SkippedUnreadable") {
        this.deps.ingestion.markProcessed(raw.messageId);
        return { messageId: raw.messageId, disposition: "SKIPPED_UNREADABLE" };
      }
      return await this.processAdmittedAsync(outcome.email);
    } catch (error) {
      return this.handleReadError(raw, error);
    }
  }

  /** Runs enrichment -> classification -> routing -> audit for an admitted email. */
  private processAdmittedSync(admitted: ForwardedEmail): ProcessedResult {
    const extraction = this.deps.extractor.extract(admitted);
    const email: ForwardedEmail = {
      ...admitted,
      submitterEmail: extraction.submitterEmail,
      formMessageContent: extraction.formMessageContent,
    };
    const classification = this.deps.classifier.classify(
      email.formMessageContent,
      this.ruleCategories(),
    );
    if (classification instanceof Promise) {
      throw new Error("Async classifier requires processRawAsync() / runOnceAsync()");
    }
    return this.finishAdmitted(email, classification);
  }

  private async processAdmittedAsync(admitted: ForwardedEmail): Promise<ProcessedResult> {
    const extraction = this.deps.extractor.extract(admitted);
    const email: ForwardedEmail = {
      ...admitted,
      submitterEmail: extraction.submitterEmail,
      formMessageContent: extraction.formMessageContent,
    };
    const classification = await this.deps.classifier.classify(
      email.formMessageContent,
      this.ruleCategories(),
    );
    return this.finishAdmittedAsync(email, classification);
  }

  private async finishAdmittedAsync(
    email: ForwardedEmail,
    classification: ClassificationResult,
  ): Promise<ProcessedResult> {
    const decidedAt = this.now();
    const ruleSetSnapshot: RuleEntry[] = this.deps.ruleManager.getActiveRuleSet(decidedAt);
    const resolved = applyClassificationCarveOuts(email.formMessageContent, classification, this.threshold);
    const decision: Decision = decide(resolved, this.threshold);
    const routingOutcome: RoutingOutcome = await this.deps.router.routeAsync(
      email,
      decision,
      ruleSetSnapshot,
    );
    return this.finalizeAdmitted(email, resolved, decision, routingOutcome, decidedAt);
  }

  private ruleCategories(): Category[] {
    const decidedAt = this.now();
    return this.deps.ruleManager.getActiveRuleSet(decidedAt).map((e) => e.category);
  }

  private finishAdmitted(
    email: ForwardedEmail,
    classification: ClassificationResult,
  ): ProcessedResult {
    const decidedAt = this.now();
    const ruleSetSnapshot: RuleEntry[] = this.deps.ruleManager.getActiveRuleSet(decidedAt);
    const resolved = applyClassificationCarveOuts(email.formMessageContent, classification, this.threshold);
    const decision: Decision = decide(resolved, this.threshold);
    const routingOutcome: RoutingOutcome = this.deps.router.route(
      email,
      decision,
      ruleSetSnapshot,
    );
    return this.finalizeAdmitted(email, resolved, decision, routingOutcome, decidedAt);
  }

  private finalizeAdmitted(
    email: ForwardedEmail,
    classification: ClassificationResult,
    decision: Decision,
    routingOutcome: RoutingOutcome,
    decidedAt: Timestamp,
  ): ProcessedResult {
    const reviewReason = this.enqueueForReviewIfNeeded(email, decision, routingOutcome);
    const auditEntry = buildAuditEntry({
      email,
      classification,
      decision,
      outcome: routingOutcome,
      decidedAt,
    });
    this.deps.auditLog.write(auditEntry);
    this.deps.ingestion.markProcessed(email.messageId);

    return {
      messageId: email.messageId,
      disposition: auditEntry.outcome as Disposition,
      auditEntry,
      ...(reviewReason !== undefined ? { reviewReason } : {}),
    };
  }

  /**
   * Enqueues the email to the Review_Queue when the routing outcome requires
   * human review, returning the reason used. Returns `undefined` when no review
   * is needed (Forwarded / NoForwardResolved).
   */
  private enqueueForReviewIfNeeded(
    email: ForwardedEmail,
    decision: Decision,
    outcome: RoutingOutcome,
  ): ReviewReason | undefined {
    if (outcome.kind === "SentToReview") {
      if (decision.kind === "Unclassified") {
        this.deps.reviewQueue.enqueue(email, "UNCLASSIFIED");
        return "UNCLASSIFIED";
      }
      if (decision.kind === "Ambiguous") {
        this.deps.reviewQueue.enqueue(email, "AMBIGUOUS", decision.candidates);
        return "AMBIGUOUS";
      }
      // SingleCategory routed to review: a NO_FORWARD_REVIEW category (Req 9.3)
      // or a decided category with no active mapping.
      this.deps.reviewQueue.enqueue(email, "REVIEW_REQUIRED_CATEGORY");
      return "REVIEW_REQUIRED_CATEGORY";
    }
    if (outcome.kind === "ForwardFailed") {
      // Native forward failed: retain content, queue for retry/manual (Req 14.3).
      this.deps.reviewQueue.enqueue(email, "FORWARD_FAILED");
      return "FORWARD_FAILED";
    }
    return undefined;
  }

  /**
   * Handles a read/processing error on an admitted email (Req 1.3): records a
   * REVIEW_QUEUE audit entry and enqueues the email with reason READ_ERROR.
   * A best-effort ForwardedEmail is reconstructed from the raw message so the
   * audit + review records still carry its identity.
   */
  private handleReadError(raw: RawInboxEmail, error: unknown): ProcessedResult {
    const message = error instanceof Error ? error.message : String(error);
    const email: ForwardedEmail = {
      messageId: raw.messageId,
      relayEnvelopeSender: raw.from ?? "",
      submitterEmail: "unavailable",
      subject: raw.subject ?? "",
      body: raw.body ?? "",
      formMessageContent: "",
      attachments: raw.attachments ?? [],
      receivedAt: raw.receivedAt,
    };

    this.deps.reviewQueue.enqueue(email, "READ_ERROR");

    const decidedAt = this.now();
    const decision: Decision = {
      kind: "Unclassified",
      reasoning: `read error while processing email: ${message}`,
    };
    const auditEntry = buildAuditEntry({
      email,
      classification: { candidates: [], failed: true, failureReason: message },
      decision,
      outcome: { kind: "SentToReview" },
      decidedAt,
    });
    this.deps.auditLog.write(auditEntry);

    this.deps.ingestion.markProcessed(raw.messageId);

    return {
      messageId: raw.messageId,
      disposition: "REVIEW_QUEUE",
      auditEntry,
      reviewReason: "READ_ERROR",
    };
  }
}

/** Convenience factory: wire a pipeline with the given components. */
export function createRoutingPipeline(
  deps: PipelineDependencies,
  options?: RoutingPipelineOptions,
): RoutingPipeline {
  return new RoutingPipeline(deps, options);
}
