/**
 * Property-based tests for the IngestionTracker (Task 7.2, 7.3).
 *
 * Feature: email-inbox-routing
 *   - Property 1: New, unseen messages always trigger classification exactly
 *     once (Validates: Requirements 1.1, 1.2)
 *   - Property 2: Outage recovery replays only unprocessed arrivals
 *     (Validates: Requirements 1.5)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { MockInboundEmailSource } from "../../src/inboundEmailSource/index.js";
import { IngestionTracker } from "../../src/ingestion/index.js";
import type { RawInboxEmail } from "../../src/types/index.js";

const NUM_RUNS = 200;

function raw(id: string, receivedAt: number): RawInboxEmail {
  return {
    messageId: id,
    from: "noreply@forms.example.com",
    subject: "[External] New Contact Us submission for DemoCo Inc.",
    body: `body of ${id}`,
    attachments: [],
    receivedAt,
  };
}

function makeTracker(source: MockInboundEmailSource): IngestionTracker {
  return new IngestionTracker(source, {
    cursorResolver: (email) => source.cursorFor(email.messageId),
  });
}

/**
 * Drains all currently-pending messages, "classifying" each exactly once and
 * recording the per-messageId classification count. Loops until no more pending
 * messages surface (a poll may reveal messages held back by dedup on a prior
 * poll only after processing advances the cursor).
 */
function drainAndClassify(
  tracker: IngestionTracker,
  counts: Map<string, number>,
): void {
  // A bounded number of polls; each poll either yields work or terminates.
  for (let guard = 0; guard < 1000; guard++) {
    const pending = tracker.collectPending();
    if (pending.length === 0) break;
    for (const email of pending) {
      counts.set(email.messageId, (counts.get(email.messageId) ?? 0) + 1);
      tracker.markProcessed(email.messageId);
    }
  }
}

// --- Property 1 ------------------------------------------------------------

describe("Property 1: new, unseen messages trigger classification exactly once", () => {
  it("classifies each unique messageId exactly once, even with duplicate deliveries", () => {
    // Arbitrary list of message ids drawn from a small pool so duplicates occur.
    const idPoolArb = fc.array(
      fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h"),
      { minLength: 0, maxLength: 25 },
    );

    fc.assert(
      fc.property(idPoolArb, (ids) => {
        const source = new MockInboundEmailSource();
        // Seed each arrival (duplicates share a messageId but get distinct seq).
        source.seed(ids.map((id, i) => raw(id, i + 1)));

        const tracker = makeTracker(source);
        const counts = new Map<string, number>();
        drainAndClassify(tracker, counts);

        const uniqueIds = new Set(ids);
        // Exactly the unique ids were classified...
        expect(new Set(counts.keys())).toEqual(uniqueIds);
        // ...each exactly once.
        for (const id of uniqueIds) {
          expect(counts.get(id)).toBe(1);
          expect(tracker.isProcessed(id)).toBe(true);
        }

        // A further poll yields nothing new (all processed).
        expect(tracker.collectPending()).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 2 ------------------------------------------------------------

describe("Property 2: outage recovery replays only unprocessed arrivals", () => {
  it("on reconnect, classifies exactly the outage-window arrivals and nothing twice", () => {
    const idsArb = fc.uniqueArray(
      fc.string({ minLength: 1, maxLength: 6 }).filter((s) => s.trim().length > 0),
      { minLength: 0, maxLength: 12 },
    );

    fc.assert(
      fc.property(idsArb, idsArb, (preRaw, duringRaw) => {
        // Ensure the two sets are disjoint so "unprocessed arrivals" is unambiguous.
        const pre = preRaw;
        const preSet = new Set(pre);
        const during = duringRaw.filter((id) => !preSet.has(id));

        const source = new MockInboundEmailSource();
        source.seed(pre.map((id, i) => raw(id, i + 1)));

        const tracker = makeTracker(source);
        const counts = new Map<string, number>();

        // Process all pre-outage messages while connected.
        drainAndClassify(tracker, counts);
        for (const id of new Set(pre)) {
          expect(counts.get(id)).toBe(1);
        }

        // Outage: disconnect and deliver the during-outage arrivals.
        source.simulateOutage(during.map((id, i) => raw(id, 1000 + i)));
        // While disconnected, nothing is pending.
        expect(tracker.collectPending()).toEqual([]);

        // Reconnect and drain: only the outage arrivals should be classified now.
        source.connect();
        const afterOutageCounts = new Map<string, number>();
        drainAndClassify(tracker, afterOutageCounts);

        // Exactly the during-outage arrivals were classified on recovery.
        expect(new Set(afterOutageCounts.keys())).toEqual(new Set(during));
        for (const id of new Set(during)) {
          expect(afterOutageCounts.get(id)).toBe(1);
        }

        // No message was processed twice across the whole run.
        for (const id of new Set([...pre, ...during])) {
          const total = (counts.get(id) ?? 0) + (afterOutageCounts.get(id) ?? 0);
          expect(total).toBe(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
