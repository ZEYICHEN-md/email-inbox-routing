import { describe, expect, it } from "vitest";
import { parseEml } from "../../src/eml/parseEml.js";

describe("parseEml", () => {
  it("parses simple plain-text eml", () => {
    const eml = [
      "From: noreply@forms.example.com",
      "Subject: [External] New Contact Us submission for DemoCo Inc.",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hello from contact form",
      "The sender's email",
      "test@example.com",
    ].join("\r\n");

    const parsed = parseEml(eml);
    expect(parsed.from).toBe("noreply@forms.example.com");
    expect(parsed.subject).toBe(
      "[External] New Contact Us submission for DemoCo Inc.",
    );
    expect(parsed.body).toContain("Hello from contact form");
    expect(parsed.body).toContain("test@example.com");
  });

  it("parses folded subject header", () => {
    const eml = [
      "From: Sender <sender@example.com>",
      "Subject: [External] New Contact Us submission",
      " for DemoCo Inc.",
      "",
      "Body text",
    ].join("\r\n");

    const parsed = parseEml(eml);
    expect(parsed.subject).toContain("DemoCo Inc.");
  });

  it("decodes quoted-printable body", () => {
    const eml = [
      "From: a@b.com",
      "Subject: Test",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "caf=C3=A9",
    ].join("\r\n");

    const parsed = parseEml(eml);
    expect(parsed.body).toBe("café");
  });
});
