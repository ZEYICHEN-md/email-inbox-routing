/**
 * Ingestion Tracker (Task 7): dedup, in-flight tracking, and outage-replay.
 *
 * Operates on admitted messages (post-NotificationFilter). It guarantees that
 * classification is triggered exactly once per unique `messageId` (Req 1.1, 1.2)
 * and, on recovery from an outage, replays exactly the arrivals that were not
 * already processed (Req 1.5).
 *
 * Exactly-once is enforced primarily by deduplicating on `messageId`: a message
 * is only handed to classification if it is neither already processed nor
 * currently in-flight. The cursor protocol is an efficiency + recovery aid: in
 * steady state the tracker fetches from a high-water mark, and on a
 * disconnected -> connected transition it rewinds to the last acknowledged
 * (safely processed) cursor so outage-window arrivals are replayed. Dedup then
 * ensures nothing already handled is processed twice.
 *
 * Requirements: 1.1, 1.2, 1.5
 */
import type { Cursor, RawInboxEmail } from "../types/index.js";
import {
  decodeCursor,
  START_CURSOR,
  type ConnectionStatus,
  type InboundEmailSource,
} from "../inboundEmailSource/index.js";

export interface IngestionTrackerOptions {
  /**
   * Resolves the cursor positioned immediately after a given message, used to
   * advance the high-water and acknowledged positions. When omitted, cursors do
   * not advance beyond the start, so the source is re-scanned every poll and
   * exactly-once relies entirely on message-id dedup (still correct, less
   * efficient). Wire this to `MockInboundEmailSource.cursorFor` in tests.
   */
  cursorResolver?: (email: RawInboxEmail) => Cursor;
}

export class IngestionTracker {
  private readonly processed = new Set<string>();
  private readonly inFlight = new Set<string>();
  private readonly cursorByMessageId = new Map<string, Cursor>();
  private readonly source: InboundEmailSource;
  private readonly cursorResolver: (email: RawInboxEmail) => Cursor;

  /** Latest position fetched from (advances as messages are fetched). */
  private highWaterCursor: Cursor = START_CURSOR;
  /** Last position whose message was fully processed (the safe replay point). */
  private acknowledgedCursor: Cursor = START_CURSOR;
  /** Connection status observed on the previous poll (for transition detection). */
  private lastStatus: ConnectionStatus;

  constructor(source: InboundEmailSource, options: IngestionTrackerOptions = {}) {
    this.source = source;
    this.cursorResolver = options.cursorResolver ?? (() => START_CURSOR);
    this.lastStatus = source.healthCheck();
  }

  /** True once `markProcessed` has been called for this message (Req 1.2). */
  isProcessed(messageId: string): boolean {
    return this.processed.has(messageId);
  }

  /**
   * Marks a message as in-flight (an idempotency guard set before classification
   * starts). No-op if the message has already been fully processed.
   */
  markInFlight(messageId: string): void {
    if (!this.processed.has(messageId)) {
      this.inFlight.add(messageId);
    }
  }

  /**
   * Marks a message as fully processed and advances the acknowledged cursor to
   * this message's position, so outage recovery never replays it (Req 1.5).
   */
  markProcessed(messageId: string): void {
    this.processed.add(messageId);
    this.inFlight.delete(messageId);
    const cursor = this.cursorByMessageId.get(messageId);
    if (cursor !== undefined) {
      if (decodeCursor(cursor) > decodeCursor(this.acknowledgedCursor)) {
        this.acknowledgedCursor = cursor;
      }
      this.source.acknowledge(messageId, cursor);
    }
  }

  /**
   * Polls the source and returns the messages that should trigger classification
   * right now: those that are neither already processed nor already in-flight.
   * Returned messages are marked in-flight so a subsequent poll (or a duplicate
   * delivery within the same batch) will not re-trigger classification for them.
   *
   * On a disconnected -> connected transition, the fetch position is rewound to
   * the last acknowledged cursor so arrivals during the outage are replayed
   * (Req 1.5). While disconnected, returns an empty list.
   */
  collectPending(): RawInboxEmail[] {
    const status = this.source.healthCheck();
    const reconnected = this.lastStatus === "disconnected" && status === "connected";
    this.lastStatus = status;

    if (status === "disconnected") {
      return [];
    }

    if (reconnected) {
      // Outage recovery: rewind to the safe (last acknowledged) point so any
      // messages that arrived during the outage are re-scanned and replayed.
      this.highWaterCursor = this.acknowledgedCursor;
    }

    const fetched = this.source.fetchNewMessages(this.highWaterCursor);
    const pending: RawInboxEmail[] = [];

    for (const email of fetched) {
      const cursor = this.cursorResolver(email);
      this.cursorByMessageId.set(email.messageId, cursor);
      if (decodeCursor(cursor) > decodeCursor(this.highWaterCursor)) {
        this.highWaterCursor = cursor;
      }

      // Dedup: exactly-once per unique messageId (Req 1.1, 1.2).
      if (this.processed.has(email.messageId) || this.inFlight.has(email.messageId)) {
        continue;
      }
      this.inFlight.add(email.messageId);
      pending.push(email);
    }

    return pending;
  }
}
