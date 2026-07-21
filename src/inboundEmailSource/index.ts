/**
 * Inbound Email Source abstraction and in-memory mock adapter (Task 5).
 *
 * The `InboundEmailSource` interface wraps read access to the monitored mailbox
 * (the user's own inbox `user@example.com` via Microsoft Graph in production —
 * see the design notes's "Mailbox access" section). It yields `RawInboxEmail` (every
 * inbox message), never `ForwardedEmail`: deciding which raw messages become a
 * `ForwardedEmail` is the job of `NotificationFilter` (Requirement 2).
 *
 * `MockInboundEmailSource` is an in-memory implementation used by all downstream
 * components and tests instead of a live mailbox connection. It can be seeded
 * with test messages (normal work mail AND genuine notifications), simulate
 * connected/disconnected transitions, and simulate an outage window during which
 * new messages arrive but cannot be fetched until reconnect.
 *
 * The real adapter (`GraphOwnMailboxAdapter`) is Task 16 and implements this
 * same interface.
 *
 * Requirements: 1.1, 1.4 (foundation for 1.3, 1.5)
 */
import type { Cursor, RawInboxEmail } from "../types/index.js";

/** Connectivity health of the underlying mailbox connection. */
export type ConnectionStatus = "connected" | "disconnected";

/**
 * Abstraction over mailbox access. A single adapter implements this per
 * environment (`MockInboundEmailSource` for tests, `GraphOwnMailboxAdapter` for
 * production). No downstream component references a concrete adapter type.
 */
export interface InboundEmailSource {
  /** Returns every inbox message that arrived strictly after `cursor`. */
  fetchNewMessages(cursor: Cursor): RawInboxEmail[];
  /**
   * Acknowledges that processing has advanced past `messageId`, persisting
   * `cursor` as the new "last acknowledged" position so a later replay can
   * resume from a safe point.
   */
  acknowledge(messageId: string, cursor: Cursor): void;
  /** Reports whether the mailbox connection is currently reachable. */
  healthCheck(): ConnectionStatus;
}

// --- Cursor protocol -------------------------------------------------------
//
// A cursor encodes a monotonic sequence position ("everything up to and
// including sequence N has been seen"). It is treated as opaque by callers;
// only the source and the shared helpers below understand its encoding.

/** The cursor pointing before any message (the very beginning of the stream). */
export const START_CURSOR: Cursor = "seq:0";

/** Encodes a sequence position as an opaque cursor string. */
export function encodeCursor(seq: number): Cursor {
  return `seq:${seq}`;
}

/** Decodes a cursor string back to its numeric sequence position. */
export function decodeCursor(cursor: Cursor): number {
  const raw = cursor.startsWith("seq:") ? cursor.slice(4) : cursor;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * In-memory `InboundEmailSource` for tests and local wiring. Messages are
 * appended in arrival order and assigned an increasing sequence number; a
 * cursor selects messages whose sequence is greater than the cursor position.
 */
export class MockInboundEmailSource implements InboundEmailSource {
  private readonly entries: { seq: number; email: RawInboxEmail }[] = [];
  private readonly seqByMessageId = new Map<string, number>();
  private nextSeq = 1;
  private connected = true;
  private acknowledgedCursor: Cursor = START_CURSOR;

  constructor(initialMessages?: RawInboxEmail[]) {
    if (initialMessages && initialMessages.length > 0) {
      this.seed(initialMessages);
    }
  }

  // --- InboundEmailSource interface ---------------------------------------

  fetchNewMessages(cursor: Cursor): RawInboxEmail[] {
    // A disconnected source can yield nothing; arrivals accumulate until
    // connectivity is restored (simulating an outage window, Req 1.5).
    if (!this.connected) return [];
    const after = decodeCursor(cursor);
    return this.entries
      .filter((e) => e.seq > after)
      .map((e) => e.email);
  }

  acknowledge(_messageId: string, cursor: Cursor): void {
    // Advance the persisted acknowledged position monotonically.
    if (decodeCursor(cursor) > decodeCursor(this.acknowledgedCursor)) {
      this.acknowledgedCursor = cursor;
    }
  }

  healthCheck(): ConnectionStatus {
    return this.connected ? "connected" : "disconnected";
  }

  // --- Test / simulation helpers ------------------------------------------

  /** Appends messages to the inbox in arrival order. Returns `this` for chaining. */
  seed(messages: RawInboxEmail[]): this {
    for (const email of messages) {
      const seq = this.nextSeq++;
      this.entries.push({ seq, email });
      this.seqByMessageId.set(email.messageId, seq);
    }
    return this;
  }

  /** Marks the source connected (reachable). */
  connect(): this {
    this.connected = true;
    return this;
  }

  /** Marks the source disconnected (unreachable) — the start of an outage. */
  disconnect(): this {
    this.connected = false;
    return this;
  }

  /**
   * Simulates an outage window: disconnects the source, then delivers messages
   * that arrive while disconnected. They are assigned sequence numbers but are
   * not fetchable until `connect()` is called (Req 1.5).
   */
  simulateOutage(messagesDuringOutage: RawInboxEmail[]): this {
    this.disconnect();
    this.seed(messagesDuringOutage);
    return this;
  }

  /** The last cursor acknowledged via `acknowledge`. */
  getAcknowledgedCursor(): Cursor {
    return this.acknowledgedCursor;
  }

  /**
   * Returns the cursor positioned immediately after the given message, i.e. a
   * cursor such that `fetchNewMessages` will no longer return that message.
   * Used by the IngestionTracker to advance/acknowledge its position.
   */
  cursorFor(messageId: string): Cursor {
    const seq = this.seqByMessageId.get(messageId);
    return seq === undefined ? START_CURSOR : encodeCursor(seq);
  }
}

// --- Real own-mailbox adapter (Task 16) ------------------------------------
export {
  GraphOwnMailboxAdapter,
  DEFAULT_MAILBOX,
  encodeDeltaCursor,
  decodeDeltaCursor,
  mapGraphMessage,
  type GraphMailClient,
  type GraphMessage,
  type GraphAttachment,
  type GraphDeltaPage,
  type GraphOwnMailboxAdapterOptions,
} from "./graphOwnMailboxAdapter.js";
