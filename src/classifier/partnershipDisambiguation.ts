import type { ClassificationCandidate, ClassificationResult } from "../types/index.js";

function countSignals(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

/** Signals that the customer/order is overseas / IBU (not mainland domestic). */
const OVERSEAS_IBU_SIGNAL_PATTERNS: RegExp[] = [
  /Hong Kong|香港|Hong Kong Island|North Point/i,
  /Macau|澳門|澳门/i,
  /Taiwan|台灣|台湾/i,
  /Malaysia|Singapore|Indonesia|Thailand|Philippines|Australia|Canada|United Kingdom|\bUK\b|United States|\bUSA\b|Japan|Korea|Vietnam|India/i,
  /\+60|\+62|\+65|\+66|\+61|\+1\b|\+44|\+81|\+82|\+84|\+91|\+852|\+853|\+886/i,
  /Assalamualaikum/i,
  /KLIA|Kuching|Batik Air|Air Asia/i,
  /國泰|Cathay|CX\b|China Southern.*寧波|广州前往寧波/i,
];

/** Signals that the complaint is China-mainland domestic. */
const MAINLAND_DOMESTIC_SIGNAL_PATTERNS: RegExp[] = [
  /大陆|内地|domestic complaint queue|国内订单/,
  /北京|上海|广州|深圳|杭州|成都|重庆|武汉|西安|南京|苏州|天津|青岛|厦门|福州|长沙|郑州|昆明|大连|宁波(?!\s*返回香港)/,
  /\+86(?!\s*[56]\d)/,
];

/** Core flight-ticket dispute signals. */
const CORE_FLIGHT_SIGNAL_PATTERNS: RegExp[] = [
  /機票|机票/,
  /航班/,
  /去程|回程/,
  /\bflight[- ]?(ticket|booking)s?\b/i,
  /duplicate\s+booking/i,
];

/** Audience/community/content-led partnership signals → KOL. */
const KOL_SIGNAL_PATTERNS: RegExp[] = [
  /\b(wellness|travel)\s+community\b/i,
  /\bcommunity[- ]led\b/i,
  /\bour\s+audience\b/i,
  /\b(participants|followers|members)\b/i,
  /\bstorytelling[- ]led\b/i,
  /\b(discount vouchers?|promo\s+codes?)\b/i,
  /\bcontent\s+(campaign|series|collaboration)\b/i,
  /\b(influencer|content creator)\b/i,
  /\bcurated\s+journeys?\b/i,
];

/** Company/platform B2B integration signals → Business_Cooperation. */
const B2B_SIGNAL_PATTERNS: RegExp[] = [
  /\bventure\s+studio\b/i,
  /\b(distribution|merchant|reseller)\b/i,
  /\b(market[- ]entry|GKA)\b/i,
  /\b(platform|api)\s+integration\b/i,
  /\b(e-?commerce|fintech)\s+platform\b/i,
  /\bportfolio\s+(spans|includes)\b/i,
  /\bbuild(s)?\s+and\s+invests?\s+in\b/i,
  /\bB2B\b/i,
];

function looksOverseasIbu(formMessageContent: string): boolean {
  return countSignals(formMessageContent, OVERSEAS_IBU_SIGNAL_PATTERNS) >= 1;
}

function looksMainlandDomestic(formMessageContent: string): boolean {
  return countSignals(formMessageContent, MAINLAND_DOMESTIC_SIGNAL_PATTERNS) >= 1;
}

function hasFlightFocus(formMessageContent: string): boolean {
  return countSignals(formMessageContent, CORE_FLIGHT_SIGNAL_PATTERNS) >= 1;
}

/**
 * Flight_Complaint is under domestic complaint queue (flight-complaints desk). Overseas/IBU customers always
 * route to IBU_Customer_Service, even for flight refunds or formal complaints.
 */
export function disambiguateFlightVsIbu(
  formMessageContent: string,
  candidates: ClassificationCandidate[],
  threshold = 0.5,
): ClassificationCandidate[] {
  const flight = candidates.find((c) => c.category === "Flight_Complaint");
  const ibu = candidates.find((c) => c.category === "IBU_Customer_Service");
  if (!flight || !ibu || flight.score < threshold || ibu.score < threshold) {
    return candidates;
  }

  if (looksOverseasIbu(formMessageContent)) {
    return candidates.filter((c) => c.category !== "Flight_Complaint");
  }

  if (looksMainlandDomestic(formMessageContent) && hasFlightFocus(formMessageContent)) {
    return candidates.filter((c) => c.category !== "IBU_Customer_Service");
  }

  return candidates;
}

/**
 * Apply market-based carve-outs among Flight / IBU / Domestic.
 * Overseas → drop Flight + Domestic; mainland flight → drop IBU (and prefer Flight over Domestic).
 */
export function disambiguateFlightComplaint(
  formMessageContent: string,
  candidates: ClassificationCandidate[],
  threshold = 0.5,
): ClassificationCandidate[] {
  let result = disambiguateFlightVsIbu(formMessageContent, candidates, threshold);

  if (looksOverseasIbu(formMessageContent)) {
    const ibu = result.find((c) => c.category === "IBU_Customer_Service");
    if (ibu && ibu.score >= threshold) {
      return result.filter(
        (c) => c.category !== "Flight_Complaint" && c.category !== "Domestic_Complaint",
      );
    }
  }

  const flight = result.find((c) => c.category === "Flight_Complaint");
  const domestic = result.find((c) => c.category === "Domestic_Complaint");
  if (
    flight &&
    domestic &&
    flight.score >= threshold &&
    domestic.score >= threshold &&
    looksMainlandDomestic(formMessageContent) &&
    hasFlightFocus(formMessageContent)
  ) {
    return result.filter((c) => c.category !== "Domestic_Complaint");
  }

  return result;
}

/**
 * When KOL and Business_Cooperation both appear as candidates, use keyword
 * signals to break ties for clear-cut cases (e.g. travel community + member
 * vouchers → KOL; venture studio + platform integration → Business_Cooperation).
 * When signals conflict, leave both candidates for human review.
 */
export function disambiguateKolVsBusiness(
  formMessageContent: string,
  candidates: ClassificationCandidate[],
): ClassificationCandidate[] {
  const kol = candidates.find((c) => c.category === "KOL");
  const business = candidates.find((c) => c.category === "Business_Cooperation");
  if (!kol || !business) return candidates;

  const kolSignals = countSignals(formMessageContent, KOL_SIGNAL_PATTERNS);
  const b2bSignals = countSignals(formMessageContent, B2B_SIGNAL_PATTERNS);

  if (kolSignals >= 2 && b2bSignals === 0) {
    return candidates.filter((c) => c.category !== "Business_Cooperation");
  }
  if (b2bSignals >= 2 && kolSignals === 0) {
    return candidates.filter((c) => c.category !== "KOL");
  }

  return candidates;
}

/** Applies deterministic post-LLM carve-outs for known ambiguous category pairs. */
export function applyClassificationCarveOuts(
  formMessageContent: string,
  result: ClassificationResult,
  threshold = 0.5,
): ClassificationResult {
  if (result.failed) return result;

  let candidates = disambiguateFlightComplaint(formMessageContent, result.candidates, threshold);
  candidates = disambiguateKolVsBusiness(formMessageContent, candidates);

  if (candidates === result.candidates) return result;
  return { ...result, candidates };
}
