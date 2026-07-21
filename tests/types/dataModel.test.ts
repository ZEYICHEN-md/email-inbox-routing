import { describe, it, expect } from "vitest";
import {
  UNAVAILABLE,
  UNCLASSIFIED,
  type RawInboxEmail,
  type ForwardedEmail,
  type RuleEntry,
  type ClassificationResult,
  type Decision,
  type RoutingOutcome,
  type AuditLogEntry,
  type ReviewQueueItem,
} from "../../src/types/index.js";

describe("core data models", () => {
  it("constructs a RawInboxEmail with nullable from/subject and required fields", () => {
    const raw: RawInboxEmail = {
      messageId: "m-1",
      from: null,
      subject: null,
      body: "hello",
      attachments: [],
      receivedAt: 1_000,
    };
    expect(raw.from).toBeNull();
    expect(raw.subject).toBeNull();
    expect(raw.messageId).toBe("m-1");
    expect(raw.body).toBe("hello");
    expect(raw.attachments).toEqual([]);
    expect(raw.receivedAt).toBe(1_000);
  });

  it("constructs an enriched ForwardedEmail with all design fields", () => {
    const email: ForwardedEmail = {
      messageId: "m-2",
      relayEnvelopeSender: "noreply@forms.example.com",
      submitterEmail: UNAVAILABLE,
      subject: "[External] New Contact Us submission for DemoCo Inc.",
      body: "full body",
      formMessageContent: "the form message",
      attachments: [{ filename: "a.pdf", contentBytes: new Uint8Array([1, 2, 3]) }],
      receivedAt: 2_000,
    };
    expect(email.submitterEmail).toBe("unavailable");
    expect(email.relayEnvelopeSender).toBe("noreply@forms.example.com");
    expect(email.formMessageContent).toBe("the form message");
    expect(email.attachments[0]!.filename).toBe("a.pdf");
  });

  it("constructs a RuleEntry with behavior, recipients, guidance, and versioning", () => {
    const rule: RuleEntry = {
      category: "Domestic_Complaint",
      behavior: "FORWARD",
      recipients: ["domestic-support@example.com", "domestic-support-lead@example.com"],
      effectiveFrom: 0,
    };
    expect(rule.behavior).toBe("FORWARD");
    expect(rule.recipients).toHaveLength(2);
  });

  it("constructs a ClassificationResult with per-candidate reasoning", () => {
    const result: ClassificationResult = {
      candidates: [{ category: "ESG", score: 0.9, reasoning: "mentions sustainability" }],
    };
    expect(result.candidates[0]!.reasoning).toBe("mentions sustainability");
    expect(result.candidates[0]!.score).toBe(0.9);
  });

  it("supports all Decision variants", () => {
    const unclassified: Decision = { kind: "Unclassified", reasoning: "no confident category" };
    const single: Decision = {
      kind: "SingleCategory",
      category: "ESG",
      candidate: { category: "ESG", score: 0.9, reasoning: "r" },
    };
    const ambiguous: Decision = {
      kind: "Ambiguous",
      candidates: [
        { category: "ESG", score: 0.8, reasoning: "r1" },
        { category: "KOL", score: 0.85, reasoning: "r2" },
      ],
    };
    expect(unclassified.kind).toBe("Unclassified");
    expect(single.kind).toBe("SingleCategory");
    expect(ambiguous.kind).toBe("Ambiguous");
  });

  it("supports all RoutingOutcome variants", () => {
    const outcomes: RoutingOutcome[] = [
      { kind: "Forwarded", recipients: ["a@example.com"], forwardedAt: 1 },
      { kind: "NoForwardResolved", guidanceNote: "https://example.com/partners" },
      { kind: "SentToReview" },
      { kind: "ForwardFailed", attemptedRecipients: ["a@example.com"], error: "smtp 550" },
    ];
    expect(outcomes.map((o) => o.kind)).toEqual([
      "Forwarded",
      "NoForwardResolved",
      "SentToReview",
      "ForwardFailed",
    ]);
  });

  it("constructs an AuditLogEntry with submitterEmail, finalCategoryReasoning and candidate reasoning", () => {
    const entry: AuditLogEntry = {
      emailId: "m-3",
      submitterEmail: "real.person@example.com",
      candidates: [{ category: "ESG", score: 0.9, reasoning: "candidate reasoning" }],
      finalCategory: "ESG",
      finalCategoryReasoning: "final category reasoning",
      decidedAt: 5_000,
      outcome: "FORWARDED",
      recipients: ["esg@example.com"],
      forwardedAt: 5_100,
    };
    expect(entry.submitterEmail).toBe("real.person@example.com");
    expect(entry.finalCategoryReasoning).toBe("final category reasoning");
    expect(entry.candidates[0]!.reasoning).toBe("candidate reasoning");
    expect(entry.outcome).toBe("FORWARDED");
  });

  it("records the unavailable marker on an AuditLogEntry when submitter is unextractable", () => {
    const entry: AuditLogEntry = {
      emailId: "m-4",
      submitterEmail: UNAVAILABLE,
      candidates: [],
      finalCategory: UNCLASSIFIED,
      finalCategoryReasoning: "no confident category",
      decidedAt: 6_000,
      outcome: "REVIEW_QUEUE",
    };
    expect(entry.submitterEmail).toBe("unavailable");
    expect(entry.finalCategory).toBe("Unclassified");
  });

  it("constructs a ReviewQueueItem with candidates for the ambiguous case", () => {
    const email: ForwardedEmail = {
      messageId: "m-5",
      relayEnvelopeSender: "noreply@forms.example.com",
      submitterEmail: UNAVAILABLE,
      subject: "s",
      body: "b",
      formMessageContent: "f",
      attachments: [],
      receivedAt: 7_000,
    };
    const item: ReviewQueueItem = {
      email,
      reason: "AMBIGUOUS",
      candidates: [
        { category: "ESG", score: 0.8, reasoning: "r1" },
        { category: "KOL", score: 0.82, reasoning: "r2" },
      ],
    };
    expect(item.reason).toBe("AMBIGUOUS");
    expect(item.candidates).toHaveLength(2);
  });
});
