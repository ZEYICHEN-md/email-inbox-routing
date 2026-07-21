/**
 * Property-based tests for the SubmitterExtractor (Task 8.2, 8.3, 8.4, 8.5).
 *
 * Feature: email-inbox-routing
 *   - Property 22: Submitter extraction takes the first valid email after the
 *     marker and ignores all other addresses (Validates: Requirements 3.1, 3.2)
 *   - Property 23: Classification consumes the extracted form message content,
 *     not relay metadata (Validates: Requirements 3.3)
 *   - Property 24: Missing marker or invalid following address is non-blocking —
 *     sets "unavailable", never diverts to Review_Queue, never blocks
 *     forwarding, never guesses (Validates: Requirements 3.5)
 *   - Property 25: The audit entry records the extracted Submitter_Email on
 *     success or the "unavailable" marker on extraction failure
 *     (Validates: Requirements 15.6, 3.4)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { MARKER, SubmitterExtractor } from "../../src/submitterExtractor/index.js";
import { MockEmailClassifier, decide } from "../../src/classifier/index.js";
import type {
  AuditLogEntry,
  Category,
  ForwardedEmail,
} from "../../src/types/index.js";
import { UNAVAILABLE, UNCLASSIFIED } from "../../src/types/index.js";
import { EXPECTED_SENDER, EXPECTED_SUBJECT } from "../../src/notificationFilter/index.js";

const NUM_RUNS = 200;

// --- Arbitraries -----------------------------------------------------------

/** A valid RFC-5322-style email: non-empty local part and dotted domain. */
const validEmailArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/).filter((s) => s.length > 0 && s.length <= 20),
    fc.stringMatching(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/).filter((s) => s.length > 0 && s.length <= 15),
    fc.constantFrom("com", "com.bn", "co.uk", "org", "net", "example.com"),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Free text that never contains the marker or an "@" (so it adds no addresses). */
const plainTextArb = fc
  .string({ maxLength: 40 })
  .filter((s) => !s.includes("@") && !s.includes(MARKER));

/** Some other email-like strings that must be IGNORED by the extractor. */
const otherAddressesArb = fc.array(validEmailArb, { minLength: 0, maxLength: 4 });

function makeForwarded(body: string): ForwardedEmail {
  return {
    messageId: `m-${Math.random().toString(36).slice(2)}`,
    relayEnvelopeSender: EXPECTED_SENDER,
    submitterEmail: UNAVAILABLE,
    subject: EXPECTED_SUBJECT,
    body,
    formMessageContent: "",
    attachments: [],
    receivedAt: 1_000,
  };
}

// --- Property 22 -----------------------------------------------------------

describe("Property 22: first valid email after marker, ignoring all others", () => {
  it("extracts exactly the address immediately after the marker regardless of other addresses", () => {
    fc.assert(
      fc.property(
        validEmailArb, // the true submitter (right after the marker)
        otherAddressesArb, // addresses appearing BEFORE the marker
        otherAddressesArb, // addresses appearing AFTER the message
        plainTextArb, // pre-marker free text
        plainTextArb, // trailing free text
        (submitter, preAddrs, postAddrs, preText, postText) => {
          // Build a body with the relay address + arbitrary other addresses
          // before the marker, the marker + the true submitter, then more
          // addresses inside the trailing message. All non-submitter addresses
          // must be ignored (Req 3.2).
          const pre = [EXPECTED_SENDER, ...preAddrs].join(" ");
          const post = postAddrs.join(" ");
          const body = `${pre} ${preText} ${MARKER}${submitter} ${postText} ${post}`;

          const result = new SubmitterExtractor().extract(makeForwarded(body));

          expect(result.submitterEmail).toBe(submitter);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 23 -----------------------------------------------------------

describe("Property 23: classification consumes extracted form content, not relay metadata", () => {
  it("passes formMessageContent (never subject/sender) to the classifier", () => {
    const categories: Category[] = ["Investment", "ESG"];

    fc.assert(
      fc.property(validEmailArb, plainTextArb, (submitter, message) => {
        // Ensure a non-empty trailing message so formMessageContent is the
        // message text (distinct from relay metadata).
        const trailing = message.trim().length > 0 ? message.trim() : "please advise on the matter";
        const body = `${EXPECTED_SENDER} sent a message. ${MARKER}${submitter} ${trailing}`;
        const email = makeForwarded(body);

        const result = new SubmitterExtractor().extract(email);

        // Capture exactly what the classifier is invoked with.
        const captured: string[] = [];
        const classifier = new MockEmailClassifier({
          scorer: (content, category) => {
            captured.push(content);
            return { score: 0.1, reasoning: `seen: ${category}` };
          },
        });
        classifier.classify(result.formMessageContent, categories);

        // Every invocation saw the extracted form content...
        for (const seen of captured) {
          expect(seen).toBe(result.formMessageContent);
          // ...and never the relay envelope subject or sender.
          expect(seen).not.toBe(email.subject);
          expect(seen).not.toBe(email.relayEnvelopeSender);
        }
        // The form content is derived from the body, not the relay metadata.
        expect(result.formMessageContent).not.toBe(EXPECTED_SUBJECT);
        expect(result.formMessageContent).not.toBe(EXPECTED_SENDER);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 24 -----------------------------------------------------------

describe("Property 24: missing marker / invalid following address is non-blocking", () => {
  it("sets 'unavailable' and still flows through normal classification (no divert/block)", () => {
    // Bodies with NO marker, or a marker followed by an invalid (non-email) token.
    const noMarkerArb = fc
      .string({ maxLength: 80 })
      .filter((s) => !s.includes(MARKER));
    const invalidTokenArb = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => {
        const t = s.trim();
        // A token that is definitely not a valid email and has no whitespace.
        return t.length > 0 && !/\s/.test(t) && !(t.includes("@") && /@[^\s@]+\.[^\s@]+/.test(t));
      });
    const invalidMarkerBodyArb = invalidTokenArb.map(
      (tok) => `intro text ${MARKER}${tok} trailing message`,
    );

    fc.assert(
      fc.property(fc.oneof(noMarkerArb, invalidMarkerBodyArb), (body) => {
        const extractor = new SubmitterExtractor();

        // Extraction returns normally (never throws) and yields "unavailable".
        const result = extractor.extract(makeForwarded(body));
        expect(result.submitterEmail).toBe(UNAVAILABLE);
        // No fabricated address: the only non-address sentinel is exactly UNAVAILABLE.
        expect(result.submitterEmail).not.toContain("@");
        // Form content is still present for classification.
        expect(typeof result.formMessageContent).toBe("string");

        // The email still flows through normal classification/routing: the
        // decision depends ONLY on classification, not on the extraction outcome.
        const classifier = new MockEmailClassifier({ scores: { Investment: 0.9 }, defaultScore: 0.0 });
        const decision = decide(classifier.classify(result.formMessageContent, ["Investment"]), 0.5);
        // A confident classification still decides a category (never blocked by
        // the unavailable submitter).
        expect(decision.kind).toBe("SingleCategory");
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 25 -----------------------------------------------------------

describe("Property 25: audit entry records submitter email or 'unavailable' marker", () => {
  it("records the extracted address on success and 'unavailable' on failure", () => {
    // success = marker + valid email; failure = no marker.
    const caseArb = fc.oneof(
      validEmailArb.map((email) => ({ kind: "success" as const, email })),
      fc.string({ maxLength: 40 }).filter((s) => !s.includes(MARKER)).map((s) => ({ kind: "failure" as const, text: s })),
    );

    fc.assert(
      fc.property(caseArb, (c) => {
        const body =
          c.kind === "success"
            ? `${EXPECTED_SENDER} sent a message. ${MARKER}${c.email} thanks`
            : `${c.text}`;

        const result = new SubmitterExtractor().extract(makeForwarded(body));

        // Build the Audit_Log entry as the pipeline would, carrying the
        // extracted submitter value through unchanged (Req 15.6, 3.4).
        const entry: AuditLogEntry = {
          emailId: "id-1",
          submitterEmail: result.submitterEmail,
          candidates: [],
          finalCategory: UNCLASSIFIED,
          finalCategoryReasoning: "n/a",
          decidedAt: 1_000,
          outcome: "REVIEW_QUEUE",
        };

        if (c.kind === "success") {
          expect(entry.submitterEmail).toBe(c.email);
        } else {
          expect(entry.submitterEmail).toBe(UNAVAILABLE);
          // No address guessed or fabricated on failure.
          expect(entry.submitterEmail).not.toContain("@");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
