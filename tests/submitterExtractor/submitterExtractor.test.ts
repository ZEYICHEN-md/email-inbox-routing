/**
 * Unit / example tests for the SubmitterExtractor (Task 8.6).
 *
 * Anchors the extractor against representative REAL Contact Us notification
 * bodies (the actual `"The sender's email "` marker layout) to confirm the
 * marker/format assumptions hold against real samples, end-to-end.
 *
 * Two real example bodies from the spec conversation are used as fixtures:
 *   - one from amalzuria.jadid@bibd.com.bn
 *   - one from priyalbiz30@gmail.com
 * Both begin:
 *   "<email> sent a message using the contact form at
 *    https://example.com/contact-us.The sender's email <email>"
 *
 * Requirements: 3.1, 3.2, 3.3
 */
import { describe, it, expect } from "vitest";
import { SubmitterExtractor, MARKER, MARKER_PREFIX } from "../../src/submitterExtractor/index.js";
import type { ForwardedEmail } from "../../src/types/index.js";
import { UNAVAILABLE } from "../../src/types/index.js";
import { EXPECTED_SENDER, EXPECTED_SUBJECT } from "../../src/notificationFilter/index.js";

const CONTACT_URL = "https://example.com/contact-us";

/**
 * Builds a body in the real notification layout: the submitter's address appears
 * BEFORE the marker (in the "X sent a message..." framing) and again AFTER the
 * marker. Only the address after the marker must be extracted (Req 3.2).
 */
function realBody(submitter: string, message: string): string {
  return `${submitter} sent a message using the contact form at ${CONTACT_URL}.${MARKER}${submitter} ${message}`;
}

function makeForwarded(body: string): ForwardedEmail {
  return {
    messageId: "real-1",
    relayEnvelopeSender: EXPECTED_SENDER,
    submitterEmail: UNAVAILABLE,
    subject: EXPECTED_SUBJECT,
    body,
    formMessageContent: "",
    attachments: [],
    receivedAt: 1_700_000_000_000,
  };
}

describe("SubmitterExtractor — real notification body anchor", () => {
  const extractor = new SubmitterExtractor();

  it("extracts amalzuria.jadid@bibd.com.bn from the real body layout", () => {
    const submitter = "amalzuria.jadid@bibd.com.bn";
    const message = "I would like information about your investor relations program.";
    const result = extractor.extract(makeForwarded(realBody(submitter, message)));

    expect(result.submitterEmail).toBe(submitter);
    // Form content is the trailing message, not the relay subject/sender.
    expect(result.formMessageContent).toContain("investor relations program");
    expect(result.formMessageContent).not.toBe(EXPECTED_SUBJECT);
    expect(result.formMessageContent).not.toBe(EXPECTED_SENDER);
  });

  it("extracts priyalbiz30@gmail.com from the real body layout", () => {
    const submitter = "priyalbiz30@gmail.com";
    const message = "We are interested in a business cooperation opportunity.";
    const result = extractor.extract(makeForwarded(realBody(submitter, message)));

    expect(result.submitterEmail).toBe(submitter);
    expect(result.formMessageContent).toContain("business cooperation");
  });

  it("extracts the address at the very end of the body (no trailing message)", () => {
    // Some notifications end right after the submitter address.
    const submitter = "priyalbiz30@gmail.com";
    const body = `${submitter} sent a message using the contact form at ${CONTACT_URL}.${MARKER}${submitter}`;
    const result = extractor.extract(makeForwarded(body));

    expect(result.submitterEmail).toBe(submitter);
    // With no trailing message, form content falls back to the full body.
    expect(result.formMessageContent.length).toBeGreaterThan(0);
  });

  it("ignores the pre-marker address and any in-message address, taking only the post-marker one", () => {
    // Different address before the marker and inside the message — both ignored.
    const preMarker = "someoneelse@example.com";
    const submitter = "amalzuria.jadid@bibd.com.bn";
    const inMessage = "reply-to@other.org";
    const body =
      `${preMarker} sent a message using the contact form at ${CONTACT_URL}.` +
      `${MARKER}${submitter} Please also copy ${inMessage} on the response.`;

    const result = extractor.extract(makeForwarded(body));

    expect(result.submitterEmail).toBe(submitter);
    expect(result.submitterEmail).not.toBe(preMarker);
    expect(result.submitterEmail).not.toBe(inMessage);
  });

  it("extracts submitter when marker and email are on separate lines (real layout)", () => {
    const submitter = "work.atradiputra@gmail.com";
    const body =
      `${submitter} sent a message using the contact form at ${CONTACT_URL}.\n` +
      `${MARKER_PREFIX}\n${submitter} \nMessage\nHalo, tim id.trip — media partnership inquiry.`;

    const result = extractor.extract(makeForwarded(body));

    expect(result.submitterEmail).toBe(submitter);
    expect(result.formMessageContent).toContain("Halo, tim id.trip");
    expect(result.formMessageContent).not.toContain("First Name");
    expect(result.formMessageContent).not.toMatch(/^Message\s*$/m);
  });

  it("extracts priyalbiz30@gmail.com from newline marker layout", () => {
    const submitter = "priyalbiz30@gmail.com";
    const body =
      `${submitter} sent a message using the contact form at ${CONTACT_URL}.\n` +
      `${MARKER_PREFIX}\n${submitter} \nMessage\nI am writing regarding my hotel booking.`;

    const result = extractor.extract(makeForwarded(body));

    expect(result.submitterEmail).toBe(submitter);
    expect(result.formMessageContent).toBe("I am writing regarding my hotel booking.");
  });
});
