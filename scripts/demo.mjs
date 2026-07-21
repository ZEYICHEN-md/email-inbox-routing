#!/usr/bin/env node
/**
 * Offline showcase: print a sample classify → route result (no API key required).
 * For a live run against your LLM: npm run classify -- --body-file fixtures/atra-media-inquiry.txt
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "fixtures", "atra-media-inquiry.txt");
const sample = join(root, "docs", "examples", "classify-media-inquiry.json");

const bodyPreview = readFileSync(fixture, "utf8").trim().split(/\r?\n/).slice(0, 6).join("\n");
const result = readFileSync(sample, "utf8");

console.log("=== Email Inbox Routing - offline demo ===\n");
console.log("Input fixture: fixtures/atra-media-inquiry.txt");
console.log("-----");
console.log(bodyPreview);
console.log("...\n");
console.log("Sample classify:json output (illustrative):");
console.log("-----");
console.log(result);
console.log("-----");
console.log("\nLive classify (needs LLM_API_KEY in .env):");
console.log("  npm run classify -- --body-file fixtures/atra-media-inquiry.txt");
console.log("Outlook path: see outlook/README.md → ClassifyAndForwardSelected");
