/**
 * Human-readable guidance for each demo routing category (used in the LLM prompt).
 * Replace with your own taxonomy descriptions when adapting this project.
 */
export const CATEGORY_GUIDANCE: Record<string, string> = {
  IBU_Customer_Service:
    "International / overseas customer complaints (including Hong Kong, Macau, Taiwan and other non-mainland markets). Covers flight, hotel, train, refund, duplicate booking, and general service issues. Prefer this over Flight_Complaint and Domestic_Complaint whenever the customer or order is overseas — even for formal flight-policy complaints.",
  Domestic_Complaint:
    "Mainland domestic customer complaints about products/services that are NOT flight-ticket specific. Escalated general customer-service issues.",
  Flight_Complaint:
    "Mainland domestic flight-ticket complaints only: refunds, cancellations, schedule changes for domestic/mainland flight orders. NOT for overseas customers — those are IBU_Customer_Service.",
  PR_Media_International:
    "News media, press, journalists, and editorial/comms teams asking about coverage, interviews, sponsored articles, rate cards, media kits, or advertising/editorial partnerships. Prefer this over Business_Cooperation when the sender is clearly a media outlet.",
  KOL:
    "Influencer, content creator, or community/audience-led marketing: vouchers for followers/members, sponsored trips, storytelling campaigns, affiliate-style reach. The word 'partnership' alone does NOT mean Business_Cooperation.",
  Business_Cooperation:
    "B2B commercial partnerships: distribution, merchant cooperation, market-entry, agency/platform integrations. Use when the sender seeks supply-side or commercial integration — NOT audience/content-led campaigns (those are KOL).",
  Partner_Business_Referral:
    "Generic partner-program signup requests that should be pointed to the self-serve partner portal — no forward needed.",
  Needs_Manual_Review:
    "Complex or ambiguous commercial deals (e.g. flight distribution partnerships) that must not be auto-forwarded; send to human review.",
};
