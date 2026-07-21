import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  applyClassificationCarveOuts,
  decide,
  disambiguateFlightComplaint,
  disambiguateFlightVsIbu,
  disambiguateKolVsBusiness,
} from "../../src/classifier/index.js";
import type { ClassificationCandidate, ClassificationResult } from "../../src/types/index.js";

function candidates(...entries: ClassificationCandidate[]): ClassificationResult {
  return { candidates: entries };
}

const KOL_CANDIDATE: ClassificationCandidate = {
  category: "KOL",
  score: 0.72,
  reasoning: "community partnership",
};
const BUSINESS_CANDIDATE: ClassificationCandidate = {
  category: "Business_Cooperation",
  score: 0.68,
  reasoning: "partnership inquiry",
};
const FLIGHT_CANDIDATE: ClassificationCandidate = {
  category: "Flight_Complaint",
  score: 0.82,
  reasoning: "flight refund dispute",
};
const IBU_CANDIDATE: ClassificationCandidate = {
  category: "IBU_Customer_Service",
  score: 0.78,
  reasoning: "overseas customer complaint",
};
const DOMESTIC_CANDIDATE: ClassificationCandidate = {
  category: "Domestic_Complaint",
  score: 0.65,
  reasoning: "mainland complaint",
};

describe("disambiguateFlightVsIbu", () => {
  it("prefers IBU for overseas duplicate-booking refund (Nuruddin / Malaysia)", () => {
    const text = readFileSync(resolve("fixtures/nuruddin-duplicate-booking.txt"), "utf8");
    const result = disambiguateFlightVsIbu(text, [FLIGHT_CANDIDATE, IBU_CANDIDATE]);

    expect(result.map((c) => c.category)).toEqual(["IBU_Customer_Service"]);
  });

  it("prefers IBU for Hong Kong typhoon flight complaint (Carmen) — flight-complaints desk is domestic-only", () => {
    const text = readFileSync(resolve("fixtures/carmen-flight-complaint.txt"), "utf8");
    const result = disambiguateFlightVsIbu(text, [FLIGHT_CANDIDATE, IBU_CANDIDATE]);

    expect(result.map((c) => c.category)).toEqual(["IBU_Customer_Service"]);
  });

  it("prefers Flight_Complaint for mainland domestic flight complaints", () => {
    const text =
      "国内订单机票投诉：我在上海预订的国内航班被取消，要求全额退款。订单编号 123。";
    const result = disambiguateFlightVsIbu(text, [FLIGHT_CANDIDATE, IBU_CANDIDATE]);

    expect(result.map((c) => c.category)).toEqual(["Flight_Complaint"]);
  });

  it("does not intervene when only one category qualifies at threshold", () => {
    const text = readFileSync(resolve("fixtures/nuruddin-duplicate-booking.txt"), "utf8");
    const result = disambiguateFlightVsIbu(text, [
      { ...FLIGHT_CANDIDATE, score: 0.45 },
      IBU_CANDIDATE,
    ]);

    expect(result).toHaveLength(2);
  });
});

describe("disambiguateFlightComplaint", () => {
  it("routes Carmen (Hong Kong) to IBU, dropping Flight and Domestic", () => {
    const text = readFileSync(resolve("fixtures/carmen-flight-complaint.txt"), "utf8");
    const result = disambiguateFlightComplaint(text, [
      FLIGHT_CANDIDATE,
      IBU_CANDIDATE,
      DOMESTIC_CANDIDATE,
    ]);

    expect(result.map((c) => c.category)).toEqual(["IBU_Customer_Service"]);
  });

  it("prefers Flight over Domestic for mainland flight complaints", () => {
    const text =
      "domestic complaint queue：北京飞上海的机票退款被拒，要求升级处理。";
    const result = disambiguateFlightComplaint(text, [FLIGHT_CANDIDATE, DOMESTIC_CANDIDATE]);

    expect(result.map((c) => c.category)).toEqual(["Flight_Complaint"]);
  });
});

describe("disambiguateKolVsBusiness", () => {
  it("drops Business_Cooperation for a travel community with member vouchers and content", () => {
    const text = readFileSync(
      resolve("fixtures/beyond-the-mat-kol-partnership.txt"),
      "utf8",
    );
    const result = disambiguateKolVsBusiness(text, [KOL_CANDIDATE, BUSINESS_CANDIDATE]);

    expect(result.map((c) => c.category)).toEqual(["KOL"]);
  });

  it("drops KOL for a venture-studio B2B partnership inquiry", () => {
    const text = readFileSync(resolve("fixtures/namuun-partnership.txt"), "utf8");
    const result = disambiguateKolVsBusiness(text, [KOL_CANDIDATE, BUSINESS_CANDIDATE]);

    expect(result.map((c) => c.category)).toEqual(["Business_Cooperation"]);
  });

  it("keeps both candidates when signals conflict", () => {
    const text =
      "Our travel community also runs an e-commerce platform and seeks venture-studio style distribution partnership with API integration.";
    const result = disambiguateKolVsBusiness(text, [KOL_CANDIDATE, BUSINESS_CANDIDATE]);

    expect(result).toHaveLength(2);
  });
});

describe("applyClassificationCarveOuts", () => {
  it("turns ambiguous Nuruddin into SingleCategory IBU_Customer_Service", () => {
    const text = readFileSync(resolve("fixtures/nuruddin-duplicate-booking.txt"), "utf8");
    const resolved = applyClassificationCarveOuts(
      text,
      candidates(FLIGHT_CANDIDATE, IBU_CANDIDATE),
    );
    const decision = decide(resolved, 0.5);

    expect(decision.kind).toBe("SingleCategory");
    if (decision.kind !== "SingleCategory") throw new Error("expected SingleCategory");
    expect(decision.category).toBe("IBU_Customer_Service");
  });

  it("turns ambiguous Carmen into SingleCategory IBU_Customer_Service", () => {
    const text = readFileSync(resolve("fixtures/carmen-flight-complaint.txt"), "utf8");
    const resolved = applyClassificationCarveOuts(
      text,
      candidates(FLIGHT_CANDIDATE, IBU_CANDIDATE, DOMESTIC_CANDIDATE),
    );
    const decision = decide(resolved, 0.5);

    expect(decision.kind).toBe("SingleCategory");
    if (decision.kind !== "SingleCategory") throw new Error("expected SingleCategory");
    expect(decision.category).toBe("IBU_Customer_Service");
  });

  it("turns an ambiguous Beyond The Mat classification into SingleCategory KOL", () => {
    const text = readFileSync(
      resolve("fixtures/beyond-the-mat-kol-partnership.txt"),
      "utf8",
    );
    const resolved = applyClassificationCarveOuts(
      text,
      candidates(KOL_CANDIDATE, BUSINESS_CANDIDATE),
    );
    const decision = decide(resolved, 0.5);

    expect(decision.kind).toBe("SingleCategory");
    if (decision.kind !== "SingleCategory") throw new Error("expected SingleCategory");
    expect(decision.category).toBe("KOL");
  });
});
