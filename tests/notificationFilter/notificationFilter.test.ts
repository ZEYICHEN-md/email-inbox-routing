/**
 * Example-based unit tests for the NotificationFilter (Task 6.1).
 *
 * Anchors the admit/ignore/skip decision against concrete representative inputs
 * (a genuine notification, normal work mail, case/whitespace variations, and
 * unreadable headers).
 *
 * Requirements: 2.1, 2.2, 2.3
 */
import { describe, it, expect } from "vitest";
import {
  NotificationFilter,
  EXPECTED_SENDER,
  EXPECTED_SUBJECT,
} from "../../src/notificationFilter/index.js";
import type { RawInboxEmail } from "../../src/types/index.js";

function makeRaw(overrides: Partial<RawInboxEmail> = {}): RawInboxEmail {
  return {
    messageId: "m-1",
    from: EXPECTED_SENDER,
    subject: EXPECTED_SUBJECT,
    body: "The sender's email jane@example.com submitted a form.",
    attachments: [{ filename: "a.pdf", contentBytes: new Uint8Array([1, 2, 3]) }],
    receivedAt: 1_000,
    ...overrides,
  };
}

describe("NotificationFilter.admit", () => {
  it("admits a genuine Contact_Us_Notification and constructs the ForwardedEmail", () => {
    const filter = new NotificationFilter();
    const raw = makeRaw();
    const outcome = filter.admit(raw);
    expect(outcome.kind).toBe("Admitted");
    if (outcome.kind !== "Admitted") return;
    expect(outcome.email.relayEnvelopeSender).toBe(EXPECTED_SENDER);
    expect(outcome.email.subject).toBe(EXPECTED_SUBJECT);
    expect(outcome.email.body).toBe(raw.body);
    expect(outcome.email.attachments).toEqual(raw.attachments);
    // Enrichment fields carry safe defaults until SubmitterExtractor runs.
    expect(outcome.email.submitterEmail).toBe("unavailable");
    expect(outcome.email.formMessageContent).toBe("");
  });

  it("admits when the sender differs only by case (case-insensitive From)", () => {
    const filter = new NotificationFilter();
    const outcome = filter.admit(makeRaw({ from: "  NoReply@FORMS.EXAMPLE.COM  " }));
    expect(outcome.kind).toBe("Admitted");
  });

  it("does NOT admit when the subject differs by case (case-sensitive Subject)", () => {
    const filter = new NotificationFilter();
    const outcome = filter.admit(
      makeRaw({ subject: EXPECTED_SUBJECT.toLowerCase() }),
    );
    expect(outcome.kind).toBe("Ignored");
  });

  it("ignores normal work mail (readable non-match)", () => {
    const filter = new NotificationFilter();
    const outcome = filter.admit(
      makeRaw({ from: "colleague@example.com", subject: "Lunch?" }),
    );
    expect(outcome.kind).toBe("Ignored");
    expect(filter.getSkipNotices()).toHaveLength(0);
  });

  it("skips and logs when From is missing", () => {
    const filter = new NotificationFilter();
    const outcome = filter.admit(makeRaw({ from: null }));
    expect(outcome.kind).toBe("SkippedUnreadable");
    expect(filter.getSkipNotices()).toHaveLength(1);
    expect(filter.getSkipNotices()[0]!.reason).toContain("From");
  });

  it("skips and logs when Subject is empty after trimming", () => {
    const filter = new NotificationFilter();
    const outcome = filter.admit(makeRaw({ subject: "   " }));
    expect(outcome.kind).toBe("SkippedUnreadable");
    expect(filter.getSkipNotices()[0]!.reason).toContain("Subject");
  });
});
