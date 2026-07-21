/**
 * End-to-end integration smoke test for the RoutingPipeline (Task 15.3).
 *
 * Exercises representative cases through the fully wired pipeline using the mock
 * InboundEmailSource and mock EmailClassifier:
 *   - non-matching work mail left untouched
 *   - a genuine notification admitted
 *   - submitter unavailable but still forwarded normally
 *   - single-category forward
 *   - no-forward-resolve
 *   - ambiguous -> review queue
 *   - unclassified -> review queue
 *   - forward failure -> review queue
 *
 * Requirements: 1.1
 */
import { describe, it, expect } from "vitest";
import { RoutingPipeline } from "../../src/pipeline/index.js";
import { MockInboundEmailSource } from "../../src/inboundEmailSource/index.js";
import {
  EXPECTED_SENDER,
  EXPECTED_SUBJECT,
  NotificationFilter,
} from "../../src/notificationFilter/index.js";
import { IngestionTracker } from "../../src/ingestion/index.js";
import { SubmitterExtractor } from "../../src/submitterExtractor/index.js";
import { MockEmailClassifier } from "../../src/classifier/index.js";
import { EmailRouter, buildForwardTargets, type ForwardPort, type ForwardResult } from "../../src/router/index.js";
import {
  AuditLog,
  InMemoryAuditLogStore,
  InMemoryErrorChannel,
} from "../../src/auditLog/index.js";
import { ReviewQueue } from "../../src/reviewQueue/index.js";
import { RuleManager } from "../../src/ruleSet/index.js";
import type { RawInboxEmail } from "../../src/types/index.js";

const THRESHOLD = 0.5;

interface Harness {
  pipeline: RoutingPipeline;
  store: InMemoryAuditLogStore;
  reviewQueue: ReviewQueue;
  filter: NotificationFilter;
  forwardCalls: { messageId: string; recipients: string[]; cc?: string[] }[];
}

/** Builds a fully wired pipeline over the given seeded messages. */
function makeHarness(messages: RawInboxEmail[], opts: { failForward?: boolean } = {}): Harness {
  const source = new MockInboundEmailSource(messages);
  const store = new InMemoryAuditLogStore();
  const reviewQueue = new ReviewQueue();
  const filter = new NotificationFilter();
  const forwardCalls: { messageId: string; recipients: string[]; cc?: string[] }[] = [];

  const port: ForwardPort = {
    forward(messageId: string, recipients: string[], cc?: string[]): ForwardResult {
      forwardCalls.push({
        messageId,
        recipients: [...recipients],
        cc: cc ? [...cc] : undefined,
      });
      return opts.failForward
        ? { ok: false, error: "simulated delivery failure" }
        : { ok: true };
    },
  };

  const pipeline = new RoutingPipeline(
    {
      source,
      filter,
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
      router: new EmailRouter(port, { now: () => 42 }),
      ruleManager: new RuleManager(),
      auditLog: new AuditLog(store, new InMemoryErrorChannel()),
      reviewQueue,
    },
    { threshold: THRESHOLD, now: () => 42 },
  );

  return { pipeline, store, reviewQueue, filter, forwardCalls };
}

/** A genuine Contact_Us_Notification with a configurable submitter + category tokens. */
function notification(
  messageId: string,
  wantTokens: string[],
  submitterLine = "The sender's email person@example.com",
): RawInboxEmail {
  const tokens = wantTokens.map((t) => `[${t}]`).join(" ");
  return {
    messageId,
    from: EXPECTED_SENDER,
    subject: EXPECTED_SUBJECT,
    body: `New Contact Us submission.\n${submitterLine}\nDetails: ${tokens}`,
    attachments: [],
    receivedAt: 1000,
  };
}

describe("RoutingPipeline end-to-end smoke test", () => {
  it("leaves non-matching work mail untouched (no audit, no forward, no review)", () => {
    const mail: RawInboxEmail = {
      messageId: "work-1",
      from: "colleague@example.com",
      subject: "Team lunch?",
      body: "Are we still on for lunch?",
      attachments: [],
      receivedAt: 1000,
    };
    const h = makeHarness([mail]);

    const results = h.pipeline.runOnce();

    expect(results).toHaveLength(1);
    expect(results[0]!.disposition).toBe("IGNORED");
    expect(h.store.getEntries()).toHaveLength(0);
    expect(h.reviewQueue.size()).toBe(0);
    expect(h.forwardCalls).toHaveLength(0);
  });

  it("logs a skip notice and leaves an unreadable-header email untouched", () => {
    const mail: RawInboxEmail = {
      messageId: "bad-1",
      from: null,
      subject: EXPECTED_SUBJECT,
      body: "missing sender",
      attachments: [],
      receivedAt: 1000,
    };
    const h = makeHarness([mail]);

    const results = h.pipeline.runOnce();

    expect(results[0]!.disposition).toBe("SKIPPED_UNREADABLE");
    expect(h.store.getEntries()).toHaveLength(0);
    expect(h.filter.getSkipNotices()).toHaveLength(1);
  });

  it("admits a genuine notification and forwards a single-category email to the configured recipients", () => {
    const h = makeHarness([notification("n-forward", ["Domestic_Complaint"])]);

    const results = h.pipeline.runOnce();

    expect(results[0]!.disposition).toBe("FORWARDED");
    const entry = h.store.getEntries()[0]!;
    expect(entry.emailId).toBe("n-forward");
    expect(entry.outcome).toBe("FORWARDED");
    expect(entry.finalCategory).toBe("Domestic_Complaint");
    const domestic = buildForwardTargets(["domestic-support@example.com", "domestic-support-lead@example.com"]);
    expect(entry.recipients).toEqual(domestic.all);
    expect(entry.submitterEmail).toBe("person@example.com");
    expect(h.forwardCalls).toEqual([
      {
        messageId: "n-forward",
        recipients: domestic.to,
        cc: domestic.cc,
      },
    ]);
    expect(h.reviewQueue.size()).toBe(0);
  });

  it("still forwards normally when the submitter is unavailable (non-blocking extraction)", () => {
    // No "The sender's email" marker -> submitter unavailable, but still forwarded.
    const email = notification("n-nosub", ["Flight_Complaint"], "Filed by an anonymous user.");
    const h = makeHarness([email]);

    const results = h.pipeline.runOnce();

    expect(results[0]!.disposition).toBe("FORWARDED");
    const entry = h.store.getEntries()[0]!;
    expect(entry.outcome).toBe("FORWARDED");
    expect(entry.submitterEmail).toBe("unavailable");
    const flight = buildForwardTargets(["flight-complaints@example.com"]);
    expect(entry.recipients).toEqual(flight.all);
    expect(h.reviewQueue.size()).toBe(0);
  });

  it("resolves a no-forward-resolve category without forwarding", () => {
    const h = makeHarness([notification("n-noforward", ["Partner_Business_Referral"])]);

    const results = h.pipeline.runOnce();

    expect(results[0]!.disposition).toBe("NO_FORWARD");
    const entry = h.store.getEntries()[0]!;
    expect(entry.outcome).toBe("NO_FORWARD");
    expect(entry.finalCategory).toBe("Partner_Business_Referral");
    expect(entry.recipients).toBeUndefined();
    expect(h.forwardCalls).toHaveLength(0);
    expect(h.reviewQueue.size()).toBe(0);
  });

  it("routes an ambiguous (multi-category) email to the review queue with all candidates", () => {
    const h = makeHarness([notification("n-ambig", ["PR_Media_International", "KOL"])]);

    const results = h.pipeline.runOnce();

    expect(results[0]!.disposition).toBe("REVIEW_QUEUE");
    expect(results[0]!.reviewReason).toBe("AMBIGUOUS");
    const entry = h.store.getEntries()[0]!;
    expect(entry.outcome).toBe("REVIEW_QUEUE");
    expect(entry.finalCategory).toBe("Ambiguous");
    expect(h.forwardCalls).toHaveLength(0);
    expect(h.reviewQueue.size()).toBe(1);
    const item = h.reviewQueue.getItems()[0]!;
    expect(item.reason).toBe("AMBIGUOUS");
    expect(item.candidates?.map((c) => c.category).sort()).toEqual([
      "KOL",
      "PR_Media_International",
    ]);
  });

  it("routes an unclassified email to the review queue", () => {
    // No category tokens -> nothing clears the threshold -> Unclassified.
    const h = makeHarness([notification("n-unclass", [])]);

    const results = h.pipeline.runOnce();

    expect(results[0]!.disposition).toBe("REVIEW_QUEUE");
    expect(results[0]!.reviewReason).toBe("UNCLASSIFIED");
    const entry = h.store.getEntries()[0]!;
    expect(entry.outcome).toBe("REVIEW_QUEUE");
    expect(entry.finalCategory).toBe("Unclassified");
    expect(h.forwardCalls).toHaveLength(0);
    expect(h.reviewQueue.getItems()[0]!.reason).toBe("UNCLASSIFIED");
  });

  it("routes a forward failure to the review queue while retaining content", () => {
    const h = makeHarness([notification("n-failforward", ["Flight_Complaint"])], {
      failForward: true,
    });

    const results = h.pipeline.runOnce();

    expect(results[0]!.disposition).toBe("REVIEW_QUEUE");
    expect(results[0]!.reviewReason).toBe("FORWARD_FAILED");
    const entry = h.store.getEntries()[0]!;
    expect(entry.outcome).toBe("REVIEW_QUEUE");
    // A forward WAS attempted (then failed) to the configured recipient.
    const failed = buildForwardTargets(["flight-complaints@example.com"]);
    expect(h.forwardCalls).toEqual([
      {
        messageId: "n-failforward",
        recipients: failed.to,
        cc: failed.cc,
      },
    ]);
    expect(h.reviewQueue.getItems()[0]!.reason).toBe("FORWARD_FAILED");
  });

  it("processes a mixed batch exactly once and does not reprocess on a second tick", () => {
    const h = makeHarness([
      notification("m-forward", ["Domestic_Complaint"]),
      { messageId: "m-noise", from: "x@example.com", subject: "hi", body: "hi", attachments: [], receivedAt: 1 },
      notification("m-review", ["PR_Media_International", "KOL"]),
    ]);

    const first = h.pipeline.runOnce();
    expect(first).toHaveLength(3);
    expect(h.store.getEntries()).toHaveLength(2); // only the two admitted notifications

    const second = h.pipeline.runOnce();
    expect(second).toHaveLength(0);
    expect(h.store.getEntries()).toHaveLength(2);
  });
});
