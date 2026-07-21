import type { ForwardPort, ForwardResult } from "../router/index.js";
import type { HttpGraphClient } from "./httpGraphClient.js";

/** Native-forward port backed by Microsoft Graph (async). */
export class GraphForwardPort implements ForwardPort {
  constructor(
    private readonly client: HttpGraphClient,
    private readonly dryRun = false,
  ) {}

  async forward(
    messageId: string,
    recipients: string[],
    cc: string[] = [],
  ): Promise<ForwardResult> {
    if (this.dryRun) {
      console.log(
        `[dry-run] forward ${messageId}\n  To: ${recipients.join(", ")}\n  CC: ${cc.join(", ")}`,
      );
      return { ok: true };
    }
    try {
      await this.client.forwardMessage(messageId, recipients, cc);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
}
