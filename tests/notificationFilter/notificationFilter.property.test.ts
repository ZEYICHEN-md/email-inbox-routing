/**
 * Property-based tests for the NotificationFilter (Task 6.2, 6.3).
 *
 * Feature: email-inbox-routing
 *   - Property 20: NotificationFilter admits an email exactly when both
 *     normalized conditions hold (Validates: Requirements 2.1, 2.2)
 *   - Property 21: Non-matching and unreadable emails are left untouched, with
 *     a skip notice logged for unreadable headers (Validates: Requirements 2.2, 2.3)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  NotificationFilter,
  EXPECTED_SENDER,
  EXPECTED_SUBJECT,
} from "../../src/notificationFilter/index.js";
import type { RawInboxEmail } from "../../src/types/index.js";

const NUM_RUNS = 200;

// --- Arbitraries -----------------------------------------------------------

/** Whitespace runs that can pad a header without changing the trimmed value. */
const paddingArb = fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 4 });

/** Wraps a base string in arbitrary leading/trailing whitespace. */
function padded(base: string): fc.Arbitrary<string> {
  return fc.tuple(paddingArb, paddingArb).map(([lead, trail]) => `${lead}${base}${trail}`);
}

/** Randomly re-cases each letter of a string. */
function reCase(s: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: s.length, maxLength: s.length })
    .map((flags) =>
      s
        .split("")
        .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
        .join(""),
    );
}

/** A From value that, after trim + lowercase, equals EXPECTED_SENDER. */
const matchingFromArb = reCase(EXPECTED_SENDER).chain((cased) => padded(cased));

/** A Subject value that, after trim (case-sensitive), equals EXPECTED_SUBJECT. */
const matchingSubjectArb = padded(EXPECTED_SUBJECT);

/** A readable, non-empty-after-trim string that is NOT the expected sender. */
const nonMatchingFromArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0 && s.trim().toLowerCase() !== EXPECTED_SENDER);

/** A readable, non-empty-after-trim string that is NOT the expected subject. */
const nonMatchingSubjectArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0 && s.trim() !== EXPECTED_SUBJECT);

/** Any readable From: either matching or non-matching. */
const readableFromArb = fc.oneof(matchingFromArb, nonMatchingFromArb);
const readableSubjectArb = fc.oneof(matchingSubjectArb, nonMatchingSubjectArb);

/** An unreadable header: missing (null) or empty-after-trim. */
const unreadableHeaderArb = fc.oneof(
  fc.constant(null),
  paddingArb, // whitespace-only -> empty after trim
  fc.constant(""),
);

function makeRaw(from: string | null, subject: string | null): RawInboxEmail {
  return {
    messageId: `m-${Math.random().toString(36).slice(2)}`,
    from,
    subject,
    body: "The sender's email person@example.com wrote a message.",
    attachments: [],
    receivedAt: 1_000,
  };
}

// --- Property 20 -----------------------------------------------------------

describe("Property 20: admits exactly when both normalized conditions hold", () => {
  it("admits iff trim(from) lower == sender AND trim(subject) == subject (readable headers)", () => {
    fc.assert(
      fc.property(readableFromArb, readableSubjectArb, (from, subject) => {
        const filter = new NotificationFilter();
        const raw = makeRaw(from, subject);
        const outcome = filter.admit(raw);

        const fromOk = from.trim().toLowerCase() === EXPECTED_SENDER;
        const subjectOk = subject.trim() === EXPECTED_SUBJECT;
        const shouldAdmit = fromOk && subjectOk;

        expect(outcome.kind === "Admitted").toBe(shouldAdmit);

        if (shouldAdmit) {
          // The admitted ForwardedEmail carries the filter-set fields.
          if (outcome.kind !== "Admitted") throw new Error("expected Admitted");
          expect(outcome.email.messageId).toBe(raw.messageId);
          expect(outcome.email.relayEnvelopeSender).toBe(from);
          expect(outcome.email.subject).toBe(subject);
          expect(outcome.email.body).toBe(raw.body);
        } else {
          // A readable non-match is Ignored (never enters the pipeline).
          expect(outcome.kind).toBe("Ignored");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("always admits when both conditions hold regardless of case/whitespace variation", () => {
    fc.assert(
      fc.property(matchingFromArb, matchingSubjectArb, (from, subject) => {
        const filter = new NotificationFilter();
        const outcome = filter.admit(makeRaw(from, subject));
        expect(outcome.kind).toBe("Admitted");
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 21 -----------------------------------------------------------

describe("Property 21: non-matching and unreadable emails are left untouched", () => {
  it("never admits and never mutates the source for readable non-matches", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // At least one condition fails.
          fc.tuple(nonMatchingFromArb, readableSubjectArb),
          fc.tuple(readableFromArb, nonMatchingSubjectArb),
          fc.tuple(nonMatchingFromArb, nonMatchingSubjectArb),
        ),
        ([from, subject]) => {
          // Skip the rare case where the oneof produced a genuine match.
          fc.pre(!(from.trim().toLowerCase() === EXPECTED_SENDER && subject.trim() === EXPECTED_SUBJECT));

          const filter = new NotificationFilter();
          const raw = makeRaw(from, subject);
          const snapshot = structuredClone(raw);

          const outcome = filter.admit(raw);

          expect(outcome.kind).toBe("Ignored");
          // No ForwardedEmail is produced for a non-match.
          expect(outcome.kind === "Admitted").toBe(false);
          // The source email object is left untouched.
          expect(raw).toEqual(snapshot);
          // Readable non-matches produce no skip notice.
          expect(filter.getSkipNotices()).toHaveLength(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("skips + logs a notice when From or Subject is missing/empty/unreadable, leaving the email untouched", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.tuple(unreadableHeaderArb, readableSubjectArb),
          fc.tuple(readableFromArb, unreadableHeaderArb),
          fc.tuple(unreadableHeaderArb, unreadableHeaderArb),
        ),
        ([from, subject]) => {
          const captured: { messageId: string; reason: string }[] = [];
          const filter = new NotificationFilter({ onSkip: (n) => captured.push(n) });
          const raw = makeRaw(from, subject);
          const snapshot = structuredClone(raw);

          const outcome = filter.admit(raw);

          expect(outcome.kind).toBe("SkippedUnreadable");
          // Not admitted; never enters the pipeline.
          expect(outcome.kind === "Admitted").toBe(false);
          // Source email untouched.
          expect(raw).toEqual(snapshot);
          // A skip notice recording the reason was logged.
          expect(filter.getSkipNotices()).toHaveLength(1);
          expect(captured).toHaveLength(1);
          expect(captured[0]!.messageId).toBe(raw.messageId);
          expect(captured[0]!.reason.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
