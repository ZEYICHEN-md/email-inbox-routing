/**
 * Email_Router (Task 11): native-forward invocation and routing outcome handling.
 *
 * The router NEVER constructs or reconstructs an outbound message. It performs a
 * **native forward** of the original Contact_Us_Notification — modeled here as a
 * call to an injectable {@link ForwardPort} whose only inputs are the original
 * message id and the target recipients. In production the port is backed by
 * Microsoft Graph's `POST /messages/{id}/forward` action (equivalent to clicking
 * "Forward" in Outlook); in tests it is stubbed. Because the port is addressed
 * purely by `messageId`, the native forward inherently carries the entire
 * original notification — original body verbatim (including the embedded
 * `"The sender's email X"` line), original subject, and all original attachments.
 * The router therefore:
 *   - authors NO new email body content,
 *   - adds NO category tag/label (no `[Category: ...]` subject prefix, no banner),
 *   - sets NO "original sender" or other sender field.
 *
 * The extracted `Submitter_Email` is recorded only in the Audit_Log, never
 * stamped onto the forwarded message; forwarding does not depend on a
 * successfully extracted submitter (an email that reaches a FORWARD decision is
 * forwarded regardless — Req 3.4).
 *
 * `route(email, decision, ruleSetSnapshot)` maps a classification `Decision` and
 * a resolved rule-set snapshot to a `RoutingOutcome`:
 *   - FORWARD-behavior category  -> native forward to exactly the configured
 *     recipients -> `Forwarded`, or `ForwardFailed` on delivery failure;
 *   - NO_FORWARD_RESOLVE category -> `NoForwardResolved` (no send, guidance note);
 *   - Unclassified / Ambiguous / NO_FORWARD_REVIEW -> `SentToReview` (zero
 *     forward attempts).
 * On delivery failure the original content is retained (a native forward never
 * mutates the source message) and a `ForwardFailed` outcome is produced for the
 * Audit_Log + Review_Queue hand-off (Req 14.3).
 *
 * Requirements: 5.1–5.4, 6.1–6.8, 7.1–7.3, 8.1–8.3, 9.1–9.3, 10.1–10.5, 11.1,
 * 11.2, 12.1, 12.2, 13.1, 13.2, 14.1, 14.2, 14.3, 3.4
 */
import type {
  ForwardedEmail,
  Decision,
  RoutingOutcome,
  RuleEntry,
  Timestamp,
} from "../types/index.js";

/** Always CC'd on every FORWARD native-forward action. */
export const FORWARD_CC_RECIPIENT = "inbox-cc@example.com";

/**
 * Builds To/CC targets for a forward: category recipients as To, plus the IR
 * relationship mailbox as CC (deduped when already in To).
 */
export function buildForwardTargets(categoryRecipients: readonly string[]): {
  to: string[];
  cc: string[];
  all: string[];
} {
  const to = [...categoryRecipients];
  const ccAlreadyInTo = to.some(
    (r) => r.toLowerCase() === FORWARD_CC_RECIPIENT.toLowerCase(),
  );
  const cc = ccAlreadyInTo ? [] : [FORWARD_CC_RECIPIENT];
  return { to, cc, all: [...to, ...cc] };
}

/** @deprecated Use {@link buildForwardTargets}. */
export const resolveForwardTargets = (configuredRecipients: readonly string[]) => {
  const { to, cc } = buildForwardTargets(configuredRecipients);
  return { toRecipients: to, ccRecipients: cc };
};

/** @deprecated Use {@link buildForwardTargets}. */
export const allForwardTargets = (configuredRecipients: readonly string[]) =>
  buildForwardTargets(configuredRecipients).all;

/** The result of a native-forward invocation against the {@link ForwardPort}. */
export interface ForwardResult {
  /** True when the native forward was accepted/delivered. */
  ok: boolean;
  /** A failure reason, present when `ok` is false. */
  error?: string;
}

/**
 * The injectable native-forward port. Its signature deliberately accepts ONLY
 * the original message id, To recipients, and optional CC recipients — it has
 * no parameter for a body, subject, or sender, which is precisely why a native
 * forward cannot author new content or set a sender field. Backed by Microsoft
 * Graph's `POST /messages/{id}/forward` in production; stubbed in tests.
 */
export interface ForwardPort {
  /**
   * Natively forwards the original message identified by `messageId` to
   * `recipients` (To), optionally copying `cc`, carrying the original body,
   * subject, and attachments intact.
   */
  forward(
    messageId: string,
    recipients: string[],
    cc?: string[],
  ): ForwardResult | Promise<ForwardResult>;
}

export interface EmailRouterOptions {
  /** Clock used to stamp forward timestamps (defaults to `Date.now`). */
  now?: () => Timestamp;
}

/**
 * The Email_Router. Given a decided category and a rule-set snapshot, it either
 * natively forwards the original notification, resolves silently, or hands off
 * to review — never authoring new content.
 */
export class EmailRouter {
  private readonly forwardPort: ForwardPort;
  private readonly now: () => Timestamp;

  constructor(forwardPort: ForwardPort, options: EmailRouterOptions = {}) {
    this.forwardPort = forwardPort;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Routes an admitted `ForwardedEmail` according to its classification
   * `Decision` and the `ruleSetSnapshot` in effect when forwarding began
   * (captured once per email for cutover stability — Req 16.5).
   */
  route(
    email: ForwardedEmail,
    decision: Decision,
    ruleSetSnapshot: RuleEntry[],
  ): RoutingOutcome {
    switch (decision.kind) {
      // Req 13.1 — Unclassified never forwards; goes to Review_Queue.
      case "Unclassified":
        return { kind: "SentToReview" };

      // Req 13.2 / 9.3 — two or more qualifying candidates: ambiguous, never
      // forwarded to any candidate's recipients; carry the full candidate set.
      case "Ambiguous":
        return { kind: "SentToReview", candidates: decision.candidates };

      case "SingleCategory": {
        const entry = ruleSetSnapshot.find((e) => e.category === decision.category);
        // No mapping in effect for the decided category: treat as review-required
        // rather than guessing a recipient.
        if (entry === undefined) {
          return { kind: "SentToReview" };
        }
        return this.routeByBehavior(email, entry);
      }
    }
  }

  /** Async variant for production forward ports (e.g. Microsoft Graph). */
  async routeAsync(
    email: ForwardedEmail,
    decision: Decision,
    ruleSetSnapshot: RuleEntry[],
  ): Promise<RoutingOutcome> {
    switch (decision.kind) {
      case "Unclassified":
        return { kind: "SentToReview" };
      case "Ambiguous":
        return { kind: "SentToReview", candidates: decision.candidates };
      case "SingleCategory": {
        const entry = ruleSetSnapshot.find((e) => e.category === decision.category);
        if (entry === undefined) return { kind: "SentToReview" };
        return this.routeByBehaviorAsync(email, entry);
      }
    }
  }

  /** Applies the rule entry's behavior to a single decided category. */
  private routeByBehavior(email: ForwardedEmail, entry: RuleEntry): RoutingOutcome {
    switch (entry.behavior) {
      // Req 11.1, 11.2, 12.1, 12.2 — no-forward-resolve: mark processed, no send,
      // carry the guidance note (if any).
      case "NO_FORWARD_RESOLVE":
        return entry.guidanceNote !== undefined
          ? { kind: "NoForwardResolved", guidanceNote: entry.guidanceNote }
          : { kind: "NoForwardResolved" };

      // Req 9.3 — review-required category: never forwarded.
      case "NO_FORWARD_REVIEW":
        return { kind: "SentToReview" };

      // FORWARD categories (Req 5–10): native forward to configured recipients,
      // always CC'ing inbox-cc@example.com.
      case "FORWARD":
        return this.nativeForward(email, entry.recipients);
    }
  }

  private async routeByBehaviorAsync(
    email: ForwardedEmail,
    entry: RuleEntry,
  ): Promise<RoutingOutcome> {
    switch (entry.behavior) {
      case "NO_FORWARD_RESOLVE":
        return entry.guidanceNote !== undefined
          ? { kind: "NoForwardResolved", guidanceNote: entry.guidanceNote }
          : { kind: "NoForwardResolved" };
      case "NO_FORWARD_REVIEW":
        return { kind: "SentToReview" };
      case "FORWARD":
        return this.nativeForwardAsync(email, entry.recipients);
    }
  }

  /**
   * Performs the native forward by invoking the port with the original message id,
   * category To recipients, and the mandatory IR CC. Authors no body, sets no
   * sender field. On success returns `Forwarded`; on failure returns
   * `ForwardFailed` while the original content remains intact (Req 14.1–14.3).
   */
  private nativeForward(email: ForwardedEmail, categoryRecipients: string[]): RoutingOutcome {
    const { to, cc, all } = buildForwardTargets(categoryRecipients);
    const result = this.forwardPort.forward(email.messageId, to, cc.length > 0 ? cc : undefined);
    if (result instanceof Promise) {
      throw new Error("Async forward port requires routeAsync()");
    }
    if (result.ok) {
      return { kind: "Forwarded", recipients: all, forwardedAt: this.now() };
    }
    return {
      kind: "ForwardFailed",
      attemptedRecipients: all,
      error: result.error ?? "native forward failed",
    };
  }

  private async nativeForwardAsync(
    email: ForwardedEmail,
    categoryRecipients: string[],
  ): Promise<RoutingOutcome> {
    const { to, cc, all } = buildForwardTargets(categoryRecipients);
    const result = await this.forwardPort.forward(email.messageId, to, cc.length > 0 ? cc : undefined);
    if (result.ok) {
      return { kind: "Forwarded", recipients: all, forwardedAt: this.now() };
    }
    return {
      kind: "ForwardFailed",
      attemptedRecipients: all,
      error: result.error ?? "native forward failed",
    };
  }
}
