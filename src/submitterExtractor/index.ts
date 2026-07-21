/**
 * SubmitterExtractor (Task 8): non-blocking, audit-only body parsing that
 * recovers the real submitter address and surfaces the Contact Us form message
 * content used for classification.
 *
 * Marker layouts supported (Req 3.1):
 *  - Inline:  `...The sender's email submitter@example.com Message text...`
 *  - Newline: `...The sender's email\nsubmitter@example.com\nMessage\n...`
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */
import type { ForwardedEmail, Submitter_Email } from "../types/index.js";
import { UNAVAILABLE } from "../types/index.js";
import { isValidEmailFormat } from "../ruleSet/index.js";

/**
 * The literal marker label in notification bodies (Req 3.1).
 * The submitter address may appear on the same line (after a space) or on the
 * next line after optional whitespace.
 */
export const MARKER_PREFIX = "The sender's email";

/** @deprecated Use {@link MARKER_PREFIX}; kept for tests that build inline bodies. */
export const MARKER = `${MARKER_PREFIX} `;

export interface ExtractionResult {
  formMessageContent: string;
  submitterEmail: Submitter_Email;
}

function stripWrapping(token: string): string {
  return token
    .replace(/^[<("'[{]+/, "")
    .replace(/[)\]}>'".,;:!?]+$/, "");
}

/**
 * Surfaces the user-authored form text after the submitter line.
 * Strips the common `Message` section header when present.
 */
export function extractFormMessageContent(afterEmail: string, fullBody: string): string {
  let content = afterEmail.trim();
  const messageSection = content.match(/^Message\s*\r?\n([\s\S]*)$/i);
  if (messageSection) {
    content = messageSection[1]!.trim();
  }
  return content.length > 0 ? content : fullBody.trim();
}

export class SubmitterExtractor {
  extract(email: ForwardedEmail): ExtractionResult {
    const body = email.body ?? "";

    const markerIndex = body.indexOf(MARKER_PREFIX);
    if (markerIndex === -1) {
      return { formMessageContent: body.trim(), submitterEmail: UNAVAILABLE };
    }

    const afterMarker = body.slice(markerIndex + MARKER_PREFIX.length).replace(/^\s+/, "");
    const tokenMatch = afterMarker.match(/^\S+/);

    if (tokenMatch === null) {
      return { formMessageContent: body.trim(), submitterEmail: UNAVAILABLE };
    }

    const rawToken = tokenMatch[0];
    const candidate = stripWrapping(rawToken);
    const trailing = afterMarker.slice(rawToken.length);
    const formMessageContent = extractFormMessageContent(trailing, body);

    if (isValidEmailFormat(candidate)) {
      return { formMessageContent, submitterEmail: candidate };
    }

    return { formMessageContent, submitterEmail: UNAVAILABLE };
  }
}
