/**
 * Task 2.2 — Unit test for the demo category table mapping seed data.
 *
 * Verifies every category's seeded `behavior`, `recipients`, and `guidanceNote`
 * literally match the demo category table / the the design notes Routing_Rule_Set table.
 *
 * Requirements: 16.1
 */
import { describe, it, expect } from "vitest";
import { SEED_RULE_ENTRIES, SEED_EFFECTIVE_FROM } from "../../src/ruleSet/index.js";
import type { RuleBehavior } from "../../src/types/index.js";

/**
 * The authoritative expected table, transcribed from the design notes's
 * Routing_Rule_Set section (sourced from the demo category table).
 */
interface Expected {
  behavior: RuleBehavior;
  recipients: string[];
  guidanceNote?: string;
}

const EXPECTED: Record<string, Expected> = {
  // Requirement 5 — complaints
  IBU_Customer_Service: { behavior: "FORWARD", recipients: ["intl-support@example.com"] },
  Domestic_Complaint: { behavior: "FORWARD", recipients: ["domestic-support@example.com", "domestic-support-lead@example.com"] },
  Flight_Complaint: { behavior: "FORWARD", recipients: ["flight-complaints@example.com"] },

  // Requirement 6 — PR/Marketing & Destination Marketing
  PR_Media_International: { behavior: "FORWARD", recipients: ["pr-media@example.com"] },
  ESG: { behavior: "FORWARD", recipients: ["esg@example.com"] },
  Destination_Marketing_MiddleEast_CentralAsia: {
    behavior: "FORWARD",
    recipients: ["dest-marketing-me@example.com"],
  },
  Destination_Marketing_Other_Overseas: { behavior: "FORWARD", recipients: ["dest-marketing@example.com"] },
  KOL: { behavior: "FORWARD", recipients: ["influencer-marketing@example.com"] },
  Population_Issue: { behavior: "FORWARD", recipients: ["community-affairs@example.com"] },

  // Requirement 7 — business cooperation & investment
  Business_Cooperation: { behavior: "FORWARD", recipients: ["partnerships@example.com"] },
  Investment: { behavior: "FORWARD", recipients: ["investor-relations@example.com"] },

  // Requirement 8 — confirmation letters
  Confirmation_Letter_Domestic: {
    behavior: "FORWARD",
    recipients: ["letters-domestic@example.com", "letters-domestic-2@example.com"],
  },
  Confirmation_Letter_Overseas: { behavior: "FORWARD", recipients: ["letters-overseas@example.com"] },

  // Requirement 9 — business travel customers
  Business_Travel_Overseas: { behavior: "FORWARD", recipients: ["biz-travel@example.com"] },
  Currency_Exchange: { behavior: "FORWARD", recipients: ["fx-desk@example.com"] },
  Business_Travel_Flight_Distribution: { behavior: "NO_FORWARD_REVIEW", recipients: [] },

  // Requirement 10 — Corporate Affairs & Legal
  Corporate_Affairs: { behavior: "FORWARD", recipients: ["corporate-affairs@example.com", "corporate-affairs-2@example.com"] },
  Legal_Korea: { behavior: "FORWARD", recipients: ["legal-korea@example.com"] },
  Legal_Malaysia: { behavior: "FORWARD", recipients: ["legal-malaysia@example.com"] },
  // FORWARD despite the "no-forward note" annotation in raw the demo category table.
  Legal_IP_Complaint: { behavior: "FORWARD", recipients: ["legal-ip@example.com"] },

  // Requirement 11 — official self-service channels (no-forward-resolve)
  Partner_Business_Referral: {
    behavior: "NO_FORWARD_RESOLVE",
    recipients: [],
    guidanceNote: "https://example.com/partners",
  },
  Recruitment_Referral: {
    behavior: "NO_FORWARD_RESOLVE",
    recipients: [],
    guidanceNote: "https://example.com/careers",
  },

  // Requirement 12 — IR routine questions (no reply needed)
  IR_No_Reply_Question: { behavior: "NO_FORWARD_RESOLVE", recipients: [] },
};

describe("Routing_Rule_Set seed data (the demo category table)", () => {
  const byCategory = new Map(SEED_RULE_ENTRIES.map((e) => [e.category, e]));

  it("seeds exactly the expected set of categories (no extras, none missing)", () => {
    expect(new Set(byCategory.keys())).toEqual(new Set(Object.keys(EXPECTED)));
    // Unclassified must NOT be a rule-set row.
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

  it("marks Legal_IP_Complaint as FORWARD (not a no-forward case)", () => {
    const entry = byCategory.get("Legal_IP_Complaint");
    expect(entry!.behavior).toBe("FORWARD");
    expect(entry!.recipients).toEqual(["legal-ip@example.com"]);
  });

  it("keeps every FORWARD category's recipient set non-empty and every NO_FORWARD category empty", () => {
    for (const entry of SEED_RULE_ENTRIES) {
      if (entry.behavior === "FORWARD") {
        expect(entry.recipients.length).toBeGreaterThan(0);
      } else {
        expect(entry.recipients).toEqual([]);
      }
    }
  });
});
