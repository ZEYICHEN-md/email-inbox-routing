import { describe, it, expect } from "vitest";
import { extractFormMessageContent } from "../../src/submitterExtractor/index.js";

describe("extractFormMessageContent", () => {
  it("strips a Message section header", () => {
    expect(extractFormMessageContent("\nMessage\nHello world", "full")).toBe("Hello world");
  });

  it("falls back to full body when trailing is empty", () => {
    expect(extractFormMessageContent("", "full body")).toBe("full body");
  });
});
