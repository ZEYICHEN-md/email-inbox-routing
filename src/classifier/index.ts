/**
 * Email_Classifier abstraction, a configurable mock/stub backend, and the pure
 * classification decision function (Task 9).
 *
 * - `EmailClassifier` (interface): `classify(formMessageContent, categories)`
 *   consumes the extracted Contact Us form message content from SubmitterExtractor
 *   (NOT relay envelope metadata — Req 3.3) and returns a `ClassificationResult`
 *   with one bounded `Confidence_Score` per candidate category (Req 4.1, 4.2).
 * - `MockEmailClassifier`: an in-memory, fully configurable backend returning
 *   programmable per-category scores and reasoning strings, able to simulate a
 *   classification failure (Req 4.5) and to exclude a category from candidates
 *   for content-dependent carve-outs (e.g. the merchant-side DM cooperation
 *   exclusion of `Destination_Marketing_Other_Overseas`, Req 6.5). This keeps
 *   downstream logic and tests independent of any live AI service.
 * - `decide(result, threshold)`: the pure decision function that maps a
 *   `ClassificationResult` to a `Decision` exactly per the design pseudocode.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.5, 13.1, 13.2
 */
import type {
  Category,
  ClassificationCandidate,
  ClassificationResult,
  Confidence_Score,
  Decision,
} from "../types/index.js";

/**
 * The Email_Classifier abstraction. A single backend implements this per
 * environment (`MockEmailClassifier` for tests/local wiring; a real AI-backed
 * adapter in production). No downstream component references a concrete backend.
 */
export interface EmailClassifier {
  /**
   * Scores `formMessageContent` — the extracted Contact Us form message content
   * from SubmitterExtractor, never the relay envelope subject/sender (Req 3.3) —
   * against each candidate `Category`, producing one `Confidence_Score` per
   * scored category plus an AI-generated per-candidate reasoning string.
   */
  classify(
    formMessageContent: string,
    categories: Category[],
  ): ClassificationResult | Promise<ClassificationResult>;
}

/**
 * A per-category scoring decision produced by the mock backend for a given
 * content string. `null` EXCLUDES the category from the candidate set (used for
 * content-dependent carve-outs such as Req 6.5); otherwise the category becomes
 * a candidate with the given bounded score and reasoning.
 */
export type MockScore = { score: Confidence_Score; reasoning: string } | null;

/** Configuration for {@link MockEmailClassifier}. */
export interface MockEmailClassifierOptions {
  /** When true, `classify` simulates a classification failure (Req 4.5). */
  fail?: boolean;
  /** Failure-reason note recorded when `fail` is true. */
  failureReason?: string;
  /** Static per-category scores (used when `scorer` is not provided). */
  scores?: Record<Category, Confidence_Score>;
  /** Static per-category reasoning strings (used when `scorer` is not provided). */
  reasonings?: Record<Category, string>;
  /** Score assigned to categories absent from `scores` (defaults to 0). */
  defaultScore?: Confidence_Score;
  /**
   * Fully custom, content-aware scorer. When provided it overrides the static
   * `scores`/`defaultScore`. Return `null` to exclude a category from candidates
   * (e.g. the merchant-side DM cooperation carve-out for
   * `Destination_Marketing_Other_Overseas`, Req 6.5).
   */
  scorer?: (formMessageContent: string, category: Category) => MockScore;
}

/**
 * Configurable in-memory Email_Classifier used by downstream logic and tests so
 * nothing depends on a live AI service. Produces exactly one bounded score per
 * candidate category (Req 4.1, 4.2) and can simulate failure (Req 4.5).
 */
export class MockEmailClassifier implements EmailClassifier {
  private readonly options: MockEmailClassifierOptions;

  constructor(options: MockEmailClassifierOptions = {}) {
    this.options = options;
  }

  classify(formMessageContent: string, categories: Category[]): ClassificationResult {
    // Req 4.5 — simulated failure: no candidate scores are produced.
    if (this.options.fail) {
      return {
        candidates: [],
        failed: true,
        failureReason: this.options.failureReason ?? "classifier failed to produce scores",
      };
    }

    const candidates: ClassificationCandidate[] = [];
    for (const category of categories) {
      const scored = this.scoreCategory(formMessageContent, category);
      // `null` excludes the category from the candidate set (carve-out, Req 6.5).
      if (scored === null) continue;
      candidates.push({ category, score: scored.score, reasoning: scored.reasoning });
    }
    return { candidates };
  }

  private scoreCategory(content: string, category: Category): MockScore {
    if (this.options.scorer) {
      return this.options.scorer(content, category);
    }
    const score = this.options.scores?.[category] ?? this.options.defaultScore ?? 0;
    const reasoning =
      this.options.reasonings?.[category] ??
      `Mock reasoning for candidate category ${category} (score ${score}).`;
    return { score, reasoning };
  }
}

/**
 * The classification decision function (pure). Maps a `ClassificationResult` and
 * a `Confidence_Threshold` to a `Decision`, exactly per the design pseudocode:
 *
 *  - classifier failure OR zero qualifying candidates -> `Unclassified`
 *    (Req 4.4, 4.5);
 *  - exactly one qualifying candidate -> `SingleCategory` (Req 4.3);
 *  - two or more qualifying candidates -> `Ambiguous`, carrying the FULL
 *    qualifying candidate set (Req 13.1, 13.2).
 *
 * A candidate "qualifies" when its `score >= threshold`.
 */
export function decide(result: ClassificationResult, threshold: number): Decision {
  // Req 4.5 — classifier failure yields Unclassified with a failure-reason note.
  // A note is always recorded, even if the backend supplied an empty reason.
  if (result.failed) {
    const reason = result.failureReason?.trim();
    return {
      kind: "Unclassified",
      reasoning: reason && reason.length > 0 ? reason : "classification failed; no confident category",
    };
  }

  const qualifying = result.candidates.filter((c) => c.score >= threshold);

  // Req 4.4 — no candidate clears the threshold.
  if (qualifying.length === 0) {
    return { kind: "Unclassified", reasoning: "no candidate reached the confidence threshold" };
  }

  // Req 4.3 — exactly one qualifying candidate becomes the decided category.
  if (qualifying.length === 1) {
    const only = qualifying[0]!;
    return { kind: "SingleCategory", category: only.category, candidate: only };
  }

  // Req 13.2 — two or more qualifying candidates: ambiguous, carry them all.
  return { kind: "Ambiguous", candidates: qualifying };
}

export { LlmClient, type LlmClientConfig, type AdaApiStyle, type AdaChatCompletionResponse, type AdaMessagesResponse } from "./llmClient.js";
export {
  LlmEmailClassifier,
  parseClassifierJson,
  rawToCandidates,
  type LlmEmailClassifierOptions,
} from "./llmEmailClassifier.js";
export {
  applyClassificationCarveOuts,
  disambiguateFlightComplaint,
  disambiguateFlightVsIbu,
  disambiguateKolVsBusiness,
} from "./partnershipDisambiguation.js";
export { CATEGORY_GUIDANCE } from "./categoryGuidance.js";
