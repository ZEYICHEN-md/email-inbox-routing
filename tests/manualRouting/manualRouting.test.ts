import { describe, expect, it } from "vitest";
import { decide } from "../../src/classifier/index.js";
import { FORWARD_CC_RECIPIENT } from "../../src/router/index.js";
import {
  prepareFormContent,
  resolveRouting,
  formatOutlookRecipients,
} from "../../src/manualRouting/index.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "../../fixtures");

describe("manualRouting", () => {
  it("extracts form content from notification body fixture", () => {
    const body = readFileSync(join(FIXTURES, "atra-media-inquiry.txt"), "utf8");
    const { formMessageContent, submitterEmail } = prepareFormContent(
      body,
      "notification-body",
      "test-1",
    );
    expect(submitterEmail).toBe("work.atradiputra@gmail.com");
    expect(formMessageContent).toContain("Atra dari tim Marketing");
  });

  it("resolveRouting returns FORWARD with CC for PR_Media_International", () => {
    const decision = decide(
      {
        candidates: [
          {
            category: "PR_Media_International",
            score: 0.9,
            reasoning: "media inquiry",
          },
        ],
      },
      0.5,
    );
    expect(decision.kind).toBe("SingleCategory");
    const routing = resolveRouting(decision);
    expect(routing.action).toBe("FORWARD");
    expect(routing.to).toEqual(["pr-media@example.com"]);
    expect(routing.cc).toEqual([FORWARD_CC_RECIPIENT]);
  });

  it("resolveRouting returns NO_FORWARD for Partner_Business_Referral", () => {
    const decision = decide(
      {
        candidates: [
          {
            category: "Partner_Business_Referral",
            score: 0.8,
            reasoning: "partner referral",
          },
        ],
      },
      0.5,
    );
    const routing = resolveRouting(decision);
    expect(routing.action).toBe("NO_FORWARD");
    expect(routing.guidanceNote).toContain("partners");
  });

  it("resolveRouting returns REVIEW_QUEUE for ambiguous", () => {
    const decision = decide(
      {
        candidates: [
          { category: "A", score: 0.8, reasoning: "a" },
          { category: "B", score: 0.7, reasoning: "b" },
        ],
      },
      0.5,
    );
    expect(decision.kind).toBe("Ambiguous");
    const routing = resolveRouting(decision);
    expect(routing.action).toBe("REVIEW_QUEUE");
  });

  it("formatOutlookRecipients uses semicolon separator", () => {
    expect(formatOutlookRecipients(["a@example.com", "b@example.com"])).toBe(
      "a@example.com; b@example.com",
    );
  });
});
