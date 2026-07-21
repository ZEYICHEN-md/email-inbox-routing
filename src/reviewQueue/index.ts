/**
 * Review_Queue (Task 13): storage and enqueue for emails that need human review.
 *
 * Emails enter the Review_Queue for exactly these reasons:
 *   - `UNCLASSIFIED`               — no confident category (Req 13.1)
 *   - `AMBIGUOUS`                  — two or more categories cleared the threshold
 *                                    (Req 13.2); every qualifying candidate is
 *                                    stored with its score and a non-empty
 *                                    AI-generated reasoning note
 *   - `REVIEW_REQUIRED_CATEGORY`   — a category configured as review-required,
 *                                    e.g. Business_Travel_Flight_Distribution (Req 9.3)
 *   - `READ_ERROR`                 — the email could not be read/parsed (Req 1.3)
 *   - `FORWARD_FAILED`             — native forward delivery failed (Req 14.3)
 *
 * Submitter-extraction failure is NOT a review reason — it is non-blocking per
 * Req 3.5 (the Audit_Log simply records the submitter as "unavailable").
 *
 * Requirements: 1.3, 9.3, 13.1, 13.2
 */
import type {
  ClassificationCandidate,
  ForwardedEmail,
  ReviewQueueItem,
  ReviewReason,
} from "../types/index.js";

/** Raised when an AMBIGUOUS item is enqueued without valid candidate data. */
export class ReviewQueueValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewQueueValidationError";
  }
}

/**
 * In-memory Review_Queue. Holds {@link ReviewQueueItem}s in enqueue order and
 * exposes read helpers for the reviewer UI / tests.
 */
export class ReviewQueue {
  private readonly items: ReviewQueueItem[] = [];

  /**
   * Enqueues an email for human review under `reason`. For `AMBIGUOUS` items,
   * `candidates` must be provided and non-empty, and every candidate must carry
   * a non-empty AI-generated reasoning note (Req 13.2). For all other reasons,
   * `candidates` is ignored (left undefined on the stored item).
   */
  enqueue(
    email: ForwardedEmail,
    reason: ReviewReason,
    candidates?: ClassificationCandidate[],
  ): ReviewQueueItem {
    if (reason === "AMBIGUOUS") {
      if (candidates === undefined || candidates.length === 0) {
        throw new ReviewQueueValidationError(
          "AMBIGUOUS review items must include at least one qualifying candidate.",
        );
      }
      for (const candidate of candidates) {
        if (candidate.reasoning === undefined || candidate.reasoning.trim().length === 0) {
          throw new ReviewQueueValidationError(
            `AMBIGUOUS candidate "${candidate.category}" must carry a non-empty reasoning note.`,
          );
        }
      }
      const item: ReviewQueueItem = {
        email,
        reason,
        // Store every qualifying candidate with its score + reasoning (Req 13.2).
        candidates: candidates.map((c) => ({ ...c })),
      };
      this.items.push(item);
      return item;
    }

    const item: ReviewQueueItem = { email, reason };
    this.items.push(item);
    return item;
  }

  /** All queued items, in enqueue order. */
  getItems(): readonly ReviewQueueItem[] {
    return this.items;
  }

  /** The number of items currently in the queue. */
  size(): number {
    return this.items.length;
  }
}
