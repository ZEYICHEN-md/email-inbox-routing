/**
 * Production Email_Classifier backed by an OpenAI-compatible chat API.
 */
import type { Category, ClassificationCandidate, ClassificationResult } from "../types/index.js";
import { LlmClient } from "./llmClient.js";
import { CATEGORY_GUIDANCE } from "./categoryGuidance.js";

export interface LlmEmailClassifierOptions {
  client: LlmClient;
  /** Max tokens for the classification response. */
  maxTokens?: number;
}

interface RawScoreEntry {
  category: string;
  score: number;
  reasoning: string;
  exclude?: boolean;
}

interface RawClassifierOutput {
  scores: RawScoreEntry[];
}

const SYSTEM_PROMPT = `You are an email classifier for DemoCo public contact-form submissions.
Score each category by how well the form message matches it.
Rules:
- Return ONLY valid JSON, no markdown fences.
- "score" must be a number from 0.0 to 1.0 (confidence).
- "reasoning" must be a brief non-empty string for every scored category.
- Set "exclude": true (and omit score) when a category must NOT be a candidate.
- CRITICAL: Merchant-side commercial / distribution deals → Business_Cooperation (not KOL or PR_Media_International).
- CRITICAL: News/media outlets asking about sponsored articles, rate cards, media kits, editorial services, or publication partnerships → score PR_Media_International highly; do NOT route those to Business_Cooperation unless it is clearly a non-media commercial deal.
- CRITICAL (Flight_Complaint vs IBU vs Domestic): Split by market, NOT by complaint tone.
  (a) Overseas / international / Hong Kong / Macau / Taiwan / any non-mainland customer or order → IBU_Customer_Service, even if the message is a flight refund, weather disruption, or formal complaint. Score Flight_Complaint ≤0.35 and Domestic_Complaint ≤0.35.
  (b) Mainland domestic flight-ticket complaints → Flight_Complaint.
  (c) Mainland non-flight complaints → Domestic_Complaint.
  (d) If market is unclear, score IBU and Domestic/Flight both and note the conflict.
- CRITICAL (KOL vs Business_Cooperation): Determine the sender's PRIMARY value proposition before scoring:
  (a) Audience/community/content-led — vouchers for participants/followers, storytelling campaigns, community travel, curated group journeys → score KOL ≥0.85; score Business_Cooperation ≤0.35. The word "partnership" alone does NOT imply Business_Cooperation.
  (b) Company/platform B2B integration — distribution, merchant onboarding, venture/market-entry, agency/platform deals → score Business_Cooperation highly; set exclude:true for KOL.
  (c) Gray-zone travel/wellness communities with curated journeys or member benefits: default to marketing-led routing → KOL, even if partnership language is present.
  (d) If both signal types appear with similar strength, score both but note the conflict — do not force a single winner.
- Only use category IDs exactly as listed.`;


function buildUserPrompt(formMessageContent: string, categories: Category[]): string {
  const lines = categories.map((cat) => {
    const guidance = CATEGORY_GUIDANCE[cat] ?? cat;
    return `- ${cat}: ${guidance}`;
  });

  return `Classify this Contact Us form message into the categories below.

Categories:
${lines.join("\n")}

Form message:
"""
${formMessageContent}
"""

Respond with JSON only:
{"scores":[{"category":"<id>","score":0.0,"reasoning":"..."}]}
Omit excluded categories entirely, or use {"category":"<id>","exclude":true,"reasoning":"..."}.`;
}

/** Parses model JSON, tolerating optional markdown code fences. */
export function parseClassifierJson(text: string): RawClassifierOutput {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenced ? fenced[1]!.trim() : trimmed;
  const parsed = JSON.parse(jsonText) as RawClassifierOutput;
  if (!Array.isArray(parsed.scores)) {
    throw new Error("Classifier response missing scores array");
  }
  return parsed;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score));
}

/** Maps parsed model output to bounded classification candidates. */
export function rawToCandidates(
  raw: RawClassifierOutput,
  requested: Category[],
): ClassificationCandidate[] {
  const requestedSet = new Set(requested);
  const candidates: ClassificationCandidate[] = [];

  for (const entry of raw.scores) {
    if (!requestedSet.has(entry.category)) continue;
    if (entry.exclude === true) continue;
    const reasoning = entry.reasoning?.trim() || `Score for ${entry.category}`;
    candidates.push({
      category: entry.category,
      score: clampScore(entry.score),
      reasoning,
    });
  }

  return candidates;
}

export class LlmEmailClassifier {
  private readonly client: LlmClient;
  private readonly maxTokens: number;

  constructor(options: LlmEmailClassifierOptions) {
    this.client = options.client;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async classify(
    formMessageContent: string,
    categories: Category[],
  ): Promise<ClassificationResult> {
    try {
      const text = await this.client.createMessage(
        [{ role: "user", content: buildUserPrompt(formMessageContent, categories) }],
        { maxTokens: this.maxTokens, system: SYSTEM_PROMPT },
      );
      const raw = parseClassifierJson(text);
      const candidates = rawToCandidates(raw, categories);
      return { candidates };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        candidates: [],
        failed: true,
        failureReason: message,
      };
    }
  }
}
