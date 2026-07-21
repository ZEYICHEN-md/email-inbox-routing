/**
 * Unit tests for the GraphOwnMailboxAdapter (Task 16.1).
 *
 * Uses a FAKE GraphMailClient so the adapter is exercised without any live
 * network or credentials. Verifies:
 *   - Graph messages are mapped to RawInboxEmail (from/subject/body/attachments/
 *     receivedAt), including base64 attachment decoding and null-header handling
 *   - delta continuation: an initial sync followed by a resume from the delta token
 *   - the cursor round-trips the delta token
 *   - healthCheck reflects the client's reachability
 *   - the adapter satisfies the same InboundEmailSource contract as the mock,
 *     so it can drive the pipeline (a genuine notification is forwarded)
 *
 * Requirements: 1.1, 1.3, 1.4, 1.5
 */
import { describe, it, expect } from "vitest";
import {
  GraphOwnMailboxAdapter,
  DEFAULT_MAILBOX,
  decodeDeltaCursor,
  encodeDeltaCursor,
  type GraphDeltaPage,
  type GraphMailClient,
  type GraphMessage,
  type InboundEmailSource,
} from "../../src/inboundEmailSource/index.js";
import { START_CURSOR } from "../../src/inboundEmailSource/index.js";
import { RoutingPipeline } from "../../src/pipeline/index.js";
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

/**
 * A fake Graph client. Delivers pre-programmed delta pages in sequence; each
 * `fetchInboxDelta` call returns the next page. Tracks the delta tokens it was
 * called with so continuation can be asserted.
 */
class FakeGraphMailClient implements GraphMailClient {
  public calledWith: (string | undefined)[] = [];
  private pageIndex = 0;
  constructor(
    private readonly pages: GraphDeltaPage[],
    private reachable = true,
  ) {}

  fetchInboxDelta(deltaToken: string | undefined): GraphDeltaPage {
    this.calledWith.push(deltaToken);
    const page = this.pages[this.pageIndex] ?? {
      messages: [],
      nextDeltaToken: this.pages[this.pages.length - 1]?.nextDeltaToken ?? "empty",
    };
    if (this.pageIndex < this.pages.length - 1) this.pageIndex++;
    return page;
  }

  isReachable(): boolean {
    return this.reachable;
  }

  setReachable(value: boolean): void {
    this.reachable = value;
  }
}

function graphMessage(overrides: Partial<GraphMessage> & { id: string }): GraphMessage {
  return {
    from: { emailAddress: { address: "someone@example.com" } },
    subject: "hello",
    body: { content: "body text", contentType: "text" },
    receivedDateTime: "2024-01-31T09:15:00Z",
    attachments: [],
    ...overrides,
  };
}

describe("GraphOwnMailboxAdapter", () => {
  it("defaults to the user@example.com mailbox", () => {
    const adapter = new GraphOwnMailboxAdapter(new FakeGraphMailClient([]));
    expect(adapter.getMailbox()).toBe(DEFAULT_MAILBOX);
    expect(DEFAULT_MAILBOX).toBe("user@example.com");
  });

  it("maps Graph messages to RawInboxEmail, decoding base64 attachments", () => {
    const helloBytes = Buffer.from("hello").toString("base64");
    const client = new FakeGraphMailClient([
      {
        messages: [
          graphMessage({
            id: "msg-1",
            from: { emailAddress: { address: "sender@corp.com" } },
            subject: "A subject",
            body: { content: "the body", contentType: "html" },
            receivedDateTime: "2024-01-31T09:15:00Z",
            attachments: [{ name: "note.txt", contentBytes: helloBytes }],
          }),
        ],
        nextDeltaToken: "token-1",
      },
    ]);
    const adapter = new GraphOwnMailboxAdapter(client);

    const [email] = adapter.fetchNewMessages(START_CURSOR);

    expect(email!.messageId).toBe("msg-1");
    expect(email!.from).toBe("sender@corp.com");
    expect(email!.subject).toBe("A subject");
    expect(email!.body).toBe("the body");
    expect(email!.receivedAt).toBe(Date.parse("2024-01-31T09:15:00Z"));
    expect(email!.attachments).toHaveLength(1);
    expect(email!.attachments[0]!.filename).toBe("note.txt");
    expect(Buffer.from(email!.attachments[0]!.contentBytes).toString("utf8")).toBe("hello");
  });

  it("maps missing/null headers to null (so NotificationFilter can skip them)", () => {
    const client = new FakeGraphMailClient([
      {
        messages: [graphMessage({ id: "msg-2", from: null, subject: null, body: null })],
        nextDeltaToken: "token-x",
      },
    ]);
    const adapter = new GraphOwnMailboxAdapter(client);

    const [email] = adapter.fetchNewMessages(START_CURSOR);

    expect(email!.from).toBeNull();
    expect(email!.subject).toBeNull();
    expect(email!.body).toBe("");
    expect(email!.attachments).toEqual([]);
  });

  it("performs an initial delta sync then resumes from the delta token", () => {
    const client = new FakeGraphMailClient([
      { messages: [graphMessage({ id: "a" })], nextDeltaToken: "token-1" },
      { messages: [graphMessage({ id: "b" })], nextDeltaToken: "token-2" },
    ]);
    const adapter = new GraphOwnMailboxAdapter(client);

    // Initial sync: start sentinel -> undefined delta token.
    const first = adapter.fetchNewMessages(START_CURSOR);
    expect(first.map((e) => e.messageId)).toEqual(["a"]);
    expect(adapter.latestCursor()).toBe(encodeDeltaCursor("token-1"));

    // Resume: pass the cursor from the first page -> continues from token-1.
    const second = adapter.fetchNewMessages(adapter.latestCursor());
    expect(second.map((e) => e.messageId)).toEqual(["b"]);
    expect(client.calledWith).toEqual([undefined, "token-1"]);
    expect(adapter.latestCursor()).toBe(encodeDeltaCursor("token-2"));
  });

  it("round-trips the delta token through the cursor encoding", () => {
    expect(decodeDeltaCursor(START_CURSOR)).toBeUndefined();
    expect(decodeDeltaCursor(encodeDeltaCursor("abc"))).toBe("abc");
    expect(decodeDeltaCursor("some-unknown-cursor")).toBeUndefined();
  });

  it("reports connectivity health from the client (Req 1.4)", () => {
    const client = new FakeGraphMailClient([], true);
    const adapter = new GraphOwnMailboxAdapter(client);
    expect(adapter.healthCheck()).toBe("connected");
    client.setReachable(false);
    expect(adapter.healthCheck()).toBe("disconnected");
  });

  it("satisfies the InboundEmailSource contract and drives the pipeline end-to-end", () => {
    // A genuine Contact_Us_Notification delivered via Graph should be forwarded.
    const notificationBody =
      "New Contact Us submission.\nThe sender's email person@example.com\nDetails: [Domestic_Complaint]";
    const client = new FakeGraphMailClient([
      {
        messages: [
          graphMessage({
            id: "graph-note-1",
            from: { emailAddress: { address: EXPECTED_SENDER } },
            subject: EXPECTED_SUBJECT,
            body: { content: notificationBody, contentType: "text" },
          }),
        ],
        nextDeltaToken: "token-1",
      },
    ]);
    const adapter: InboundEmailSource = new GraphOwnMailboxAdapter(client);

    const store = new InMemoryAuditLogStore();
    const forwardCalls: { messageId: string; recipients: string[]; cc?: string[] }[] = [];
    const port: ForwardPort = {
      forward(messageId: string, recipients: string[], cc?: string[]): ForwardResult {
        forwardCalls.push({
          messageId,
          recipients: [...recipients],
          cc: cc ? [...cc] : undefined,
        });
        return { ok: true };
      },
    };

    const pipeline = new RoutingPipeline(
      {
        source: adapter,
        filter: new NotificationFilter(),
        ingestion: new IngestionTracker(adapter),
        extractor: new SubmitterExtractor(),
        classifier: new MockEmailClassifier({
          scorer: (content, category) => ({
            score: content.includes(`[${category}]`) ? 0.95 : 0.05,
            reasoning: `mock reasoning for ${category}`,
          }),
        }),
        router: new EmailRouter(port, { now: () => 1 }),
        ruleManager: new RuleManager(),
        auditLog: new AuditLog(store, new InMemoryErrorChannel()),
        reviewQueue: new ReviewQueue(),
      },
      { threshold: 0.5, now: () => 1 },
    );

    const results = pipeline.runOnce();

    expect(results).toHaveLength(1);
    expect(results[0]!.disposition).toBe("FORWARDED");
    const domestic = buildForwardTargets(["domestic-support@example.com", "domestic-support-lead@example.com"]);
    expect(forwardCalls).toEqual([
      {
        messageId: "graph-note-1",
        recipients: domestic.to,
        cc: domestic.cc,
      },
    ]);
    expect(store.getEntries()[0]!.submitterEmail).toBe("person@example.com");
  });
});
