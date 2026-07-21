/**
 * Unit / example tests for the Email_Router native-forward invocation (Task 11.4).
 *
 * Asserts the router calls the native-forward port with the correct original
 * message id, category To recipients, mandatory IR CC, and that it authors no
 * new body content and sets no sender field (per the design's Testing Strategy).
 *
 * Requirements: 14.1, 14.2
 */
import { describe, it, expect } from "vitest";
import {
  EmailRouter,
  FORWARD_CC_RECIPIENT,
  buildForwardTargets,
  type ForwardPort,
  type ForwardResult,
} from "../../src/router/index.js";
import { seedRuleEntries } from "../../src/ruleSet/index.js";
import type { Decision, ForwardedEmail, RuleEntry } from "../../src/types/index.js";
import { EXPECTED_SENDER, EXPECTED_SUBJECT } from "../../src/notificationFilter/index.js";

/** A recording native-forward port: captures exactly what the router passed. */
class RecordingForwardPort implements ForwardPort {
  public calls: { messageId: string; recipients: string[]; cc?: string[] }[] = [];
  private readonly result: ForwardResult;

  constructor(result: ForwardResult = { ok: true }) {
    this.result = result;
  }

  forward(messageId: string, recipients: string[], cc?: string[]): ForwardResult {
    this.calls.push({
      messageId,
      recipients: [...recipients],
      cc: cc ? [...cc] : undefined,
    });
    return this.result;
  }
}

function makeEmail(overrides: Partial<ForwardedEmail> = {}): ForwardedEmail {
  return {
    messageId: "msg-123",
    relayEnvelopeSender: EXPECTED_SENDER,
    submitterEmail: "real.person@example.com",
    subject: EXPECTED_SUBJECT,
    body: "original body with The sender's email real.person@example.com and a message",
    formMessageContent: "a message",
    attachments: [{ filename: "a.pdf", contentBytes: new Uint8Array([1, 2, 3]) }],
    receivedAt: 5_000,
    ...overrides,
  };
}

const rules: RuleEntry[] = seedRuleEntries();

describe("Task 11.4 — native-forward invocation", () => {
  it("calls the port with the original message id, To recipients, and IR CC", () => {
    const port = new RecordingForwardPort({ ok: true });
    const router = new EmailRouter(port, { now: () => 9_000 });
    const email = makeEmail();
    const decision: Decision = {
      kind: "SingleCategory",
      category: "Domestic_Complaint",
      candidate: { category: "Domestic_Complaint", score: 0.9, reasoning: "complaint" },
    };

    const categoryRecipients = ["domestic-support@example.com", "domestic-support-lead@example.com"];
    const expected = buildForwardTargets(categoryRecipients);
    const outcome = router.route(email, decision, rules);

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]!.messageId).toBe("msg-123");
    expect(port.calls[0]!.recipients).toEqual(expected.to);
    expect(port.calls[0]!.cc).toEqual([FORWARD_CC_RECIPIENT]);

    expect(outcome.kind).toBe("Forwarded");
    if (outcome.kind !== "Forwarded") throw new Error("expected Forwarded");
    expect(outcome.recipients).toEqual(expected.all);
    expect(outcome.forwardedAt).toBe(9_000);
  });

  it("authors no new body/subject/sender — the port signature carries only id + recipients + cc", () => {
    const port = new RecordingForwardPort({ ok: true });
    const router = new EmailRouter(port);
    const email = makeEmail();
    const decision: Decision = {
      kind: "SingleCategory",
      category: "Business_Cooperation",
      candidate: { category: "Business_Cooperation", score: 0.95, reasoning: "investment" },
    };

    router.route(email, decision, rules);

    const call = port.calls[0]!;
    expect(Object.keys(call).sort()).toEqual(["cc", "messageId", "recipients"]);
    expect(email.body).toBe(
      "original body with The sender's email real.person@example.com and a message",
    );
    expect(email.subject).toBe(EXPECTED_SUBJECT);
  });

  it("does not depend on a successfully extracted submitter (forwards when unavailable)", () => {
    const port = new RecordingForwardPort({ ok: true });
    const router = new EmailRouter(port);
    const email = makeEmail({ submitterEmail: "unavailable" });
    const decision: Decision = {
      kind: "SingleCategory",
      category: "Flight_Complaint",
      candidate: { category: "Flight_Complaint", score: 0.8, reasoning: "flight" },
    };

    const expected = buildForwardTargets(["flight-complaints@example.com"]);
    const outcome = router.route(email, decision, rules);

    expect(outcome.kind).toBe("Forwarded");
    expect(port.calls[0]!.recipients).toEqual(expected.to);
    expect(port.calls[0]!.cc).toEqual([FORWARD_CC_RECIPIENT]);
  });

  it("dedupes IR CC when it is already a category To recipient", () => {
    const port = new RecordingForwardPort({ ok: true });
    const router = new EmailRouter(port);
    const email = makeEmail();
    const rulesWithIrCc: RuleEntry[] = [
      {
        category: "Test_Category",
        behavior: "FORWARD",
        recipients: ["team@example.com", FORWARD_CC_RECIPIENT],
        effectiveFrom: 0,
      },
    ];
    const decision: Decision = {
      kind: "SingleCategory",
      category: "Test_Category",
      candidate: { category: "Test_Category", score: 0.9, reasoning: "test" },
    };

    router.route(email, decision, rulesWithIrCc);

    expect(port.calls[0]!.recipients).toEqual(["team@example.com", FORWARD_CC_RECIPIENT]);
    expect(port.calls[0]!.cc).toBeUndefined();
  });
});
