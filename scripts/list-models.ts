import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveLlmConfig } from "../src/config/env.js";

const cfg = resolveLlmConfig();
const base = cfg.baseUrl.replace(/\/$/, "");
const url = `${base}/v1/models`;

const res = await fetch(url, { headers: { "x-api-key": cfg.apiKey } });
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const body = (await res.json()) as { data?: { id: string }[] };
const ids = (body.data ?? []).map((m) => m.id).sort();
console.log(`Models (${ids.length}):\n`);
for (const id of ids) {
  const rec = id === cfg.model ? "  <- current LLM_MODEL" : "";
  console.log(`  ${id}${rec}`);
}
