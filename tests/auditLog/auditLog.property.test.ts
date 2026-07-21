/**
 * Property-based tests for the Audit_Log (Task 12.2, 12.3, 12.4).
 *
 * Feature: email-inbox-routing
 *   - Property 13: Classification-phase audit entries are complete — including
 *     the recorded AI-generated final-category reasoning (and per-candidate
 *     reasoning where applicable, and a failure-reason note for Unclassified /
 *     classification failure) for every processed email
 *     (Validates: Requirements 15.1, 15.7)
 *   - Property 14: Forward-phase audit entries are complete
 *     (Validates: Requirements 15.2)
 *   - Property 16: Audit write failures retry within bounds and never block
 *     completed actions (Validates: Requirements 15.5)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  AuditLog,
  buildAuditEntry,
  InMemoryAuditLogStore,
  InMemoryErrorChannel,
  type AuditLogStore,
} from "../../src/auditLog/index.js";
import type {
  AuditLogEntry,
  ClassificationCandidate,
  ClassificationResult,
  Decision,
  ForwardedEmail,
} from "../../src/types/index.js";
import { EXPECTED_SENDER, EXPECTED_SUBJECT } from "../../src/notificationFilter/index.js";

const NUM_RUNS = 200;

// --- Arbitraries -----------------------------------------------------------

const candidateArb: fc.Arbitrary<ClassificationCandidate> = fc.record({
  category: fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,15}$/),
  score: fc.double({ min: 0, max: 1, noNaN: true }),
  reasoning: fc.string({ minLength: 1, maxLength: 30 }),
});

function emailArb(): fc.Arbitrary<ForwardedEmail> {
  return fc.record({
    messageId: fc.uuid(),
    submitterEmail: fc.oneof(
      fc.constant("unavailable"),
      fc.stringMatching(/^[a-z]{1,8}@[a-z]{1,8}\.com$/),
    ),
    body: fc.string({ maxLength: 60 }),
  }).map((r) => ({
    messageId: r.messageId,
    relayEnvelopeSender: EXPECTED_SENDER,
    submitterEmail: r.submitterEmail,
    subject: EXPECTED_SUBJECT,
    body: r.body,
    formMessageContent: r.body,
    attachments: [],
    receivedAt: 100,
  }));
}

/** A decision + its backing classification result + a matching routing outcome. */
const scenarioArb = fc.oneof(
  // SingleCategory -> Forwarded
  fc
    .tuple(candidateArb, fc.array(candidateArb, { maxLength: 4 }), fc.integer({ min: 0, max: 1e6 }))
    .map(([winner, others, forwardedAt]) => {
      const classification: ClassificationResult = { candidates: [winner, ...others] };
      const decision: Decision = { kind: "SingleCategory", category: winner.category, candidate: winner };
      return {
        classification,
        decision,
        outcome: { kind: "Forwarded" as const, recipients: [`${winner.category}@example.com`], forwardedAt },
      };
    }),
  // Ambiguous -> SentToReview
  fc
    .uniqueArray(candidateArb, { minLength: 2, maxLength: 5, selector: (c) => c.category })
    .map((candidates) => ({
      classification: { candidates } as ClassificationResult,
      decision: { kind: "Ambiguous" as const, candidates },
      outcome: { kind: "SentToReview" as const, candidates },
    })),
  // Unclassified -> SentToReview
  fc
    .tuple(fc.array(candidateArb, { maxLength: 4 }), fc.string({ minLength: 1, maxLength: 30 }))
    .map(([candidates, reason]) => ({
      classification: { candidates } as ClassificationResult,
      decision: { kind: "Unclassified" as const, reasoning: reason },
      outcome: { kind: "SentToReview" as const },
    })),
  // Classifier failure -> Unclassified -> SentToReview
  fc.string({ maxLength: 20 }).map((reason) => ({
    classification: { candidates: [], failed: true, failureReason: reason } as ClassificationResult,
    decision: { kind: "Unclassified" as const, reasoning: reason.length > 0 ? reason : "classification failed" },
    outcome: { kind: "SentToReview" as const },
  })),
  // NO_FORWARD_RESOLVE -> NoForwardResolved
  candidateArb.map((winner) => ({
    classification: { candidates: [winner] } as ClassificationResult,
    decision: { kind: "SingleCategory" as const, category: winner.category, candidate: winner },
    outcome: { kind: "NoForwardResolved" as const, guidanceNote: "https://example.com" },
  })),
);

// --- Property 13 -----------------------------------------------------------

describe("Property 13: classification-phase audit entries are complete", () => {
  it("records id, submitter, all candidates+reasoning, final category, and a non-empty final reasoning", () => {
    fc.assert(
      fc.property(emailArb(), scenarioArb, (email, scenario) => {
        const entry = buildAuditEntry({
          email,
          classification: scenario.classification,
          decision: scenario.decision,
          outcome: scenario.outcome,
          decidedAt: 777,
        });

        // Identity + submitter (or "unavailable" marker) are present (Req 15.1, 15.6).
        expect(entry.emailId).toBe(email.messageId);
        expect(entry.submitterEmail).toBe(email.submitterEmail);
        expect(typeof entry.decidedAt).toBe("number");

        // Every candidate carried through with its score and NON-empty reasoning (Req 15.1, 15.7).
        expect(entry.candidates).toHaveLength(scenario.classification.candidates.length);
        for (let i = 0; i < entry.candidates.length; i++) {
          const src = scenario.classification.candidates[i]!;
          expect(entry.candidates[i]!.category).toBe(src.category);
          expect(entry.candidates[i]!.score).toBe(src.score);
          expect(entry.candidates[i]!.reasoning).toBe(src.reasoning);
          expect(entry.candidates[i]!.reasoning.length).toBeGreaterThan(0);
        }

        // A final category label and a non-empty final-category reasoning are
        // always recorded — including for Unclassified/failure (Req 15.7, 4.5).
        expect(typeof entry.finalCategory).toBe("string");
        expect(entry.finalCategory.length).toBeGreaterThan(0);
        expect(entry.finalCategoryReasoning.trim().length).toBeGreaterThan(0);

        if (scenario.decision.kind === "SingleCategory") {
          expect(entry.finalCategory).toBe(scenario.decision.category);
        } else if (scenario.decision.kind === "Ambiguous") {
          expect(entry.finalCategory).toBe("Ambiguous");
        } else {
          expect(entry.finalCategory).toBe("Unclassified");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 14 -----------------------------------------------------------

describe("Property 14: forward-phase audit entries are complete", () => {
  it("records recipients and a forward timestamp exactly when the email was forwarded", () => {
    fc.assert(
      fc.property(emailArb(), scenarioArb, (email, scenario) => {
        const entry = buildAuditEntry({
          email,
          classification: scenario.classification,
          decision: scenario.decision,
          outcome: scenario.outcome,
          decidedAt: 5,
        });

        if (scenario.outcome.kind === "Forwarded") {
          expect(entry.outcome).toBe("FORWARDED");
          expect(entry.recipients).toEqual(scenario.outcome.recipients);
          expect(entry.forwardedAt).toBe(scenario.outcome.forwardedAt);
        } else {
          // Non-forward outcomes carry no forward-phase fields.
          expect(entry.outcome).not.toBe("FORWARDED");
          expect(entry.recipients).toBeUndefined();
          expect(entry.forwardedAt).toBeUndefined();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 16 -----------------------------------------------------------

describe("Property 16: audit write failures retry within bounds and never block completed actions", () => {
  const anyEntry: AuditLogEntry = {
    emailId: "id",
    submitterEmail: "unavailable",
    candidates: [],
    finalCategory: "Unclassified",
    finalCategoryReasoning: "n/a",
    decidedAt: 0,
    outcome: "REVIEW_QUEUE",
  };

  it("makes at most maxRetries+1 attempts, succeeding once the store recovers", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }), // maxRetries
        fc.integer({ min: 0, max: 8 }), // transient failures before success
        (maxRetries, failFirst) => {
          // Count attempts by wrapping the store.
          let attempts = 0;
          const inner = new InMemoryAuditLogStore({ failFirst });
          const counting: AuditLogStore = {
            append: (e) => {
              attempts++;
              inner.append(e);
            },
          };
          const channel = new InMemoryErrorChannel();
          const log = new AuditLog(counting, channel, { maxRetries });

          const result = log.write(anyEntry);
          const maxAttempts = maxRetries + 1;

          // Attempts are strictly bounded.
          expect(attempts).toBeLessThanOrEqual(maxAttempts);

          if (failFirst < maxAttempts) {
            // The store recovers within the budget -> written, no error channel.
            expect(result.kind).toBe("Written");
            expect(channel.getRecords()).toHaveLength(0);
            expect(inner.getEntries()).toHaveLength(1);
          } else {
            // Budget exhausted -> falls back to the error channel, never throws.
            expect(result.kind).toBe("ErrorChannel");
            expect(channel.getRecords()).toHaveLength(1);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("routes to the error channel after exhausting retries, without throwing (action not blocked)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), (maxRetries) => {
        const store = new InMemoryAuditLogStore({ failForever: true });
        const channel = new InMemoryErrorChannel();
        const log = new AuditLog(store, channel, { maxRetries });

        // Never throws — the already-completed action is not rolled back/blocked.
        const result = log.write(anyEntry);
        expect(result.kind).toBe("ErrorChannel");
        if (result.kind !== "ErrorChannel") throw new Error("expected ErrorChannel");
        expect(result.attempts).toBe(maxRetries + 1);
        expect(channel.getRecords()).toHaveLength(1);
        expect(channel.getRecords()[0]!.entry).toBe(anyEntry);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
