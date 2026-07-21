/**
 * Unit tests for the MockInboundEmailSource (Task 5.1).
 *
 * Verifies the mock adapter's seeding, cursor-based fetch, connected/disconnected
 * transitions, and outage-window simulation behave per the InboundEmailSource
 * contract used by all downstream components and tests.
 *
 * Requirements: 1.1, 1.4 (foundation for 1.3, 1.5)
 */
import { describe, it, expect } from "vitest";
import {
  MockInboundEmailSource,
  START_CURSOR,
  decodeCursor,
} from "../../src/inboundEmailSource/index.js";
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

describe("MockInboundEmailSource", () => {
  it("starts connected and fetches all seeded messages from START_CURSOR", () => {
    const src = new MockInboundEmailSource([raw("a", 1), raw("b", 2)]);
    expect(src.healthCheck()).toBe("connected");
    const msgs = src.fetchNewMessages(START_CURSOR);
    expect(msgs.map((m) => m.messageId)).toEqual(["a", "b"]);
  });

  it("returns only messages after the given cursor", () => {
    const src = new MockInboundEmailSource();
    src.seed([raw("a", 1), raw("b", 2), raw("c", 3)]);
    const afterA = src.cursorFor("a");
    expect(src.fetchNewMessages(afterA).map((m) => m.messageId)).toEqual(["b", "c"]);
    const afterC = src.cursorFor("c");
    expect(src.fetchNewMessages(afterC)).toEqual([]);
  });

  it("yields nothing while disconnected, then replays after reconnect", () => {
    const src = new MockInboundEmailSource([raw("a", 1)]);
    src.disconnect();
    expect(src.healthCheck()).toBe("disconnected");
    expect(src.fetchNewMessages(START_CURSOR)).toEqual([]);
    src.connect();
    expect(src.fetchNewMessages(START_CURSOR).map((m) => m.messageId)).toEqual(["a"]);
  });

  it("simulateOutage disconnects and buffers arrivals until reconnect", () => {
    const src = new MockInboundEmailSource([raw("a", 1)]);
    // Consume the pre-outage message position.
    const afterA = src.cursorFor("a");
    src.simulateOutage([raw("b", 2), raw("c", 3)]);
    expect(src.healthCheck()).toBe("disconnected");
    expect(src.fetchNewMessages(afterA)).toEqual([]);
    src.connect();
    expect(src.fetchNewMessages(afterA).map((m) => m.messageId)).toEqual(["b", "c"]);
  });

  it("advances the acknowledged cursor monotonically", () => {
    const src = new MockInboundEmailSource([raw("a", 1), raw("b", 2)]);
    expect(src.getAcknowledgedCursor()).toBe(START_CURSOR);
    src.acknowledge("b", src.cursorFor("b"));
    const acked = src.getAcknowledgedCursor();
    // Acknowledging an earlier position must not move the cursor backwards.
    src.acknowledge("a", src.cursorFor("a"));
    expect(src.getAcknowledgedCursor()).toBe(acked);
    expect(decodeCursor(src.getAcknowledgedCursor())).toBe(decodeCursor(src.cursorFor("b")));
  });

  it("cursorFor an unknown message returns START_CURSOR", () => {
    const src = new MockInboundEmailSource();
    expect(src.cursorFor("nope")).toBe(START_CURSOR);
  });
});
