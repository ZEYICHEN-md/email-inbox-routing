/**
 * HTTP client for the internal OpenAI-compatible API.
 *
 * Supports two Anthropic/OpenAI-compatible endpoints:
 *  - POST /OpenAI-compatible/v1/messages       (Anthropic Messages format)
 *  - POST /v1/chat/completions (OpenAI Chat Completions format)
 *
 * The active format is inferred from `apiPath`, or set explicitly via `apiStyle`.
 */

export interface AdaMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AdaTextBlock {
  type: "text";
  text: string;
}

export interface AdaMessagesResponse {
  type: "message";
  content: AdaTextBlock[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AdaChatCompletionResponse {
  object: "chat.completion";
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export type AdaApiStyle = "messages" | "chat";

export interface LlmClientConfig {
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  /** Override auto-detection from apiPath. */
  apiStyle?: AdaApiStyle;
  fetchFn?: typeof fetch;
}

export class LlmClient {
  private readonly config: LlmClientConfig;
  private readonly fetchFn: typeof fetch;

  constructor(config: LlmClientConfig) {
    this.config = config;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  apiStyle(): AdaApiStyle {
    if (this.config.apiStyle) return this.config.apiStyle;
    return this.config.apiPath.includes("chat/completions") ? "chat" : "messages";
  }

  apiUrl(): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}${this.config.apiPath}`;
  }

  async createMessage(
    messages: AdaMessage[],
    options: { maxTokens?: number; system?: string } = {},
  ): Promise<string> {
    const style = this.apiStyle();
    const res = await this.fetchFn(this.apiUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
      },
      body: JSON.stringify(
        style === "chat"
          ? this.buildChatBody(messages, options)
          : this.buildMessagesBody(messages, options),
      ),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Ada API HTTP ${res.status}: ${text}`);
    }

    const json = JSON.parse(text) as AdaMessagesResponse | AdaChatCompletionResponse;
    return LlmClient.extractText(json);
  }

  private buildMessagesBody(
    messages: AdaMessage[],
    options: { maxTokens?: number; system?: string },
  ): Record<string, unknown> {
    const userMessages = messages.filter((m) => m.role !== "system");
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options.maxTokens ?? 4096,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (options.system) body.system = options.system;
    return body;
  }

  private buildChatBody(
    messages: AdaMessage[],
    options: { maxTokens?: number; system?: string },
  ): Record<string, unknown> {
    const chatMessages: AdaMessage[] = [];
    if (options.system) {
      chatMessages.push({ role: "system", content: options.system });
    }
    for (const m of messages) {
      if (m.role === "system") continue;
      chatMessages.push(m);
    }
    return {
      model: this.config.model,
      max_tokens: options.maxTokens ?? 4096,
      messages: chatMessages,
    };
  }

  /** Extracts assistant text from either API response shape. */
  static extractText(response: AdaMessagesResponse | AdaChatCompletionResponse | string): string {
    if (typeof response === "string") return response;
    if ("choices" in response && Array.isArray(response.choices)) {
      return response.choices[0]?.message?.content ?? "";
    }
    if ("content" in response && Array.isArray(response.content)) {
      const block = response.content.find((b) => b.type === "text");
      return block?.text ?? "";
    }
    return "";
  }
}
