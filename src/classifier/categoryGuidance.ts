/**
 * Human-readable guidance for each routing category, used in the LLM classifier prompt.
 * Demo taxonomy — replace with your own category descriptions.
 */
export const CATEGORY_GUIDANCE: Record<string, string> = {
  IBU_Customer_Service:
    "International BU (IBU) customer complaints from overseas users (outside mainland China), including Hong Kong / Macau / Taiwan and all other overseas markets. Covers flight, hotel, train, refund, duplicate booking, and general service issues. Prefer this over Flight_Complaint and Domestic_Complaint whenever the customer/order is overseas or IBU — even if the message is a formal flight-policy complaint.",
  Domestic_Complaint:
    "Domestic (China mainland) customer complaints about DemoCo products/services that are NOT flight-ticket specific. Escalated complaints from domestic platforms; general mainland customer service upgrades.",
  Flight_Complaint:
    "China-mainland domestic flight-ticket complaints only (机票投诉 under domestic complaint queue). Refunds, cancellations, schedule changes for domestic/mainland flight orders. NOT for overseas or IBU flight issues — those are IBU_Customer_Service. flight-complaints@example.com is a domestic-complaint sub-queue, not an international flight desk.",
  PR_Media_International:
    "News media, press, journalists, and editorial/comms teams asking about coverage, interviews, sponsored articles, rate cards, media kits, publication workflows, or advertising/editorial partnerships. Prefer this over Business_Cooperation when the sender is clearly a media outlet or news organization.",
  ESG: "Environmental, social, and governance (ESG) related inquiries.",
  Destination_Marketing_MiddleEast_CentralAsia:
    "Destination marketing cooperation for Middle East or Central Asia regions.",
  Destination_Marketing_Other_Overseas:
    "Destination marketing cooperation for other overseas regions (tourism boards, DMOs). NOT merchant-side DM cooperation — that is Business_Cooperation.",
  KOL:
    "Influencer, content creator, or community/audience-led marketing collaboration: discount vouchers or promo codes for followers/participants/members, sponsored trips, storytelling/social campaigns, affiliate-style partnerships driven by reach and content. Default category for gray-zone travel/wellness communities proposing curated journeys + member vouchers + content — even if they say 'partnership' or 'travel partner'. The word 'partnership' alone does NOT mean Business_Cooperation.",
  Population_Issue: "Population or demographic related issues.",
  Business_Cooperation:
    "B2B commercial partnerships between companies or platforms: enterprise deals, distribution/merchant cooperation, venture or market-entry partnerships, agency/platform integrations. Use when the sender is a company/platform seeking supply-side or commercial integration — NOT when the core offer is audience reach, member vouchers, or a content-led community campaign (those are KOL).",
  Investment: "Investment-related inquiries from investors or institutions.",
  Confirmation_Letter_Domestic:
    "Domestic confirmation letter requests (e.g. for visa, employment).",
  Confirmation_Letter_Overseas:
    "Overseas confirmation letter requests.",
  Business_Travel_Overseas: "Overseas corporate / business travel customer inquiries.",
  Currency_Exchange: "Currency exchange related inquiries.",
  Business_Travel_Flight_Distribution:
    "Flight distribution partnership requests — requires human review, do not auto-forward.",
  Corporate_Affairs: "Corporate affairs matters.",
  Legal_Korea: "Legal matters specific to Korea.",
  Legal_Malaysia: "Legal matters specific to Malaysia.",
  Legal_IP_Complaint: "Intellectual property complaints or legal IP issues.",
  Partner_Business_Referral:
    "Partner business referral — redirect to https://example.com/partners, no forward needed.",
  Recruitment_Referral:
    "Recruitment / job referral — redirect to https://example.com/careers, no forward needed.",
  IR_No_Reply_Question:
    "Routine IR questions that need no reply or forward.",
};
