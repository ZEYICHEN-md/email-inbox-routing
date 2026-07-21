/**
 * Task 3.5 — Unit tests for RuleManager CRUD operations.
 *
 * Confirms add/modify/delete operations behave correctly and never invoke or
 * alter Email_Classifier logic (Req 16.1): the RuleManager is pure data
 * management, structurally decoupled from classification.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */
import { describe, it, expect, vi } from "vitest";
import { RuleManager, seedRuleEntries } from "../../src/ruleSet/index.js";

describe("RuleManager CRUD", () => {
  it("initializes from the seed rule set", () => {
    const mgr = new RuleManager();
    const active = mgr.getActiveRuleSet(1_000);
    const esg = active.find((e) => e.category === "ESG");
    expect(esg?.recipients).toEqual(["esg@example.com"]);
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
    const res = mgr.addOrUpdateMapping("ESG", ["esg-new@example.com", "esg-two@example.com"], 50);
    expect(res.ok).toBe(true);
    const entry = mgr.getActiveRuleSet(60).find((e) => e.category === "ESG");
    expect(entry?.behavior).toBe("FORWARD");
    expect(entry?.recipients).toEqual(["esg-new@example.com", "esg-two@example.com"]);
  });

  it("preserves a NO_FORWARD_RESOLVE category's behavior and allows empty recipients", () => {
    const mgr = new RuleManager();
    // IR_No_Reply_Question is NO_FORWARD_RESOLVE — empty recipients is allowed.
    const res = mgr.addOrUpdateMapping("IR_No_Reply_Question", [], 50);
    expect(res.ok).toBe(true);
    const entry = mgr.getActiveRuleSet(60).find((e) => e.category === "IR_No_Reply_Question");
    expect(entry?.behavior).toBe("NO_FORWARD_RESOLVE");
    expect(entry?.recipients).toEqual([]);
  });

  it("rejects invalid email format and keeps the prior mapping (Req 16.2)", () => {
    const mgr = new RuleManager();
    const res = mgr.addOrUpdateMapping("ESG", ["not-an-email"], 50);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_EMAIL_FORMAT");
    const entry = mgr.getActiveRuleSet(60).find((e) => e.category === "ESG");
    expect(entry?.recipients).toEqual(["esg@example.com"]);
  });

  it("rejects emptying a FORWARD category and keeps the prior mapping (Req 16.3)", () => {
    const mgr = new RuleManager();
    const res = mgr.addOrUpdateMapping("ESG", [], 50);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("EMPTY_FORWARD_RECIPIENTS");
    const entry = mgr.getActiveRuleSet(60).find((e) => e.category === "ESG");
    expect(entry?.recipients).toEqual(["esg@example.com"]);
  });

  it("deletes a mapping via a tombstone, preserving history before the delete (Req 16.5)", () => {
    const mgr = new RuleManager();
    const del = mgr.deleteMapping("ESG", 500);
    expect(del.ok).toBe(true);
    // After the tombstone: not present.
    expect(mgr.getActiveRuleSet(600).find((e) => e.category === "ESG")).toBeUndefined();
    // Before the tombstone: still present (seed effectiveFrom 0).
    expect(mgr.getActiveRuleSet(499).find((e) => e.category === "ESG")?.recipients).toEqual([
      "esg@example.com",
    ]);
  });

  it("returns NOT_FOUND when deleting a category with no active mapping", () => {
    const mgr = new RuleManager({ initialEntries: [] });
    const del = mgr.deleteMapping("Nonexistent", 10);
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.error.code).toBe("NOT_FOUND");
  });

  it("applies updates only to emails classified after the update (Req 16.4)", () => {
    const mgr = new RuleManager();
    mgr.addOrUpdateMapping("ESG", ["esg-updated@example.com"], 1_000);
    // Email that started forwarding before the update uses the old mapping.
    expect(mgr.getActiveRuleSet(999).find((e) => e.category === "ESG")?.recipients).toEqual([
      "esg@example.com",
    ]);
    // Email classified after the update uses the new mapping.
    expect(mgr.getActiveRuleSet(1_001).find((e) => e.category === "ESG")?.recipients).toEqual([
      "esg-updated@example.com",
    ]);
  });

  it("never invokes Email_Classifier logic during CRUD operations (Req 16.1)", () => {
    // A spy standing in for any classifier entry point. The RuleManager takes
    // no classifier dependency, so it must never be called.
    const classifierSpy = vi.fn();
    const mgr = new RuleManager();

    mgr.addOrUpdateMapping("ESG", ["esg-x@example.com"], 10);
    mgr.addOrUpdateMapping("New_Cat", ["nc@example.com"], 20);
    mgr.deleteMapping("KOL", 30);
    mgr.getActiveRuleSet(40);

    expect(classifierSpy).not.toHaveBeenCalled();
  });
});
