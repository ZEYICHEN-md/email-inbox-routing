/**
 * Demo Routing_Rule_Set — a compact showcase taxonomy (8 categories).
 * Swap these mappings for your own team mailboxes and labels.
 */
import type { RuleEntry } from "../types/index.js";

/** Seed rules are effective from epoch 0 until a later RuleManager update. */
export const SEED_EFFECTIVE_FROM = 0;

/**
 * Compact demo categories covering the three routing behaviors:
 * FORWARD, NO_FORWARD_RESOLVE, and NO_FORWARD_REVIEW.
 */
export const SEED_RULE_ENTRIES: readonly RuleEntry[] = [
  {
    category: "IBU_Customer_Service",
    behavior: "FORWARD",
    recipients: ["intl-support@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Domestic_Complaint",
    behavior: "FORWARD",
    recipients: ["domestic-support@example.com", "domestic-support-lead@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Flight_Complaint",
    behavior: "FORWARD",
    recipients: ["flight-complaints@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "PR_Media_International",
    behavior: "FORWARD",
    recipients: ["pr-media@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "KOL",
    behavior: "FORWARD",
    recipients: ["influencer-marketing@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Business_Cooperation",
    behavior: "FORWARD",
    recipients: ["partnerships@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Partner_Business_Referral",
    behavior: "NO_FORWARD_RESOLVE",
    recipients: [],
    guidanceNote: "https://example.com/partners",
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Needs_Manual_Review",
    behavior: "NO_FORWARD_REVIEW",
    recipients: [],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
];

/** Deep-ish copy of seed entries for RuleManager mutation safety. */
export function seedRuleEntries(): RuleEntry[] {
  return SEED_RULE_ENTRIES.map((e) => ({
    ...e,
    recipients: [...e.recipients],
  }));
}
