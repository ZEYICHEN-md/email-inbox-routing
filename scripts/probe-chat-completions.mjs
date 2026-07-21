/**
 * Probe POST /v1/chat/completions (OpenAI-compatible).
 * Usage: node scripts/probe-chat-completions.mjs [model]
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");

function loadEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

const env = loadEnv(envPath);
const apiKey = env.LLM_API_KEY;
const baseUrl = env.LLM_BASE_URL ?? "https://api.openai.com";
const model = process.argv[2] ?? env.LLM_MODEL ?? "claude-glm-5.2[1M]";

const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
const body = {
  model,
  max_tokens: 50,
  messages: [{ role: "user", content: "Reply with exactly one word: OK" }],
};

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`POST ${url}`);
console.log(`model: ${model}`);
console.log(`HTTP ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
