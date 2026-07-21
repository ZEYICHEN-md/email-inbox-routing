/**
 * Property-based tests for the Email_Classifier and decision function
 * (Task 9.2, 9.4, 9.5).
 *
 * Feature: email-inbox-routing
 *   - Property 3: Classifier produces one bounded score per candidate category
 *     (Validates: Requirements 4.1, 4.2)
 *   - Property 4: Single qualifying candidate becomes the decided category
 *     (Validates: Requirements 4.3)
 *   - Property 5: No qualifying candidates (or classifier failure) yields
 *     Unclassified (Validates: Requirements 4.4, 4.5)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { MockEmailClassifier, decide } from "../../src/classifier/index.js";
import type { Category, ClassificationResult } from "../../src/types/index.js";

const NUM_RUNS = 200;

/** A non-empty list of distinct candidate category names. */
const categoriesArb: fc.Arbitrary<Category[]> = fc.uniqueArray(
  fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,20}$/),
  { minLength: 1, maxLength: 12 },
);

/** A bounded confidence score in [0, 1]. */
const scoreArb = fc.double({ min: 0, max: 1, noNaN: true });

// --- Property 3 ------------------------------------------------------------

describe("Property 3: one bounded score per candidate category", () => {
  it("produces exactly one score in [0,1] per candidate category", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 60 }),
        categoriesArb,
        fc.dictionary(fc.string(), scoreArb),
        (content, categories, rawScores) => {
          // Assign each category a bounded score (from the dictionary or default).
          const scores: Record<Category, number> = {};
          for (const c of categories) {
            scores[c] = rawScores[c] ?? 0.3;
          }
          const classifier = new MockEmailClassifier({ scores, defaultScore: 0.0 });

          const result = classifier.classify(content, categories);

          // Exactly one candidate per category, no more, no fewer.
          expect(result.candidates).toHaveLength(categories.length);
          expect(result.candidates.map((c) => c.category).sort()).toEqual([...categories].sort());
          // No category scored more than once.
          expect(new Set(result.candidates.map((c) => c.category)).size).toBe(categories.length);

          // Every score is within [0, 1] inclusive.
          for (const cand of result.candidates) {
            expect(cand.score).toBeGreaterThanOrEqual(0);
            expect(cand.score).toBeLessThanOrEqual(1);
            expect(typeof cand.reasoning).toBe("string");
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 4 ------------------------------------------------------------

describe("Property 4: single qualifying candidate becomes the decided category", () => {
  it("decides SingleCategory when exactly one candidate is >= threshold", () => {
    fc.assert(
      fc.property(
        categoriesArb,
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.nat(),
        (categories, threshold, pickSeed) => {
          const winnerIndex = pickSeed % categories.length;
          const winner = categories[winnerIndex]!;

          // The winner scores at/above threshold; everyone else strictly below.
          const scorer = (_content: string, category: Category) => {
            const score = category === winner ? threshold : threshold / 2;
            return { score, reasoning: `mock ${category}` };
          };
          const classifier = new MockEmailClassifier({ scorer });
          const result = classifier.classify("some content", categories);

          const decision = decide(result, threshold);

          // Exactly one qualifies -> SingleCategory with that category.
          expect(decision.kind).toBe("SingleCategory");
          if (decision.kind !== "SingleCategory") throw new Error("expected SingleCategory");
          expect(decision.category).toBe(winner);
          expect(decision.candidate.score).toBeGreaterThanOrEqual(threshold);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 5 ------------------------------------------------------------

describe("Property 5: no qualifying candidates or classifier failure yields Unclassified", () => {
  it("decides Unclassified when every candidate is strictly below threshold", () => {
    fc.assert(
      fc.property(
        categoriesArb,
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        (categories, threshold) => {
          // Every category scores strictly below the threshold.
          const scorer = (_content: string, category: Category) => ({
            score: threshold - 0.05 < 0 ? 0 : threshold - 0.05,
            reasoning: `below ${category}`,
          });
          const classifier = new MockEmailClassifier({ scorer });
          const result = classifier.classify("content", categories);

          const decision = decide(result, threshold);
          expect(decision.kind).toBe("Unclassified");
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("decides Unclassified when the classifier fails to produce any scores", () => {
    fc.assert(
      fc.property(
        categoriesArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.string({ maxLength: 30 }),
        (categories, threshold, reason) => {
          const classifier = new MockEmailClassifier({ fail: true, failureReason: reason });
          const result: ClassificationResult = classifier.classify("content", categories);

          expect(result.failed).toBe(true);
          const decision = decide(result, threshold);
          expect(decision.kind).toBe("Unclassified");
          if (decision.kind !== "Unclassified") throw new Error("expected Unclassified");
          // A failure-reason note is carried on the decision (Req 4.5).
          expect(decision.reasoning.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
