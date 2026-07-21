/**
 * Unit / example tests for the Email_Classifier decision logic and carve-outs.
 */
import { describe, it, expect } from "vitest";
import { MockEmailClassifier, decide, type MockScore } from "../../src/classifier/index.js";
import type { Category } from "../../src/types/index.js";

const PARTNERSHIP_CATEGORIES: Category[] = ["Business_Cooperation", "KOL", "PR_Media_International"];

/** Mock carve-out: B2B platform deals exclude KOL; community campaigns prefer KOL. */
function partnershipScorer(content: string, category: Category): MockScore {
  const isB2b = /B2B|platform integration|merchant onboarding/i.test(content);
  const isKol = /wellness community|discount vouchers|followers/i.test(content);

  if (isB2b) {
    if (category === "KOL") return null;
    if (category === "Business_Cooperation") {
      return { score: 0.92, reasoning: "B2B commercial integration" };
    }
  }
  if (isKol) {
    if (category === "Business_Cooperation") return { score: 0.25, reasoning: "partnership wording only" };
    if (category === "KOL") {
      return { score: 0.9, reasoning: "audience/community-led campaign" };
    }
  }
  return { score: 0.2, reasoning: `baseline score for ${category}` };
}

describe("KOL vs Business_Cooperation carve-out (mock)", () => {
  const classifier = new MockEmailClassifier({ scorer: partnershipScorer });

  it("routes B2B platform integration to Business_Cooperation and excludes KOL", () => {
    const content = "We want B2B platform integration and merchant onboarding for our agency.";
    const result = classifier.classify(content, PARTNERSHIP_CATEGORIES);
    expect(result.candidates.map((c) => c.category)).not.toContain("KOL");
    const decision = decide(result, 0.5);
    expect(decision.kind).toBe("SingleCategory");
    if (decision.kind === "SingleCategory") {
      expect(decision.category).toBe("Business_Cooperation");
    }
  });

  it("routes community voucher campaigns to KOL", () => {
    const content =
      "Our wellness community would love discount vouchers for followers on curated journeys.";
    const result = classifier.classify(content, PARTNERSHIP_CATEGORIES);
    const decision = decide(result, 0.5);
    expect(decision.kind).toBe("SingleCategory");
    if (decision.kind === "SingleCategory") {
      expect(decision.category).toBe("KOL");
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
