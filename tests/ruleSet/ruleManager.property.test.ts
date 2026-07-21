/**
 * Property-based tests for the RuleManager (Task 3.2, 3.3, 3.4).
 *
 * Feature: email-inbox-routing
 *   - Property 17: Invalid recipient email format is always rejected without
 *     side effects (Validates: Requirements 16.2)
 *   - Property 18: Updates that would empty a forward category's recipients are
 *     always rejected (Validates: Requirements 16.3)
 *   - Property 19: Rule set resolution as-of a fixed timestamp is stable
 *     regardless of later updates (Validates: Requirements 16.4, 16.5)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { RuleManager, isValidEmailFormat } from "../../src/ruleSet/index.js";
import { seedRuleEntries } from "../../src/ruleSet/index.js";

const NUM_RUNS = 100;

// --- Arbitraries -----------------------------------------------------------

const tokenArb = fc.stringOf(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
  { minLength: 1, maxLength: 10 },
);

/** Generates a well-formed `local@domain.tld` address. */
const validEmailArb = fc
  .tuple(tokenArb, tokenArb, fc.constantFrom("com", "net", "org", "io", "example.com"))
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`)
  .filter((e) => isValidEmailFormat(e));

/** Generates a string that is NOT a valid email address format. */
const invalidEmailArb = fc
  .oneof(
    tokenArb, // no "@"
    fc.constant(""),
    fc.constant("   "),
    tokenArb.map((d) => `@${d}.com`), // empty local part
    tokenArb.map((l) => `${l}@`), // empty domain
    fc.tuple(tokenArb, tokenArb).map(([l, d]) => `${l}@${d}`), // domain without TLD dot
    fc.tuple(tokenArb, tokenArb).map(([l, d]) => `${l} x@${d}.com`), // internal whitespace
    fc.tuple(tokenArb, tokenArb, tokenArb).map(([l, d1, d2]) => `${l}@${d1}@${d2}.com`), // two "@"
  )
  .filter((e) => !isValidEmailFormat(e));

/** The FORWARD categories from the seed set. */
const FORWARD_CATEGORIES = seedRuleEntries()
  .filter((e) => e.behavior === "FORWARD")
  .map((e) => e.category);

const forwardCategoryArb = fc.constantFrom(...FORWARD_CATEGORIES);

// --- Property 17 -----------------------------------------------------------

describe("Property 17: invalid recipient format is rejected without side effects", () => {
  it("rejects an update containing any invalid-format recipient and keeps the prior mapping", () => {
    fc.assert(
      fc.property(
        forwardCategoryArb,
        fc.array(validEmailArb, { minLength: 1, maxLength: 3 }),
        fc.array(validEmailArb, { maxLength: 3 }),
        invalidEmailArb,
        fc.nat(),
        (category, priorRecipients, extraValid, badRecipient, asOf) => {
          const mgr = new RuleManager({ now: () => 10_000 });
          // Establish a known prior mapping at t=1.
          const seed = mgr.addOrUpdateMapping(category, priorRecipients, 1);
          expect(seed.ok).toBe(true);

          const before = mgr.getActiveRuleSet(asOf);

          // Attempt an update mixing valid recipients with one invalid one.
          const attempt = [...extraValid, badRecipient];
          const res = mgr.addOrUpdateMapping(category, attempt, 2);

          // Rejected with a format error...
          expect(res.ok).toBe(false);
          if (!res.ok) expect(res.error.code).toBe("INVALID_EMAIL_FORMAT");

          // ...and no side effects: the rule set is unchanged at any timestamp.
          expect(mgr.getActiveRuleSet(asOf)).toEqual(before);
          const active = mgr.getActiveRuleSet(5).find((e) => e.category === category);
          expect(active?.recipients).toEqual(priorRecipients);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 18 -----------------------------------------------------------

describe("Property 18: emptying a FORWARD category's recipients is rejected", () => {
  it("rejects an empty recipient update for a FORWARD category and keeps the prior mapping", () => {
    fc.assert(
      fc.property(
        forwardCategoryArb,
        fc.array(validEmailArb, { minLength: 1, maxLength: 3 }),
        fc.nat(),
        (category, priorRecipients, asOf) => {
          const mgr = new RuleManager({ now: () => 10_000 });
          const seed = mgr.addOrUpdateMapping(category, priorRecipients, 1);
          expect(seed.ok).toBe(true);

          const before = mgr.getActiveRuleSet(asOf);

          const res = mgr.addOrUpdateMapping(category, [], 2);
          expect(res.ok).toBe(false);
          if (!res.ok) expect(res.error.code).toBe("EMPTY_FORWARD_RECIPIENTS");

          // Prior mapping preserved unchanged.
          expect(mgr.getActiveRuleSet(asOf)).toEqual(before);
          const active = mgr.getActiveRuleSet(5).find((e) => e.category === category);
          expect(active?.recipients).toEqual(priorRecipients);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 19 -----------------------------------------------------------

describe("Property 19: as-of resolution is stable regardless of later updates", () => {
  it("keeps getActiveRuleSet(T0) constant after any later valid updates/deletes", () => {
    const T0 = 1_000;
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            op: fc.constantFrom("update" as const, "delete" as const),
            category: forwardCategoryArb,
            recipients: fc.array(validEmailArb, { minLength: 1, maxLength: 3 }),
            // strictly after T0 so the T0 snapshot must not see these versions
            delta: fc.integer({ min: 1, max: 100_000 }),
          }),
          { maxLength: 20 },
        ),
        (ops) => {
          // Seed entries are effective from 0, so all are active at T0.
          const mgr = new RuleManager();
          const snapshotAtT0 = mgr.getActiveRuleSet(T0);

          for (const op of ops) {
            const effectiveFrom = T0 + op.delta;
            if (op.op === "update") {
              mgr.addOrUpdateMapping(op.category, op.recipients, effectiveFrom);
            } else {
              mgr.deleteMapping(op.category, effectiveFrom);
            }
          }

          // The as-of-T0 view is unaffected by any strictly-later version.
          expect(mgr.getActiveRuleSet(T0)).toEqual(snapshotAtT0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
