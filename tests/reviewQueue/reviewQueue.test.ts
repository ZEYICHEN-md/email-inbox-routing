/**
 * Unit tests for the Review_Queue (Task 13.1).
 *
 * Verifies enqueue behavior for each valid reason, that AMBIGUOUS items store
 * every qualifying candidate with a non-empty reasoning note, and that
 * submitter-extraction failure is not a review reason (it is simply absent from
 * the ReviewReason set — non-blocking per Req 3.5).
 *
 * Requirements: 1.3, 9.3, 13.1, 13.2
 */
import { describe, it, expect } from "vitest";
import { ReviewQueue, ReviewQueueValidationError } from "../../src/reviewQueue/index.js";
import type { ClassificationCandidate, ForwardedEmail } from "../../src/types/index.js";
import { EXPECTED_SENDER, EXPECTED_SUBJECT } from "../../src/notificationFilter/index.js";

function makeEmail(id: string): ForwardedEmail {
  return {
    messageId: id,
    relayEnvelopeSender: EXPECTED_SENDER,
    submitterEmail: "unavailable",
    subject: EXPECTED_SUBJECT,
    body: "body",
    formMessageContent: "body",
    attachments: [],
    receivedAt: 0,
  };
}

describe("ReviewQueue enqueue", () => {
  it("enqueues UNCLASSIFIED, REVIEW_REQUIRED_CATEGORY, READ_ERROR, FORWARD_FAILED without candidates", () => {
    const queue = new ReviewQueue();
    queue.enqueue(makeEmail("a"), "UNCLASSIFIED");
    queue.enqueue(makeEmail("b"), "REVIEW_REQUIRED_CATEGORY");
    queue.enqueue(makeEmail("c"), "READ_ERROR");
    queue.enqueue(makeEmail("d"), "FORWARD_FAILED");

    expect(queue.size()).toBe(4);
    for (const item of queue.getItems()) {
      expect(item.candidates).toBeUndefined();
    }
    expect(queue.getItems().map((i) => i.reason)).toEqual([
      "UNCLASSIFIED",
      "REVIEW_REQUIRED_CATEGORY",
      "READ_ERROR",
      "FORWARD_FAILED",
    ]);
  });

  it("stores every qualifying candidate with score and non-empty reasoning for AMBIGUOUS", () => {
    const queue = new ReviewQueue();
    const candidates: ClassificationCandidate[] = [
      { category: "Investment", score: 0.8, reasoning: "mentions equity investment" },
      { category: "Business_Cooperation", score: 0.75, reasoning: "mentions partnership" },
    ];

    const item = queue.enqueue(makeEmail("e"), "AMBIGUOUS", candidates);

    expect(item.reason).toBe("AMBIGUOUS");
    expect(item.candidates).toHaveLength(2);
    for (const c of item.candidates!) {
      expect(c.reasoning.length).toBeGreaterThan(0);
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
    // Stored candidates are copies, not aliases of the input array.
    expect(item.candidates).not.toBe(candidates);
  });

  it("rejects an AMBIGUOUS enqueue with no candidates", () => {
    const queue = new ReviewQueue();
    expect(() => queue.enqueue(makeEmail("f"), "AMBIGUOUS")).toThrow(ReviewQueueValidationError);
    expect(() => queue.enqueue(makeEmail("f"), "AMBIGUOUS", [])).toThrow(ReviewQueueValidationError);
    expect(queue.size()).toBe(0);
  });

  it("rejects an AMBIGUOUS candidate with an empty reasoning note", () => {
    const queue = new ReviewQueue();
    const candidates: ClassificationCandidate[] = [
      { category: "Investment", score: 0.8, reasoning: "ok" },
      { category: "ESG", score: 0.7, reasoning: "   " },
    ];
    expect(() => queue.enqueue(makeEmail("g"), "AMBIGUOUS", candidates)).toThrow(
      ReviewQueueValidationError,
    );
    expect(queue.size()).toBe(0);
  });
});
