/**
 * Routing_Rule_Set seed data, structured directly from the demo category table of
 * the product requirements and the Routing_Rule_Set table in the design notes.
 *
 * This is the authoritative, code-encoded version of the forwarding/contact
 * rules. Each category's `behavior`, `recipients`, and `guidanceNote` are
 * encoded exactly as tabulated in the design document.
 *
 * Note on `Legal_IP_Complaint`: it is a genuine FORWARD target
 * (legal-ip@example.com), NOT a no-forward case, despite the "no-forward note"
 * annotation next to it in the raw the demo category table text — that annotation describes
 * downstream handling after the IP desk receives it, not a signal to
 * skip forwarding (see the design notes).
 *
 * The true NO_FORWARD categories are:
 *  - NO_FORWARD_RESOLVE: Partner_Business_Referral, Recruitment_Referral,
 *    IR_No_Reply_Question
 *  - NO_FORWARD_REVIEW:  Business_Travel_Flight_Distribution
 *
 * Requirements: 16.1; encodes category mappings from Requirements 5.1, 5.2,
 * 5.3, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 7.1, 7.2, 8.1, 8.2, 9.1, 9.2, 9.3, 10.1,
 * 10.2, 10.3, 10.4, 11.1, 11.2, 12.1, 12.2.
 */
import type { RuleEntry } from "../types/index.js";

/**
 * The `effectiveFrom` timestamp assigned to every seeded rule entry. Epoch 0
 * (the earliest possible timestamp) ensures the seed mappings are in effect for
 * any `getActiveRuleSet(asOf)` query with a non-negative timestamp, until they
 * are superseded by a later versioned update via the RuleManager (Req 16.4/16.5).
 */
export const SEED_EFFECTIVE_FROM = 0;

/**
 * The seed Routing_Rule_Set, one entry per Category, exactly as tabulated in
 * the design notes's Routing_Rule_Set section (sourced from the demo category table).
 *
 * `Unclassified` is intentionally NOT a rule-set row — it always routes to the
 * Review_Queue and is handled by the router/decision logic, not by a mapping.
 */
export const SEED_RULE_ENTRIES: readonly RuleEntry[] = [
  // --- Customer complaints (Requirement 5) ---
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

  // --- PR/Marketing & Destination Marketing (Requirement 6) ---
  {
    category: "PR_Media_International",
    behavior: "FORWARD",
    recipients: ["pr-media@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "ESG",
    behavior: "FORWARD",
    recipients: ["esg@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Destination_Marketing_MiddleEast_CentralAsia",
    behavior: "FORWARD",
    recipients: ["dest-marketing-me@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Destination_Marketing_Other_Overseas",
    behavior: "FORWARD",
    recipients: ["dest-marketing@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "KOL",
    behavior: "FORWARD",
    recipients: ["influencer-marketing@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Population_Issue",
    behavior: "FORWARD",
    recipients: ["community-affairs@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },

  // --- Business cooperation & investment (Requirement 7) ---
  {
    category: "Business_Cooperation",
    behavior: "FORWARD",
    recipients: ["partnerships@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Investment",
    behavior: "FORWARD",
    recipients: ["investor-relations@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },

  // --- Confirmation letters (Requirement 8) ---
  {
    category: "Confirmation_Letter_Domestic",
    behavior: "FORWARD",
    recipients: ["letters-domestic@example.com", "letters-domestic-2@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Confirmation_Letter_Overseas",
    behavior: "FORWARD",
    recipients: ["letters-overseas@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },

  // --- Business travel customers (Requirement 9) ---
  {
    category: "Business_Travel_Overseas",
    behavior: "FORWARD",
    recipients: ["biz-travel@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Currency_Exchange",
    behavior: "FORWARD",
    recipients: ["fx-desk@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    // Flight external distribution — review-required, never auto-forwarded (Req 9.3).
    category: "Business_Travel_Flight_Distribution",
    behavior: "NO_FORWARD_REVIEW",
    recipients: [],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },

  // --- Corporate Affairs & Legal (Requirement 10) ---
  {
    category: "Corporate_Affairs",
    behavior: "FORWARD",
    recipients: ["corporate-affairs@example.com", "corporate-affairs-2@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Legal_Korea",
    behavior: "FORWARD",
    recipients: ["legal-korea@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Legal_Malaysia",
    behavior: "FORWARD",
    recipients: ["legal-malaysia@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    // FORWARD despite the "no-forward note" text in raw the demo category table (see file header).
    category: "Legal_IP_Complaint",
    behavior: "FORWARD",
    recipients: ["legal-ip@example.com"],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },

  // --- Official self-service channels (Requirement 11) ---
  {
    category: "Partner_Business_Referral",
    behavior: "NO_FORWARD_RESOLVE",
    recipients: [],
    guidanceNote: "https://example.com/partners",
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
  {
    category: "Recruitment_Referral",
    behavior: "NO_FORWARD_RESOLVE",
    recipients: [],
    guidanceNote: "https://example.com/careers",
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },

  // --- IR routine questions, no reply needed (Requirement 12) ---
  {
    category: "IR_No_Reply_Question",
    behavior: "NO_FORWARD_RESOLVE",
    recipients: [],
    effectiveFrom: SEED_EFFECTIVE_FROM,
  },
];

/**
 * Returns a fresh, deep-ish copy of the seed rule entries (recipients arrays
 * copied) so callers — notably the RuleManager — can version and mutate their
 * own state without aliasing the shared seed constant.
 */
export function seedRuleEntries(): RuleEntry[] {
  return SEED_RULE_ENTRIES.map((e) => ({
    ...e,
    recipients: [...e.recipients],
  }));
}
