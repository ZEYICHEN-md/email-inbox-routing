import { describe, it, expect } from "vitest";
import { LlmClient } from "../../src/classifier/llmClient.js";

describe("LlmClient.extractText", () => {
  it("extracts text from Anthropic messages response", () => {
    const text = LlmClient.extractText({
      type: "message",
      content: [{ type: "text", text: '{"scores":[]}' }],
    });
    expect(text).toBe('{"scores":[]}');
  });

  it("extracts text from OpenAI chat completion response", () => {
    const text = LlmClient.extractText({
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" } }],
    });
    expect(text).toBe("hello");
  });
});

describe("LlmClient apiStyle", () => {
  it("detects chat style from apiPath", () => {
    const client = new LlmClient({
      baseUrl: "http://example.com",
      apiPath: "/v1/chat/completions",
      apiKey: "k",
      model: "m",
    });
    expect(client.apiStyle()).toBe("chat");
  });

  it("detects messages style from apiPath", () => {
    const client = new LlmClient({
      baseUrl: "http://example.com",
      apiPath: "/OpenAI-compatible/v1/messages",
      apiKey: "k",
      model: "m",
    });
    expect(client.apiStyle()).toBe("messages");
  });
});
