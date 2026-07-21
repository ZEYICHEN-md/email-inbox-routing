/**
 * Unit / example tests for the Email_Classifier decision logic and the
 * merchant-side DM cooperation exclusion carve-out (Task 9.6).
 *
 * Requirement 6.5 is a classifier-prompt-level carve-out (a semantic judgment),
 * NOT a Routing_Rule_Set entry: for emails describing merchant-side DM
 * cooperation, `Destination_Marketing_Other_Overseas` must be excluded from the
 * candidate set. Here the mock classifier stub is configured to reflect that
 * carve-out, and we verify the category is excluded for those example emails
 * while remaining a candidate for unrelated ones.
 *
 * Requirements: 6.5 (plus 4.1, 4.2, 4.3, 4.4, 4.5 decision-function examples)
 */
import { describe, it, expect } from "vitest";
import { MockEmailClassifier, decide, type MockScore } from "../../src/classifier/index.js";
import type { Category } from "../../src/types/index.js";

const DM_OTHER = "Destination_Marketing_Other_Overseas";
const CANDIDATE_CATEGORIES: Category[] = [
  "Business_Cooperation",
  DM_OTHER,
  "PR_Media_International",
];

/**
 * A classifier stub reflecting the Req 6.5 carve-out: when the content describes
 * merchant-side DM cooperation, exclude `Destination_Marketing_Other_Overseas`
 * from the candidate set (return null); otherwise score it normally.
 */
function carveOutScorer(content: string, category: Category): MockScore {
  const isMerchantSideDm = /merchant[- ]side dm cooperation/i.test(content);
  if (category === DM_OTHER && isMerchantSideDm) {
    return null; // excluded from candidates (Req 6.5)
  }
  if (category === "Business_Cooperation" && isMerchantSideDm) {
    return { score: 0.9, reasoning: "merchant-side DM cooperation is a business cooperation matter" };
  }
  return { score: 0.2, reasoning: `baseline score for ${category}` };
}

describe("Req 6.5 — merchant-side DM cooperation excludes Destination_Marketing_Other_Overseas", () => {
  const classifier = new MockEmailClassifier({ scorer: carveOutScorer });

  it("excludes Destination_Marketing_Other_Overseas for a merchant-side DM cooperation email", () => {
    const content =
      "We run a merchant-side DM cooperation program and want to collaborate on merchant deals.";
    const result = classifier.classify(content, CANDIDATE_CATEGORIES);

    const cats = result.candidates.map((c) => c.category);
    expect(cats).not.toContain(DM_OTHER);
    // Other candidates are still scored.
    expect(cats).toContain("Business_Cooperation");
    expect(cats).toContain("PR_Media_International");
  });

  it("routes a merchant-side DM cooperation email to Business_Cooperation, not DM_Other", () => {
    const content = "Inquiry about merchant-side DM cooperation for our hotel inventory.";
    const result = classifier.classify(content, CANDIDATE_CATEGORIES);
    const decision = decide(result, 0.5);

    expect(decision.kind).toBe("SingleCategory");
    if (decision.kind !== "SingleCategory") throw new Error("expected SingleCategory");
    expect(decision.category).toBe("Business_Cooperation");
  });

  it("keeps Destination_Marketing_Other_Overseas as a candidate for an unrelated overseas DM email", () => {
    const content =
      "We are an overseas national tourism board seeking destination marketing collaboration.";
    const result = classifier.classify(content, CANDIDATE_CATEGORIES);

    const cats = result.candidates.map((c) => c.category);
    expect(cats).toContain(DM_OTHER);
    // Every candidate has exactly one bounded score.
    for (const cand of result.candidates) {
      expect(cand.score).toBeGreaterThanOrEqual(0);
      expect(cand.score).toBeLessThanOrEqual(1);
    }
  });
});

const FLIGHT_COMPLAINT = "Flight_Complaint";
const IBU_CS = "IBU_Customer_Service";
const FLIGHT_CANDIDATES: Category[] = [FLIGHT_COMPLAINT, IBU_CS, "Domestic_Complaint"];

/**
 * Market-based: overseas/IBU → IBU_Customer_Service; mainland flight → Flight_Complaint.
 */
function flightComplaintScorer(content: string, category: Category): MockScore {
  const isOverseas =
    /Hong Kong|香港|Malaysia|\+60|Assalamualaikum|duplicate booking|North Point/i.test(
      content,
    );
  const isMainlandFlight =
    /国内|北京|上海|大陆/.test(content) && /机票|航班|flight/i.test(content);

  if (isOverseas) {
    if (category === FLIGHT_COMPLAINT) return null;
    if (category === IBU_CS) {
      return { score: 0.9, reasoning: "overseas/IBU customer complaint" };
    }
  }

  if (isMainlandFlight) {
    if (category === IBU_CS) return null;
    if (category === FLIGHT_COMPLAINT) {
      return { score: 0.95, reasoning: "mainland domestic flight complaint" };
    }
  }

  return { score: 0.2, reasoning: `baseline score for ${category}` };
}

describe("Flight_Complaint vs IBU_Customer_Service carve-out", () => {
  const classifier = new MockEmailClassifier({ scorer: flightComplaintScorer });

  it("routes overseas duplicate-booking refund to IBU, not Flight_Complaint", () => {
    const content =
      "Dear Customer Support, I request a full refund for duplicate booking. Booking Number 1433813801142346. Malaysia +6010.";
    const result = classifier.classify(content, FLIGHT_CANDIDATES);
    const decision = decide(result, 0.5);

    expect(decision.kind).toBe("SingleCategory");
    if (decision.kind !== "SingleCategory") throw new Error("expected SingleCategory");
    expect(decision.category).toBe(IBU_CS);
  });

  it("routes Hong Kong typhoon flight complaint to IBU (flight-complaints desk is domestic-only)", () => {
    const content =
      "Formal complaint about flight ticket orders from Hong Kong / North Point. Outbound flights refunded due to typhoon but return flights denied.";
    const result = classifier.classify(content, FLIGHT_CANDIDATES);
    const decision = decide(result, 0.5);

    expect(decision.kind).toBe("SingleCategory");
    if (decision.kind !== "SingleCategory") throw new Error("expected SingleCategory");
    expect(decision.category).toBe(IBU_CS);
  });

  it("routes mainland domestic flight complaint to Flight_Complaint", () => {
    const content =
      "domestic complaint queue：北京飞上海的机票被取消，要求退款。";
    const result = classifier.classify(content, FLIGHT_CANDIDATES);
    const decision = decide(result, 0.5);

    expect(decision.kind).toBe("SingleCategory");
    if (decision.kind !== "SingleCategory") throw new Error("expected SingleCategory");
    expect(decision.category).toBe(FLIGHT_COMPLAINT);
  });

  it("keeps IBU_Customer_Service as a candidate for a non-flight overseas complaint", () => {
    const content =
      "I am writing regarding my hotel booking refund. DemoCo customer service has not resolved my payment dispute.";
    const result = classifier.classify(content, FLIGHT_CANDIDATES);

    const cats = result.candidates.map((c) => c.category);
    expect(cats).toContain(IBU_CS);
  });
});

const KOL = "KOL";
const BUSINESS_COOP = "Business_Cooperation";
const PARTNERSHIP_CANDIDATES: Category[] = [KOL, BUSINESS_COOP, "PR_Media_International"];

/**
 * Audience/community-led partnerships should route to KOL, not Business_Cooperation.
 */
function kolPartnershipScorer(content: string, category: Category): MockScore {
  const isAudienceLedPartnership =
    /influencer|content creator|community[- ]led|storytelling[- ]led|discount vouchers? for (our )?(participants|followers|audience)|our audience|wellness community|travel community/i.test(
      content,
    );
  if (category === BUSINESS_COOP && isAudienceLedPartnership) {
    return null;
  }
  if (category === KOL && isAudienceLedPartnership) {
    return {
      score: 0.9,
      reasoning: "audience/community-driven collaboration with content and voucher incentives",
    };
  }
  return { score: 0.2, reasoning: `baseline score for ${category}` };
}

describe("KOL vs Business_Cooperation carve-out", () => {
  const classifier = new MockEmailClassifier({ scorer: kolPartnershipScorer });

  it("excludes Business_Cooperation for a community-led content partnership", () => {
    const content =
      "We are a wellness community developing a storytelling-led campaign. We want exclusive discount vouchers for our participants and community-led travel experiences.";
    const result = classifier.classify(content, PARTNERSHIP_CANDIDATES);

    const cats = result.candidates.map((c) => c.category);
    expect(cats).toContain(KOL);
    expect(cats).not.toContain(BUSINESS_COOP);
  });

  it("routes a community/influencer partnership to KOL, not Business_Cooperation", () => {
    const content =
      "Our travel community wants to partner through engaging content and discount vouchers for our audience.";
    const result = classifier.classify(content, PARTNERSHIP_CANDIDATES);
    const decision = decide(result, 0.5);

    expect(decision.kind).toBe("SingleCategory");
    if (decision.kind !== "SingleCategory") throw new Error("expected SingleCategory");
    expect(decision.category).toBe(KOL);
  });

  it("keeps Business_Cooperation as a candidate for a B2B venture/platform partnership", () => {
    const content =
      "We are a venture studio seeking a B2B market-entry partnership to integrate our e-commerce platform with DemoCo in our country.";
    const result = classifier.classify(content, PARTNERSHIP_CANDIDATES);

    const cats = result.candidates.map((c) => c.category);
    expect(cats).toContain(BUSINESS_COOP);
  });
});
