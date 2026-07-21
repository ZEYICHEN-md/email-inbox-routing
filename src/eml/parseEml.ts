/**
 * Minimal RFC 822 / .eml parser for semi-automatic inbox processing.
 * Handles folded headers, base64 and quoted-printable text bodies.
 */
import type { RawInboxEmail } from "../types/index.js";

export interface ParsedEml {
  from: string | null;
  subject: string | null;
  body: string;
}

function unfoldHeaders(raw: string): string {
  return raw.replace(/\r?\n[ \t]+/g, " ");
}

function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of unfoldHeaders(block).split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    const existing = headers.get(name);
    headers.set(name, existing ? `${existing}, ${value}` : value);
  }
  return headers;
}

function extractEmailAddress(fromHeader: string): string {
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle) return angle[1]!.trim();
  return fromHeader.trim();
}

function decodeQuotedPrintable(input: string, charset: string): string {
  const softBreaksRemoved = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  let i = 0;
  while (i < softBreaksRemoved.length) {
    if (softBreaksRemoved[i] === "=" && i + 2 < softBreaksRemoved.length) {
      bytes.push(parseInt(softBreaksRemoved.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      bytes.push(softBreaksRemoved.charCodeAt(i) & 0xff);
      i += 1;
    }
  }
  return Buffer.from(bytes).toString(normalizeCharset(charset));
}

function normalizeCharset(charset: string): BufferEncoding {
  const c = charset.toLowerCase().replace(/-/g, "");
  if (c === "utf8" || c === "usascii") return "utf8";
  if (c === "latin1" || c === "iso88591") return "latin1";
  return "utf8";
}

function decodeBody(content: string, encoding: string, charset: string): string {
  const enc = encoding.toLowerCase();
  const outCharset = normalizeCharset(charset);
  if (enc === "base64") {
    return Buffer.from(content.replace(/\s+/g, ""), "base64").toString(outCharset);
  }
  if (enc === "quoted-printable") {
    return decodeQuotedPrintable(content, charset);
  }
  return content;
}

interface MimePart {
  headers: Map<string, string>;
  body: string;
}

function splitMultipart(body: string, boundary: string): MimePart[] {
  const marker = `--${boundary}`;
  const endMarker = `--${boundary}--`;
  const segments = body.split(marker);
  const parts: MimePart[] = [];

  for (const segment of segments) {
    const trimmed = segment.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    if (trimmed.length === 0 || trimmed.startsWith("--") || trimmed === "--") continue;
    const splitAt = trimmed.search(/\r?\n\r?\n/);
    if (splitAt < 0) continue;
    const headerBlock = trimmed.slice(0, splitAt);
    const partBody = trimmed.slice(splitAt).replace(/^\r?\n\r?\n/, "");
    parts.push({ headers: parseHeaders(headerBlock), body: partBody });
  }

  if (parts.length === 0 && body.includes(endMarker)) {
    return parts;
  }
  return parts;
}

function pickTextBody(part: MimePart): string | null {
  const type = part.headers.get("content-type") ?? "text/plain";
  if (!type.toLowerCase().startsWith("text/plain")) return null;

  const encoding = part.headers.get("content-transfer-encoding") ?? "7bit";
  const charsetMatch = type.match(/charset="?([^";\s]+)"?/i);
  const charset = charsetMatch?.[1] ?? "utf-8";

  try {
    return decodeBody(part.body, encoding, charset);
  } catch {
    return part.body;
  }
}

function extractBody(headers: Map<string, string>, rawBody: string): string {
  const contentType = headers.get("content-type") ?? "text/plain";
  const encoding = headers.get("content-transfer-encoding") ?? "7bit";

  if (contentType.toLowerCase().includes("multipart/")) {
    const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/i);
    if (!boundaryMatch) return rawBody.trim();
    const parts = splitMultipart(rawBody, boundaryMatch[1]!);
    for (const part of parts) {
      const text = pickTextBody(part);
      if (text !== null) return text.trim();
    }
    return rawBody.trim();
  }

  const charsetMatch = contentType.match(/charset="?([^";\s]+)"?/i);
  const charset = charsetMatch?.[1] ?? "utf-8";

  try {
    return decodeBody(rawBody, encoding, charset).trim();
  } catch {
    return rawBody.trim();
  }
}

/** Parses a raw .eml file string into pipeline-ready fields. */
export function parseEml(raw: string): ParsedEml {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const splitAt = normalized.search(/\n\n/);
  if (splitAt < 0) {
    return { from: null, subject: null, body: normalized.trim() };
  }

  const headerBlock = normalized.slice(0, splitAt);
  const bodyBlock = normalized.slice(splitAt + 2);
  const headers = parseHeaders(headerBlock);

  const fromHeader = headers.get("from");
  const subject = headers.get("subject") ?? null;
  const body = extractBody(headers, bodyBlock);

  return {
    from: fromHeader ? extractEmailAddress(fromHeader) : null,
    subject,
    body,
  };
}

/** Converts a parsed .eml into a {@link RawInboxEmail} for optional filter admission. */
export function parsedEmlToRaw(
  parsed: ParsedEml,
  messageId: string,
  receivedAt = Date.now(),
): RawInboxEmail {
  return {
    messageId,
    from: parsed.from,
    subject: parsed.subject,
    body: parsed.body,
    attachments: [],
    receivedAt,
  };
}
