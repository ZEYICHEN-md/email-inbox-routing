import { describe, it, expect } from "vitest";
import { parseClassifierJson, rawToCandidates } from "../../src/classifier/llmEmailClassifier.js";

describe("parseClassifierJson", () => {
  it("parses bare JSON", () => {
    const raw = parseClassifierJson(
      '{"scores":[{"category":"Domestic_Complaint","score":0.9,"reasoning":"hotel complaint"}]}',
    );
    expect(raw.scores).toHaveLength(1);
  });

  it("parses JSON inside markdown fences", () => {
    const raw = parseClassifierJson(
      '```json\n{"scores":[{"category":"Business_Cooperation","score":0.8,"reasoning":"b2b deal"}]}\n```',
    );
    expect(raw.scores[0]!.category).toBe("Business_Cooperation");
  });
});

describe("rawToCandidates", () => {
  it("clamps scores and skips excluded categories", () => {
    const candidates = rawToCandidates(
      {
        scores: [
          { category: "Business_Cooperation", score: 1.5, reasoning: "high" },
          {
            category: "KOL",
            score: 0.9,
            reasoning: "excluded",
            exclude: true,
          },
          { category: "Unknown", score: 0.5, reasoning: "skip" },
        ],
      },
      ["Business_Cooperation", "KOL"],
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.category).toBe("Business_Cooperation");
    expect(candidates[0]!.score).toBe(1);
  });
});
