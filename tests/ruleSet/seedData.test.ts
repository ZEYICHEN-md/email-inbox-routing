/**
 * Unit tests for the compact demo Routing_Rule_Set seed data.
 */
import { describe, it, expect } from "vitest";
import { SEED_RULE_ENTRIES, SEED_EFFECTIVE_FROM } from "../../src/ruleSet/index.js";
import type { RuleBehavior } from "../../src/types/index.js";

interface Expected {
  behavior: RuleBehavior;
  recipients: string[];
  guidanceNote?: string;
}

const EXPECTED: Record<string, Expected> = {
  IBU_Customer_Service: { behavior: "FORWARD", recipients: ["intl-support@example.com"] },
  Domestic_Complaint: {
    behavior: "FORWARD",
    recipients: ["domestic-support@example.com", "domestic-support-lead@example.com"],
  },
  Flight_Complaint: { behavior: "FORWARD", recipients: ["flight-complaints@example.com"] },
  PR_Media_International: { behavior: "FORWARD", recipients: ["pr-media@example.com"] },
  KOL: { behavior: "FORWARD", recipients: ["influencer-marketing@example.com"] },
  Business_Cooperation: { behavior: "FORWARD", recipients: ["partnerships@example.com"] },
  Partner_Business_Referral: {
    behavior: "NO_FORWARD_RESOLVE",
    recipients: [],
    guidanceNote: "https://example.com/partners",
  },
  Needs_Manual_Review: { behavior: "NO_FORWARD_REVIEW", recipients: [] },
};

describe("Routing_Rule_Set seed data (demo taxonomy)", () => {
  const byCategory = new Map(SEED_RULE_ENTRIES.map((e) => [e.category, e]));

  it("seeds exactly the expected set of categories (no extras, none missing)", () => {
    expect(new Set(byCategory.keys())).toEqual(new Set(Object.keys(EXPECTED)));
    expect(byCategory.has("Unclassified")).toBe(false);
  });

  it("has no duplicate category rows", () => {
    expect(SEED_RULE_ENTRIES.length).toBe(byCategory.size);
  });

  for (const [category, expected] of Object.entries(EXPECTED)) {
    it(`seeds ${category} with the exact behavior/recipients/guidanceNote`, () => {
      const entry = byCategory.get(category);
      expect(entry, `missing seed entry for ${category}`).toBeDefined();
      expect(entry!.behavior).toBe(expected.behavior);
      expect(entry!.recipients).toEqual(expected.recipients);
      expect(entry!.guidanceNote).toBe(expected.guidanceNote);
      expect(entry!.effectiveFrom).toBe(SEED_EFFECTIVE_FROM);
    });
  }

  it("covers all three routing behaviors", () => {
    const behaviors = new Set(SEED_RULE_ENTRIES.map((e) => e.behavior));
    expect(behaviors).toEqual(
      new Set(["FORWARD", "NO_FORWARD_RESOLVE", "NO_FORWARD_REVIEW"]),
    );
  });
});
