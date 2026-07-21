/**
 * Example-based unit tests for the IngestionTracker (Task 7.1).
 *
 * Anchors the dedup state machine (isProcessed / markInFlight / markProcessed)
 * and the outage-replay poll against concrete scenarios.
 *
 * Requirements: 1.1, 1.2, 1.5
 */
import { describe, it, expect } from "vitest";
import { MockInboundEmailSource } from "../../src/inboundEmailSource/index.js";
import { IngestionTracker } from "../../src/ingestion/index.js";
import type { RawInboxEmail } from "../../src/types/index.js";

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

describe("IngestionTracker dedup state", () => {
  it("tracks in-flight then processed transitions", () => {
    const tracker = makeTracker(new MockInboundEmailSource());
    expect(tracker.isProcessed("m1")).toBe(false);
    tracker.markInFlight("m1");
    expect(tracker.isProcessed("m1")).toBe(false);
    tracker.markProcessed("m1");
    expect(tracker.isProcessed("m1")).toBe(true);
  });

  it("markInFlight is a no-op once a message is processed", () => {
    const tracker = makeTracker(new MockInboundEmailSource());
    tracker.markProcessed("m1");
    tracker.markInFlight("m1");
    expect(tracker.isProcessed("m1")).toBe(true);
  });

  it("collectPending returns each new message once and marks it in-flight", () => {
    const source = new MockInboundEmailSource([raw("a", 1), raw("b", 2)]);
    const tracker = makeTracker(source);

    const first = tracker.collectPending();
    expect(first.map((m) => m.messageId)).toEqual(["a", "b"]);

    // Without processing, a second poll returns nothing new (already in-flight).
    expect(tracker.collectPending()).toEqual([]);

    // Process them; still nothing new to hand out.
    for (const m of first) tracker.markProcessed(m.messageId);
    expect(tracker.collectPending()).toEqual([]);
  });

  it("returns nothing while disconnected and replays outage arrivals on reconnect", () => {
    const source = new MockInboundEmailSource([raw("a", 1)]);
    const tracker = makeTracker(source);

    // Process the pre-outage message.
    for (const m of tracker.collectPending()) tracker.markProcessed(m.messageId);

    source.simulateOutage([raw("b", 2), raw("c", 3)]);
    expect(tracker.collectPending()).toEqual([]);

    source.connect();
    const replayed = tracker.collectPending();
    expect(replayed.map((m) => m.messageId)).toEqual(["b", "c"]);
    expect(tracker.isProcessed("a")).toBe(true);
  });
});
