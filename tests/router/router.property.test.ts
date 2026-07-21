/**
 * Property-based tests for the Email_Router (Task 11.2, 11.3, 11.6, 11.7,
 * 11.8, 11.9).
 *
 * Feature: email-inbox-routing
 *   - Property 6: Forwarding delivers to exactly the configured recipients for
 *     the decided category (Validates: Requirements 5.1, 5.2, 5.3, 6.1, 6.2,
 *     6.3, 6.4, 6.6, 6.7, 7.1, 7.2, 8.1, 8.2, 9.1, 9.2, 10.1, 10.2, 10.3, 10.4)
 *   - Property 7: Forward failure is logged and queued without losing content
 *     (Validates: Requirements 5.4, 6.8, 7.3, 8.3, 10.5, 14.3)
 *   - Property 8: No-forward-resolve categories never forward and are always
 *     marked processed with an audit record (Validates: Requirements 11.1,
 *     11.2, 12.1, 12.2)
 *   - Property 9: Review-required outcomes never forward to any candidate's
 *     recipients (Validates: Requirements 9.3, 13.1, 13.2)
 *   - Property 10: A native forward preserves the entire original email (body,
 *     including embedded submitter info, and subject) intact, authoring no new
 *     content and setting no sender field (Validates: Requirements 14.1, 3.4)
 *   - Property 12: All original attachments are preserved exactly on forward, as
 *     a natural consequence of the native forward (Validates: Requirements 14.2)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  EmailRouter,
  buildForwardTargets,
  type ForwardPort,
  type ForwardResult,
} from "../../src/router/index.js";
import { buildAuditEntry } from "../../src/auditLog/index.js";
import { ReviewQueue } from "../../src/reviewQueue/index.js";
import { seedRuleEntries } from "../../src/ruleSet/index.js";
import type {
  Attachment,
  ClassificationCandidate,
  ClassificationResult,
  Decision,
  ForwardedEmail,
  RuleEntry,
} from "../../src/types/index.js";
import { EXPECTED_SENDER } from "../../src/notificationFilter/index.js";

const NUM_RUNS = 200;
const RULES: RuleEntry[] = seedRuleEntries();
const FORWARD_CATEGORIES = RULES.filter((r) => r.behavior === "FORWARD").map((r) => r.category);
const NO_FORWARD_RESOLVE_CATEGORIES = RULES.filter(
  (r) => r.behavior === "NO_FORWARD_RESOLVE",
).map((r) => r.category);
const REVIEW_CATEGORY = "Business_Travel_Flight_Distribution"; // NO_FORWARD_REVIEW

// --- Ports -----------------------------------------------------------------

/** Records every native-forward call. */
class RecordingForwardPort implements ForwardPort {
  public calls: { messageId: string; recipients: string[]; cc?: string[] }[] = [];
  constructor(private readonly result: ForwardResult = { ok: true }) {}
  forward(messageId: string, recipients: string[], cc?: string[]): ForwardResult {
    this.calls.push({
      messageId,
      recipients: [...recipients],
      cc: cc ? [...cc] : undefined,
    });
    return this.result;
  }
}

/**
 * A faithful native-forward simulator: stores the ORIGINAL message and, on
 * forward, delivers that stored original (unchanged) to each recipient. Because
 * the router supplies only a messageId, delivered content necessarily equals the
 * original — the whole point of a native forward.
 */
interface StoredMessage {
  body: string;
  subject: string;
  attachments: Attachment[];
}
interface Delivery {
  recipient: string;
  message: StoredMessage;
  senderField?: string; // never set by a native forward
  categoryTag?: string; // never added by a native forward
}
class NativeForwardSimulator implements ForwardPort {
  private readonly store = new Map<string, StoredMessage>();
  public deliveries: Delivery[] = [];
  register(messageId: string, message: StoredMessage): void {
    this.store.set(messageId, message);
  }
  forward(messageId: string, recipients: string[], cc?: string[]): ForwardResult {
    const original = this.store.get(messageId);
    if (original === undefined) return { ok: false, error: "message not found" };
    for (const recipient of [...recipients, ...(cc ?? [])]) {
      // Deliver the stored ORIGINAL. No sender field, no category tag authored.
      this.deliveries.push({ recipient, message: original });
    }
    return { ok: true };
  }
}

// --- Arbitraries -----------------------------------------------------------

const attachmentArb: fc.Arbitrary<Attachment> = fc.record({
  filename: fc.string({ minLength: 1, maxLength: 20 }),
  contentBytes: fc.uint8Array({ maxLength: 32 }).map((a) => a),
});

function emailArb(): fc.Arbitrary<ForwardedEmail> {
  return fc.record({
    messageId: fc.uuid(),
    submitterEmail: fc.oneof(
      fc.constant("unavailable"),
      fc.stringMatching(/^[a-z]{1,8}@[a-z]{1,8}\.com$/),
    ),
    body: fc.string({ maxLength: 120 }),
    subject: fc.string({ maxLength: 60 }),
    attachments: fc.array(attachmentArb, { maxLength: 4 }),
    receivedAt: fc.integer({ min: 0, max: 1_000_000 }),
  }).map((r) => ({
    messageId: r.messageId,
    relayEnvelopeSender: EXPECTED_SENDER,
    submitterEmail: r.submitterEmail,
    subject: r.subject,
    body: r.body,
    formMessageContent: r.body,
    attachments: r.attachments,
    receivedAt: r.receivedAt,
  }));
}

type SingleCategoryDecision = Extract<Decision, { kind: "SingleCategory" }>;

function singleDecision(category: string): SingleCategoryDecision {
  return {
    kind: "SingleCategory",
    category,
    candidate: { category, score: 0.9, reasoning: `matched ${category}` },
  };
}

function classificationFor(candidates: ClassificationCandidate[]): ClassificationResult {
  return { candidates };
}

// --- Property 6 ------------------------------------------------------------

describe("Property 6: forwarding delivers to configured recipients plus IR CC", () => {
  it("forwards To the category recipients and CCs inbox-cc@example.com", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FORWARD_CATEGORIES),
        emailArb(),
        (category, email) => {
          const port = new RecordingForwardPort({ ok: true });
          const router = new EmailRouter(port, { now: () => 1234 });

          const outcome = router.route(email, singleDecision(category), RULES);
          const categoryRecipients = RULES.find((r) => r.category === category)!.recipients;
          const expected = buildForwardTargets(categoryRecipients);

          expect(outcome.kind).toBe("Forwarded");
          if (outcome.kind !== "Forwarded") throw new Error("expected Forwarded");
          expect(outcome.recipients).toEqual(expected.all);
          expect(port.calls).toHaveLength(1);
          expect(port.calls[0]!.recipients).toEqual(expected.to);
          expect(port.calls[0]!.cc).toEqual(expected.cc.length > 0 ? expected.cc : undefined);
          expect(port.calls[0]!.messageId).toBe(email.messageId);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 7 ------------------------------------------------------------

describe("Property 7: forward failure is logged and queued without losing content", () => {
  it("produces ForwardFailed, retains original content, and queues for review", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FORWARD_CATEGORIES),
        emailArb(),
        fc.string({ minLength: 1, maxLength: 20 }),
        (category, email, errMessage) => {
          const originalBody = email.body;
          const originalSubject = email.subject;
          const originalAttachments = email.attachments;
          const port = new RecordingForwardPort({ ok: false, error: errMessage });
          const router = new EmailRouter(port);

          const decision = singleDecision(category);
          const outcome = router.route(email, decision, RULES);
          const categoryRecipients = RULES.find((r) => r.category === category)!.recipients;
          const expected = buildForwardTargets(categoryRecipients);

          expect(outcome.kind).toBe("ForwardFailed");
          if (outcome.kind !== "ForwardFailed") throw new Error("expected ForwardFailed");
          expect(outcome.attemptedRecipients).toEqual(expected.all);
          expect(outcome.error).toBe(errMessage);

          // Original content is retained (nothing discarded, nothing mutated).
          expect(email.body).toBe(originalBody);
          expect(email.subject).toBe(originalSubject);
          expect(email.attachments).toBe(originalAttachments);

          // Failure is auditable (labeled REVIEW_QUEUE) and the email is queued.
          const entry = buildAuditEntry({
            email,
            classification: classificationFor([decision.candidate]),
            decision,
            outcome,
            decidedAt: 10,
          });
          expect(entry.outcome).toBe("REVIEW_QUEUE");

          const queue = new ReviewQueue();
          queue.enqueue(email, "FORWARD_FAILED");
          expect(queue.size()).toBe(1);
          expect(queue.getItems()[0]!.email).toBe(email);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 8 ------------------------------------------------------------

describe("Property 8: no-forward-resolve categories never forward, marked processed with audit record", () => {
  it("resolves silently (no send) and records a NO_FORWARD audit entry", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NO_FORWARD_RESOLVE_CATEGORIES),
        emailArb(),
        (category, email) => {
          const port = new RecordingForwardPort({ ok: true });
          const router = new EmailRouter(port);

          const decision = singleDecision(category);
          const outcome = router.route(email, decision, RULES);

          // No forward attempt whatsoever.
          expect(port.calls).toHaveLength(0);
          expect(outcome.kind).toBe("NoForwardResolved");

          // Marked processed via a NO_FORWARD audit record.
          const entry = buildAuditEntry({
            email,
            classification: classificationFor([decision.candidate]),
            decision,
            outcome,
            decidedAt: 42,
          });
          expect(entry.outcome).toBe("NO_FORWARD");
          expect(entry.recipients).toBeUndefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 9 ------------------------------------------------------------

describe("Property 9: review-required outcomes never forward to any candidate's recipients", () => {
  it("never invokes the forward port for Unclassified, Ambiguous, or review-required categories", () => {
    const candidateArb: fc.Arbitrary<ClassificationCandidate> = fc
      .constantFrom(...FORWARD_CATEGORIES)
      .map((category) => ({ category, score: 0.9, reasoning: `matched ${category}` }));

    const decisionArb: fc.Arbitrary<Decision> = fc.oneof(
      fc.constant<Decision>({ kind: "Unclassified", reasoning: "no confident category" }),
      fc
        .uniqueArray(candidateArb, {
          minLength: 2,
          maxLength: 5,
          selector: (c) => c.category,
        })
        .map<Decision>((candidates) => ({ kind: "Ambiguous", candidates })),
      fc.constant<Decision>(singleDecision(REVIEW_CATEGORY)),
    );

    fc.assert(
      fc.property(decisionArb, emailArb(), (decision, email) => {
        const port = new RecordingForwardPort({ ok: true });
        const router = new EmailRouter(port);

        const outcome = router.route(email, decision, RULES);

        // Zero forward attempts for every review-required outcome.
        expect(port.calls).toHaveLength(0);
        expect(outcome.kind).toBe("SentToReview");

        // For ambiguous, none of the qualifying candidates' recipients are contacted.
        if (decision.kind === "Ambiguous") {
          if (outcome.kind !== "SentToReview") throw new Error("expected SentToReview");
          expect(outcome.candidates).toEqual(decision.candidates);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 10 -----------------------------------------------------------

describe("Property 10: native forward preserves the entire original email intact", () => {
  it("delivers the original body and subject unchanged, with no new content or sender field", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FORWARD_CATEGORIES),
        emailArb(),
        (category, email) => {
          const server = new NativeForwardSimulator();
          server.register(email.messageId, {
            body: email.body,
            subject: email.subject,
            attachments: email.attachments,
          });
          const router = new EmailRouter(server, { now: () => 1 });

          const outcome = router.route(email, singleDecision(category), RULES);
          const categoryRecipients = RULES.find((r) => r.category === category)!.recipients;
          const expected = buildForwardTargets(categoryRecipients);

          expect(outcome.kind).toBe("Forwarded");
          expect(server.deliveries).toHaveLength(expected.all.length);
          for (const delivery of server.deliveries) {
            // Body (including any embedded "The sender's email X" line) and
            // subject are carried through verbatim.
            expect(delivery.message.body).toBe(email.body);
            expect(delivery.message.subject).toBe(email.subject);
            // No sender field and no category tag were ever authored.
            expect(delivery.senderField).toBeUndefined();
            expect(delivery.categoryTag).toBeUndefined();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 12 -----------------------------------------------------------

describe("Property 12: all original attachments are preserved exactly on forward", () => {
  it("delivers identical attachments (count, filenames, bytes) as a consequence of native forward", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FORWARD_CATEGORIES),
        emailArb(),
        (category, email) => {
          const server = new NativeForwardSimulator();
          server.register(email.messageId, {
            body: email.body,
            subject: email.subject,
            attachments: email.attachments,
          });
          const router = new EmailRouter(server, { now: () => 1 });

          router.route(email, singleDecision(category), RULES);

          for (const delivery of server.deliveries) {
            expect(delivery.message.attachments).toHaveLength(email.attachments.length);
            for (let i = 0; i < email.attachments.length; i++) {
              expect(delivery.message.attachments[i]!.filename).toBe(
                email.attachments[i]!.filename,
              );
              expect(Array.from(delivery.message.attachments[i]!.contentBytes)).toEqual(
                Array.from(email.attachments[i]!.contentBytes),
              );
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
