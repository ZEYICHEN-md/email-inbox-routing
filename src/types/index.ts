/**
 * Core data model types for the Shared inbox Email Routing system.
 *
 * These types mirror the "Data Models" and "Components and Interfaces" sections
 * of the design document (docs/the design notes).
 *
 * Requirements traceability: 2.1, 3.1, 14.1, 14.2, 15.1, 15.6, 15.7
 */

/** The literal marker used when a Submitter_Email cannot be extracted (Req 3.5, 15.6). */
export const UNAVAILABLE = "unavailable" as const;
export type Unavailable = typeof UNAVAILABLE;

/**
 * Submitter_Email: the real submitter address extracted from a notification body,
 * or the "unavailable" marker if it could not be extracted. Recorded to Audit_Log
 * for traceability only — never used as a sender field (Req 3.4, 15.6).
 */
export type Submitter_Email = string | Unavailable;

/**
 * Category: one of the fixed set defined in the demo category table of the product requirements,
 * or the special value "Unclassified". Kept as a string alias so the
 * Routing_Rule_Set remains the authoritative source of valid categories.
 */
export type Category = string;

/** The special Category used when no confident category could be decided. */
export const UNCLASSIFIED = "Unclassified" as const;

/** Confidence_Score: a value in the inclusive range [0.0, 1.0] (Req 4.2). */
export type Confidence_Score = number;

/** A stable timestamp represented as epoch milliseconds. */
export type Timestamp = number;

/** An opaque cursor used by the Inbound Email Source to track fetch position. */
export type Cursor = string;

/** A single email attachment. `contentBytes` carries the raw file bytes. */
export interface Attachment {
  filename: string;
  contentBytes: Uint8Array;
}

/**
 * RawInboxEmail: every message yielded by the Inbound Email Source, before
 * NotificationFilter decides whether it is a genuine Contact_Us_Notification.
 * `from` and `subject` may be missing/empty/unreadable (Req 2.3).
 */
export interface RawInboxEmail {
  /** Stable identity; used for dedup. */
  messageId: string;
  /** Relay envelope sender; may be missing/empty/unreadable. */
  from: string | null;
  /** Subject; may be missing/empty/unreadable. */
  subject: string | null;
  /**
   * Full body, carrying BOTH the relay envelope framing AND the embedded
   * Contact Us form content (marker + submitter + message).
   */
  body: string;
  attachments: Attachment[];
  receivedAt: Timestamp;
}

/**
 * ForwardedEmail: produced by NotificationFilter from a matching RawInboxEmail,
 * then enriched by SubmitterExtractor. It represents an admitted
 * Contact_Us_Notification flowing through the routing pipeline.
 */
export interface ForwardedEmail {
  /** Stable identity; used for dedup. */
  messageId: string;
  /** The relay/notification address (e.g. noreply@forms.example.com). */
  relayEnvelopeSender: string;
  /**
   * Submitter_Email: real submitter address extracted from the body, or the
   * "unavailable" marker if not extractable; set by SubmitterExtractor.
   * Used ONLY for Audit_Log traceability, never as a sender field (Req 3.4).
   */
  submitterEmail: Submitter_Email;
  /** The fixed notification subject (relay metadata). */
  subject: string;
  /** Full notification body (relay framing + embedded form content). */
  body: string;
  /** The extracted Contact Us form message content used for classification (Req 3.3). */
  formMessageContent: string;
  attachments: Attachment[];
  receivedAt: Timestamp;
}

/** Routing behavior for a category, per the design's Routing_Rule_Set. */
export type RuleBehavior = "FORWARD" | "NO_FORWARD_RESOLVE" | "NO_FORWARD_REVIEW";

/**
 * RuleEntry: one row of the Routing_Rule_Set, structured from the demo category table.
 * Versioned via `effectiveFrom` for cutover semantics (Req 16.4, 16.5).
 */
export interface RuleEntry {
  category: Category;
  behavior: RuleBehavior;
  /** Matched recipient(s); empty for NO_FORWARD_* behaviors. */
  recipients: string[];
  /** e.g. a redirect URL, for NO_FORWARD_RESOLVE categories. */
  guidanceNote?: string;
  /** Versioning for cutover semantics (Req 16.4, 16.5). */
  effectiveFrom: Timestamp;
}

/** A single scored candidate category produced by the Email_Classifier. */
export interface ClassificationCandidate {
  category: Category;
  /** Confidence_Score in [0, 1]. */
  score: Confidence_Score;
  /** AI-generated per-candidate reasoning, always produced as normal output. */
  reasoning: string;
}

/**
 * ClassificationResult: output of the Email_Classifier.
 * `failed` indicates the classifier could not produce any scores (Req 4.5).
 */
export interface ClassificationResult {
  candidates: ClassificationCandidate[];
  /** True when the classifier failed to produce any scores (Req 4.5). */
  failed?: boolean;
  /** Failure-reason note, present when `failed` is true. */
  failureReason?: string;
}

/**
 * Decision: the outcome of the classification decision function.
 * - Unclassified: classifier failure or zero qualifying candidates.
 * - SingleCategory: exactly one candidate qualified.
 * - Ambiguous: two or more candidates qualified (full qualifying set carried).
 */
export type Decision =
  | { kind: "Unclassified"; reasoning: string }
  | { kind: "SingleCategory"; category: Category; candidate: ClassificationCandidate }
  | { kind: "Ambiguous"; candidates: ClassificationCandidate[] };

/**
 * RoutingOutcome: the result of the Email_Router acting on a Decision.
 */
export type RoutingOutcome =
  | { kind: "Forwarded"; recipients: string[]; forwardedAt: Timestamp }
  | { kind: "NoForwardResolved"; guidanceNote?: string }
  | { kind: "SentToReview"; candidates?: ClassificationCandidate[] }
  | { kind: "ForwardFailed"; attemptedRecipients: string[]; error: string };

/** The processing outcome label recorded on an Audit_Log entry (Req 15.4). */
export type AuditOutcome = "FORWARDED" | "NO_FORWARD" | "REVIEW_QUEUE";

/**
 * AuditLogEntry: append-only record of a processed email's classification and
 * routing outcome. Persisted for EVERY processed email (Req 15.1, 15.3, 15.7).
 */
export interface AuditLogEntry {
  /** Message-ID, or an internally generated id if unavailable. */
  emailId: string;
  /**
   * The extracted Submitter_Email, or the "unavailable" marker when the marker
   * was absent / following token invalid (Req 15.6, 3.5). Audit-only.
   */
  submitterEmail: Submitter_Email;
  /**
   * Every candidate category with its score and AI-generated per-candidate
   * reasoning, carried through from ClassificationResult (Req 15.7).
   */
  candidates: ClassificationCandidate[];
  /** The final decided Category, or "Unclassified" / "Ambiguous". */
  finalCategory: Category | "Ambiguous";
  /**
   * Brief AI-generated reasoning for the final decided Category (Req 15.7).
   * For Unclassified / classification-failure, holds the failure-reason note
   * or a "no confident category" explanation (Req 4.5, 15.7).
   */
  finalCategoryReasoning: string;
  decidedAt: Timestamp;
  outcome: AuditOutcome;
  /** Present when outcome === "FORWARDED". */
  recipients?: string[];
  /** Present when outcome === "FORWARDED". */
  forwardedAt?: Timestamp;
}

/** Reasons an email is placed into the Review_Queue (Req 3.5 excluded). */
export type ReviewReason =
  | "UNCLASSIFIED"
  | "AMBIGUOUS"
  | "REVIEW_REQUIRED_CATEGORY"
  | "READ_ERROR"
  | "FORWARD_FAILED";

/**
 * ReviewQueueItem: an email held for human review. `candidates` is populated
 * for AMBIGUOUS items, each with score and non-empty reasoning (Req 13.2).
 */
export interface ReviewQueueItem {
  email: ForwardedEmail;
  reason: ReviewReason;
  candidates?: ClassificationCandidate[];
}
