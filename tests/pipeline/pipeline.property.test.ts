/**
 * Property-based test for the RoutingPipeline (Task 15.2).
 *
 * Feature: email-inbox-routing
 *   - Property 15: Every processed email has at least one correctly labeled
 *     audit entry (Validates: Requirements 15.3, 15.4)
 *
 * "Processed" means an admitted Contact_Us_Notification. For each such email the
 * pipeline must write exactly one Audit_Log entry whose outcome label
 * (FORWARDED / NO_FORWARD / REVIEW_QUEUE) matches its routing outcome. Emails
 * left untouched by the NotificationFilter (readable non-matches, unreadable
 * headers) must NOT produce audit entries.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { RoutingPipeline } from "../../src/pipeline/index.js";
import {
  MockInboundEmailSource,
} from "../../src/inboundEmailSource/index.js";
import {
  EXPECTED_SENDER,
  EXPECTED_SUBJECT,
  NotificationFilter,
} from "../../src/notificationFilter/index.js";
import { IngestionTracker } from "../../src/ingestion/index.js";
import { SubmitterExtractor } from "../../src/submitterExtractor/index.js";
import { MockEmailClassifier } from "../../src/classifier/index.js";
import { EmailRouter, type ForwardPort, type ForwardResult } from "../../src/router/index.js";
import {
  AuditLog,
  InMemoryAuditLogStore,
  InMemoryErrorChannel,
} from "../../src/auditLog/index.js";
import { ReviewQueue } from "../../src/reviewQueue/index.js";
import { RuleManager } from "../../src/ruleSet/index.js";
import type { AuditOutcome, RawInboxEmail } from "../../src/types/index.js";

const NUM_RUNS = 150;
const THRESHOLD = 0.5;

// Scenarios, each mapping to a definite expected audit outcome label.
type Scenario =
  | "forward" // FORWARD category, port succeeds -> FORWARDED
  | "forward_fail" // FORWARD category, port fails -> REVIEW_QUEUE
  | "noforward" // NO_FORWARD_RESOLVE category -> NO_FORWARD
  | "review_required" // NO_FORWARD_REVIEW category -> REVIEW_QUEUE
  | "ambiguous" // two FORWARD categories qualify -> REVIEW_QUEUE
  | "unclassified"; // no category qualifies -> REVIEW_QUEUE

const SCENARIO_TO_LABEL: Record<Scenario, AuditOutcome> = {
  forward: "FORWARDED",
  forward_fail: "REVIEW_QUEUE",
  noforward: "NO_FORWARD",
  review_required: "REVIEW_QUEUE",
  ambiguous: "REVIEW_QUEUE",
  unclassified: "REVIEW_QUEUE",
};

/** Builds a genuine Contact_Us_Notification whose body drives the classifier. */
function notification(messageId: string, wantTokens: string[]): RawInboxEmail {
  const tokens = wantTokens.map((t) => `[${t}]`).join(" ");
  const body = `New Contact Us submission.\nThe sender's email person@example.com\nrequest ${tokens}`;
  return {
    messageId,
    from: EXPECTED_SENDER,
    subject: EXPECTED_SUBJECT,
    body,
    attachments: [],
    receivedAt: 1000,
  };
}

/** A non-matching work email (wrong sender) that must be left untouched. */
function noise(messageId: string): RawInboxEmail {
  return {
    messageId,
    from: "colleague@example.com",
    subject: "Re: lunch",
    body: "not a contact us notification",
    attachments: [],
    receivedAt: 1000,
  };
}

/** Forward port that fails only for message ids flagged to fail. */
class SelectiveForwardPort implements ForwardPort {
  forward(messageId: string): ForwardResult {
    return messageId.includes("FAIL")
      ? { ok: false, error: "simulated delivery failure" }
      : { ok: true };
  }
}

function tokensFor(scenario: Scenario): string[] {
  switch (scenario) {
    case "forward":
    case "forward_fail":
      return ["Domestic_Complaint"]; // FORWARD
    case "noforward":
      return ["Partner_Business_Referral"]; // NO_FORWARD_RESOLVE
    case "review_required":
      return ["Needs_Manual_Review"]; // NO_FORWARD_REVIEW
    case "ambiguous":
      return ["PR_Media_International", "KOL"]; // two FORWARD categories both qualify
    case "unclassified":
      return []; // nothing qualifies
  }
}

describe("Property 15: every processed email has at least one correctly labeled audit entry", () => {
  it("writes exactly one audit entry per admitted notification with the correct outcome label, and none for untouched mail", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<Scenario>(
            "forward",
            "forward_fail",
            "noforward",
            "review_required",
            "ambiguous",
            "unclassified",
          ),
          { minLength: 1, maxLength: 12 },
        ),
        // Number of non-matching noise emails interspersed.
        fc.integer({ min: 0, max: 5 }),
        (scenarios, noiseCount) => {
          const messages: RawInboxEmail[] = [];
          const expected = new Map<string, AuditOutcome>();

          scenarios.forEach((scenario, i) => {
            const fail = scenario === "forward_fail";
            const id = `${fail ? "FAIL-" : ""}note-${i}-${scenario}`;
            messages.push(notification(id, tokensFor(scenario)));
            expected.set(id, SCENARIO_TO_LABEL[scenario]);
          });
          for (let i = 0; i < noiseCount; i++) {
            messages.push(noise(`noise-${i}`));
          }

          const source = new MockInboundEmailSource(messages);
          const store = new InMemoryAuditLogStore();
          const reviewQueue = new ReviewQueue();
          const pipeline = new RoutingPipeline(
            {
              source,
              filter: new NotificationFilter(),
              ingestion: new IngestionTracker(source, {
                cursorResolver: (e) => source.cursorFor(e.messageId),
              }),
              extractor: new SubmitterExtractor(),
              classifier: new MockEmailClassifier({
                scorer: (content, category) => ({
                  score: content.includes(`[${category}]`) ? 0.95 : 0.05,
                  reasoning: `mock reasoning for ${category}`,
                }),
              }),
              router: new EmailRouter(new SelectiveForwardPort(), { now: () => 5 }),
              ruleManager: new RuleManager(),
              auditLog: new AuditLog(store, new InMemoryErrorChannel()),
              reviewQueue,
            },
            { threshold: THRESHOLD, now: () => 5 },
          );

          const results = pipeline.runOnce();

          // One audit entry per admitted notification; none for untouched mail.
          const entries = store.getEntries();
          expect(entries).toHaveLength(scenarios.length);

          // Every processed notification has exactly one correctly-labeled entry.
          for (const [id, label] of expected) {
            const forId = entries.filter((e) => e.emailId === id);
            expect(forId).toHaveLength(1);
            expect(forId[0]!.outcome).toBe(label);
          }

          // Noise messages produced no audit entry and were dispositioned untouched.
          for (let i = 0; i < noiseCount; i++) {
            expect(entries.some((e) => e.emailId === `noise-${i}`)).toBe(false);
          }
          const ignored = results.filter((r) => r.disposition === "IGNORED");
          expect(ignored).toHaveLength(noiseCount);

          // Exactly-once: a second tick processes nothing new (Req 1.1, 1.2).
          const second = pipeline.runOnce();
          expect(second).toHaveLength(0);
          expect(store.getEntries()).toHaveLength(scenarios.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
