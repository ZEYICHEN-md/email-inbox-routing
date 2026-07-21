/**
 * Production Microsoft Graph mail client (REST, delegated /me).
 */
import type {
  GraphDeltaPage,
  GraphMessage,
} from "../inboundEmailSource/graphOwnMailboxAdapter.js";
import type { GraphAuthProvider } from "./auth.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface HttpGraphClientOptions {
  auth: GraphAuthProvider;
  /** Use /me (delegated) or /users/{mailbox} */
  mailbox?: string;
}

export class HttpGraphClient {
  private readonly auth: GraphAuthProvider;
  private readonly mailRoot: string;
  private lastReachable = true;

  constructor(options: HttpGraphClientOptions) {
    this.auth = options.auth;
    this.mailRoot = options.mailbox ? `/users/${encodeURIComponent(options.mailbox)}` : "/me";
  }

  isReachable(): boolean {
    return this.lastReachable;
  }

  async fetchInboxDeltaAsync(deltaToken: string | undefined): Promise<GraphDeltaPage> {
    const messages: GraphMessage[] = [];
    let url =
      deltaToken !== undefined
        ? `${GRAPH_BASE}${this.mailRoot}/mailFolders/inbox/messages/delta?$deltatoken=${encodeURIComponent(deltaToken)}`
        : `${GRAPH_BASE}${this.mailRoot}/mailFolders/inbox/messages/delta?$select=id,from,subject,body,receivedDateTime`;

    try {
      while (url) {
        const page = await this.graphGet(url);
        const items = (page.value ?? []) as GraphMessage[];
        messages.push(...items);

        if (page["@odata.nextLink"]) {
          url = page["@odata.nextLink"] as string;
        } else if (page["@odata.deltaLink"]) {
          const deltaLink = page["@odata.deltaLink"] as string;
          const token = new URL(deltaLink).searchParams.get("$deltatoken");
          if (!token) throw new Error("delta response missing $deltatoken");
          this.lastReachable = true;
          return { messages, nextDeltaToken: token };
        } else {
          throw new Error("delta page missing nextLink and deltaLink");
        }
      }
      throw new Error("delta pagination ended without deltaLink");
    } catch (err) {
      this.lastReachable = false;
      throw err;
    }
  }

  async forwardMessage(
    messageId: string,
    toRecipients: string[],
    ccRecipients: string[] = [],
  ): Promise<void> {
    const body = {
      comment: "",
      toRecipients: toRecipients.map((address) => ({
        emailAddress: { address },
      })),
      ...(ccRecipients.length > 0
        ? {
            ccRecipients: ccRecipients.map((address) => ({
              emailAddress: { address },
            })),
          }
        : {}),
    };
    await this.graphPost(`${GRAPH_BASE}${this.mailRoot}/messages/${messageId}/forward`, body);
  }

  private async graphGet(url: string): Promise<Record<string, unknown>> {
    const token = await this.auth.getAccessToken();
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph GET ${res.status}: ${text}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  private async graphPost(url: string, body: unknown): Promise<void> {
    const token = await this.auth.getAccessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph POST ${res.status}: ${text}`);
    }
  }
}
