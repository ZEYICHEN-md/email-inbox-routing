/**
 * GraphOwnMailboxAdapter (Task 16): the real own-mailbox Inbound Email Source.
 *
 * Implements the SAME `InboundEmailSource` interface as the mock (Task 5.1),
 * reading the user's own Exchange Online inbox (`user@example.com`) via
 * Microsoft Graph, scoped to that one mailbox. New messages are detected via a
 * Graph **delta query** against the inbox
 * (`GET /me/mailFolders/inbox/messages/delta`, or the equivalent
 * `/users/{user@example.com}/mailFolders/inbox/messages/delta`); Graph
 * change-notification subscriptions can drive the same fetch with polling as a
 * reconciliation fallback. Each Graph message is mapped to a `RawInboxEmail`.
 *
 * The concrete Graph transport (HTTP, auth token acquisition/refresh, delegated
 * vs. own-mailbox-scoped application permission) is deliberately abstracted
 * behind the injectable {@link GraphMailClient} interface, so this adapter can be
 * unit-tested with a fake client and no live network or credentials. Provisioning
 * the Graph credential/permission (app registration, admin consent, or an
 * Application Access Policy scoping to the single mailbox) is an environment-setup
 * step outside this code's scope.
 *
 * Cursor model: the adapter treats the `Cursor` as an opaque Graph delta token.
 * A start/unknown cursor triggers an initial delta sync; a delta-token cursor
 * resumes from that point. Message-id dedup downstream (IngestionTracker) makes
 * the exact-once guarantee robust regardless of delta-token replays.
 *
 * Requirements: 1.1, 1.3, 1.4, 1.5
 */
import type { Attachment, Cursor, RawInboxEmail, Timestamp } from "../types/index.js";
import { START_CURSOR, type ConnectionStatus, type InboundEmailSource } from "./index.js";

/** The default mailbox this adapter is scoped to. */
export const DEFAULT_MAILBOX = "user@example.com";

/** A Graph `fileAttachment`-shaped payload (base64 `contentBytes`). */
export interface GraphAttachment {
  name?: string | null;
  /** Base64-encoded file bytes, as returned by Graph `$value`/`contentBytes`. */
  contentBytes?: string | null;
}

/** The subset of a Graph `message` resource this adapter consumes. */
export interface GraphMessage {
  id: string;
  from?: { emailAddress?: { address?: string | null } | null } | null;
  subject?: string | null;
  body?: { content?: string | null; contentType?: string | null } | null;
  /** ISO-8601 timestamp, e.g. "2024-01-31T09:15:00Z". */
  receivedDateTime?: string | null;
  attachments?: GraphAttachment[] | null;
}

/** The result of a delta fetch: the changed messages plus the next delta token. */
export interface GraphDeltaPage {
  messages: GraphMessage[];
  /** Opaque token to pass on the next delta call to get subsequent changes. */
  nextDeltaToken: string;
}

/**
 * Injectable Microsoft Graph mail client. A production implementation wraps the
 * Graph SDK / REST calls (and token handling); tests provide a fake. Keeping the
 * transport behind this interface is what lets the adapter be unit-tested with
 * no live network or credentials.
 */
export interface GraphMailClient {
  /**
   * Fetches inbox changes via a delta query. When `deltaToken` is undefined the
   * client performs an initial delta sync; otherwise it resumes from the token.
   */
  fetchInboxDelta(deltaToken: string | undefined): GraphDeltaPage;
  /** Reports whether the Graph endpoint / mailbox is currently reachable. */
  isReachable(): boolean;
}

const DELTA_CURSOR_PREFIX = "graph-delta:";

/** Encodes a Graph delta token as an opaque cursor string. */
export function encodeDeltaCursor(deltaToken: string): Cursor {
  return `${DELTA_CURSOR_PREFIX}${deltaToken}`;
}

/**
 * Decodes a cursor to its Graph delta token, or `undefined` if the cursor is the
 * start sentinel or not a delta cursor (both mean "start an initial sync").
 */
export function decodeDeltaCursor(cursor: Cursor): string | undefined {
  if (cursor === START_CURSOR) return undefined;
  if (cursor.startsWith(DELTA_CURSOR_PREFIX)) {
    return cursor.slice(DELTA_CURSOR_PREFIX.length);
  }
  return undefined;
}

/** Parses a Graph ISO-8601 timestamp to epoch millis, defaulting to 0. */
function toTimestamp(iso: string | null | undefined): Timestamp {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** Decodes a base64 attachment payload into raw bytes. */
function decodeBase64(content: string | null | undefined): Uint8Array {
  if (!content) return new Uint8Array(0);
  // Node's Buffer is available (types: ["node"]); avoids extra dependencies.
  return new Uint8Array(Buffer.from(content, "base64"));
}

/** Maps a Graph message to the pipeline's `RawInboxEmail` shape. */
export function mapGraphMessage(msg: GraphMessage): RawInboxEmail {
  const from = msg.from?.emailAddress?.address ?? null;
  const attachments: Attachment[] = (msg.attachments ?? []).map((a) => ({
    filename: a.name ?? "",
    contentBytes: decodeBase64(a.contentBytes),
  }));
  return {
    messageId: msg.id,
    from,
    subject: msg.subject ?? null,
    body: msg.body?.content ?? "",
    attachments,
    receivedAt: toTimestamp(msg.receivedDateTime),
  };
}

export interface GraphOwnMailboxAdapterOptions {
  /** The mailbox this adapter reads (default `user@example.com`). */
  mailbox?: string;
}

/**
 * The real own-mailbox adapter. Reads the user's own inbox via the injected
 * {@link GraphMailClient} using delta queries, mapping each Graph message to a
 * `RawInboxEmail`. Implements the same `InboundEmailSource` contract as the mock.
 */
export class GraphOwnMailboxAdapter implements InboundEmailSource {
  private readonly client: GraphMailClient;
  private readonly mailbox: string;
  /** The most recent delta token returned by the client (for continuation). */
  private latestDeltaToken: string | undefined;
  /** The last cursor acknowledged as safely processed. */
  private acknowledgedCursor: Cursor = START_CURSOR;

  constructor(client: GraphMailClient, options: GraphOwnMailboxAdapterOptions = {}) {
    this.client = client;
    this.mailbox = options.mailbox ?? DEFAULT_MAILBOX;
  }

  /** The mailbox this adapter is scoped to. */
  getMailbox(): string {
    return this.mailbox;
  }

  /**
   * Fetches inbox messages that changed since `cursor` via a Graph delta query,
   * mapping each to a `RawInboxEmail`. A start/unknown cursor triggers an initial
   * sync. The returned page's delta token is retained so `latestCursor()` can
   * expose the position to advance to.
   */
  fetchNewMessages(cursor: Cursor): RawInboxEmail[] {
    const deltaToken = decodeDeltaCursor(cursor) ?? this.latestDeltaToken;
    const page = this.client.fetchInboxDelta(deltaToken);
    this.latestDeltaToken = page.nextDeltaToken;
    return page.messages.map(mapGraphMessage);
  }

  /**
   * Records the cursor as the last safely processed position. Persisting this
   * (in production, durably) lets a restart or outage-recovery pass resume from a
   * known-good delta token rather than re-syncing the whole inbox (Req 1.5).
   */
  acknowledge(_messageId: string, cursor: Cursor): void {
    this.acknowledgedCursor = cursor;
  }

  /** Reports mailbox connectivity health via the injected client (Req 1.4). */
  healthCheck(): ConnectionStatus {
    return this.client.isReachable() ? "connected" : "disconnected";
  }

  /** The cursor for the most recent delta token (the position to resume from). */
  latestCursor(): Cursor {
    return this.latestDeltaToken === undefined
      ? START_CURSOR
      : encodeDeltaCursor(this.latestDeltaToken);
  }

  /** The last cursor acknowledged via {@link acknowledge}. */
  getAcknowledgedCursor(): Cursor {
    return this.acknowledgedCursor;
  }
}
