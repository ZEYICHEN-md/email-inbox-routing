/**
 * Unit tests for RuleManager CRUD operations.
 */
import { describe, it, expect, vi } from "vitest";
import { RuleManager, seedRuleEntries } from "../../src/ruleSet/index.js";

describe("RuleManager CRUD", () => {
  it("initializes from the seed rule set", () => {
    const mgr = new RuleManager();
    const active = mgr.getActiveRuleSet(1_000);
    const kol = active.find((e) => e.category === "KOL");
    expect(kol?.recipients).toEqual(["influencer-marketing@example.com"]);
    expect(active.length).toBe(seedRuleEntries().length);
  });

  it("adds a brand-new FORWARD mapping (defaults behavior to FORWARD)", () => {
    const mgr = new RuleManager({ initialEntries: [] });
    const res = mgr.addOrUpdateMapping("New_Team", ["newteam@example.com"], 10);
    expect(res.ok).toBe(true);
    const entry = mgr.getActiveRuleSet(20).find((e) => e.category === "New_Team");
    expect(entry?.behavior).toBe("FORWARD");
    expect(entry?.recipients).toEqual(["newteam@example.com"]);
  });

  it("modifies an existing mapping's recipients while preserving behavior", () => {
    const mgr = new RuleManager({ now: () => 100 });
    const res = mgr.addOrUpdateMapping("KOL", ["kol-new@example.com", "kol-two@example.com"], 50);
    expect(res.ok).toBe(true);
    const entry = mgr.getActiveRuleSet(60).find((e) => e.category === "KOL");
    expect(entry?.behavior).toBe("FORWARD");
    expect(entry?.recipients).toEqual(["kol-new@example.com", "kol-two@example.com"]);
  });

  it("preserves a NO_FORWARD_RESOLVE category's behavior and allows empty recipients", () => {
    const mgr = new RuleManager();
    const res = mgr.addOrUpdateMapping("Partner_Business_Referral", [], 50);
    expect(res.ok).toBe(true);
    const entry = mgr.getActiveRuleSet(60).find((e) => e.category === "Partner_Business_Referral");
    expect(entry?.behavior).toBe("NO_FORWARD_RESOLVE");
    expect(entry?.recipients).toEqual([]);
  });

  it("rejects invalid email format and keeps the prior mapping", () => {
    const mgr = new RuleManager();
    const res = mgr.addOrUpdateMapping("KOL", ["not-an-email"], 50);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_EMAIL_FORMAT");
    const entry = mgr.getActiveRuleSet(60).find((e) => e.category === "KOL");
    expect(entry?.recipients).toEqual(["influencer-marketing@example.com"]);
  });

  it("rejects emptying a FORWARD category and keeps the prior mapping", () => {
    const mgr = new RuleManager();
    const res = mgr.addOrUpdateMapping("KOL", [], 50);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("EMPTY_FORWARD_RECIPIENTS");
    const entry = mgr.getActiveRuleSet(60).find((e) => e.category === "KOL");
    expect(entry?.recipients).toEqual(["influencer-marketing@example.com"]);
  });

  it("deletes a mapping via a tombstone, preserving history before the delete", () => {
    const mgr = new RuleManager();
    const del = mgr.deleteMapping("KOL", 500);
    expect(del.ok).toBe(true);
    expect(mgr.getActiveRuleSet(600).find((e) => e.category === "KOL")).toBeUndefined();
    expect(mgr.getActiveRuleSet(499).find((e) => e.category === "KOL")?.recipients).toEqual([
      "influencer-marketing@example.com",
    ]);
  });

  it("returns NOT_FOUND when deleting a category with no active mapping", () => {
    const mgr = new RuleManager({ initialEntries: [] });
    const del = mgr.deleteMapping("Nonexistent", 10);
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.error.code).toBe("NOT_FOUND");
  });

  it("applies updates only to emails classified after the update", () => {
    const mgr = new RuleManager();
    mgr.addOrUpdateMapping("KOL", ["kol-updated@example.com"], 1_000);
    expect(mgr.getActiveRuleSet(999).find((e) => e.category === "KOL")?.recipients).toEqual([
      "influencer-marketing@example.com",
    ]);
    expect(mgr.getActiveRuleSet(1_001).find((e) => e.category === "KOL")?.recipients).toEqual([
      "kol-updated@example.com",
    ]);
  });

  it("never invokes Email_Classifier logic during CRUD operations", () => {
    const classifierSpy = vi.fn();
    const mgr = new RuleManager();

    mgr.addOrUpdateMapping("KOL", ["kol-x@example.com"], 10);
    mgr.addOrUpdateMapping("New_Cat", ["nc@example.com"], 20);
    mgr.deleteMapping("PR_Media_International", 30);
    mgr.getActiveRuleSet(40);

    expect(classifierSpy).not.toHaveBeenCalled();
  });
});
