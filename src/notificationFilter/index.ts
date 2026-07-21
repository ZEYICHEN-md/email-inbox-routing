/**
 * NotificationFilter (Task 6): the gating step that admits only genuine
 * Contact Us notifications and leaves every other inbox message untouched.
 *
 * A raw inbox email is admitted as a `ForwardedEmail` if and only if BOTH
 * normalized conditions hold:
 *  - `trim(from)` compared case-INsensitively equals `noreply@forms.example.com`
 *  - `trim(subject)` compared case-SENSITIVELY equals the fixed notification subject
 *
 * Readable non-matches are `Ignored` (left untouched in the inbox). Emails whose
 * From or Subject is missing, empty-after-trim, or unreadable are
 * `SkippedUnreadable` — also left untouched — and a skip notice recording the
 * reason is logged. This filter runs BEFORE dedup/extraction/classification and
 * never mutates the source mailbox.
 *
 * Requirements: 2.1, 2.2, 2.3
 */
import type { ForwardedEmail, RawInboxEmail } from "../types/index.js";
import { UNAVAILABLE } from "../types/index.js";

/** The exact relay sender address a genuine Contact_Us_Notification comes from. */
export const EXPECTED_SENDER = "noreply@forms.example.com";

/** The exact subject a genuine Contact_Us_Notification carries. */
export const EXPECTED_SUBJECT =
  "[External] New Contact Us submission for DemoCo Inc.";

/**
 * The outcome of running the filter over one raw inbox email.
 *  - `Admitted`: both conditions matched; carries the constructed ForwardedEmail.
 *  - `Ignored`: a readable, genuine non-match; left untouched, no processing.
 *  - `SkippedUnreadable`: From/Subject missing, empty, or unreadable; left
 *    untouched, a skip notice logged.
 */
export type FilterOutcome =
  | { kind: "Admitted"; email: ForwardedEmail }
  | { kind: "Ignored" }
  | { kind: "SkippedUnreadable"; reason: string };

/** A logged notice emitted when an email is skipped due to unreadable headers. */
export interface SkipNotice {
  messageId: string;
  reason: string;
}

export interface NotificationFilterOptions {
  /** Optional sink invoked for every skip notice (defaults to console.warn + capture). */
  onSkip?: (notice: SkipNotice) => void;
}

/**
 * Returns a human-readable reason string if `value` is missing, empty after
 * trimming, or otherwise unreadable; returns `null` if the field is readable.
 */
function unreadableReason(field: "From" | "Subject", value: string | null): string | null {
  if (value === null || value === undefined) {
    return `${field} is missing`;
  }
  if (typeof value !== "string") {
    return `${field} is unreadable`;
  }
  if (value.trim().length === 0) {
    return `${field} is empty after trimming`;
  }
  return null;
}

/**
 * Constructs a `ForwardedEmail` from a matching raw inbox email. Only the fields
 * the filter is responsible for are set here (relayEnvelopeSender, subject, body,
 * attachments, identity). `submitterEmail` and `formMessageContent` are enriched
 * later by the SubmitterExtractor (Task 8); until then they carry safe defaults.
 */
function toForwardedEmail(raw: RawInboxEmail): ForwardedEmail {
  return {
    messageId: raw.messageId,
    // The matched relay sender (original value preserved for the native forward).
    relayEnvelopeSender: raw.from as string,
    // Enriched by SubmitterExtractor; audit-only, never a sender field (Req 3.4).
    submitterEmail: UNAVAILABLE,
    // Original subject preserved intact for the native forward (Req 14.1).
    subject: raw.subject as string,
    body: raw.body,
    // Surfaced by SubmitterExtractor (Req 3.3); empty until enrichment.
    formMessageContent: "",
    attachments: raw.attachments,
    receivedAt: raw.receivedAt,
  };
}

/**
 * The NotificationFilter. Pure decision logic plus a side channel that logs skip
 * notices for unreadable-header emails. It never mutates the source mailbox.
 */
export class NotificationFilter {
  private readonly onSkip: (notice: SkipNotice) => void;
  private readonly skipNotices: SkipNotice[] = [];

  constructor(options: NotificationFilterOptions = {}) {
    this.onSkip = options.onSkip ?? (() => {});
  }

  /**
   * Decides whether a raw inbox email is a genuine Contact_Us_Notification.
   * See module docstring for the exact rule. This method performs no mutation
   * of the source email or mailbox.
   */
  admit(raw: RawInboxEmail): FilterOutcome {
    const fromReason = unreadableReason("From", raw.from);
    const subjectReason = unreadableReason("Subject", raw.subject);

    // Req 2.3 — missing/empty/unreadable From or Subject: skip + log, untouched.
    if (fromReason !== null || subjectReason !== null) {
      const reason = [fromReason, subjectReason].filter((r): r is string => r !== null).join("; ");
      const notice: SkipNotice = { messageId: raw.messageId, reason };
      this.skipNotices.push(notice);
      this.onSkip(notice);
      return { kind: "SkippedUnreadable", reason };
    }

    // Both fields are readable here; normalize and compare.
    const fromMatches = (raw.from as string).trim().toLowerCase() === EXPECTED_SENDER;
    const subjectMatches = (raw.subject as string).trim() === EXPECTED_SUBJECT;

    if (fromMatches && subjectMatches) {
      // Req 2.1 — start processing.
      return { kind: "Admitted", email: toForwardedEmail(raw) };
    }

    // Req 2.2 — readable non-match: leave untouched, no processing.
    return { kind: "Ignored" };
  }

  /** Returns all skip notices logged so far (for observability and testing). */
  getSkipNotices(): readonly SkipNotice[] {
    return this.skipNotices;
  }
}
