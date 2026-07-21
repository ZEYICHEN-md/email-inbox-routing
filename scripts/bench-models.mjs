import { spawnSync } from "node:child_process";

const models = [
  "claude-DeepSeek-V4-Flash[1M]",
  "kimi-k2.7-code-highspeed",
  "claude-haiku-4-5",
  "DeepSeek-V4-Flash-yun",
  "DeepSeek-V4-Flash",
];

for (const model of models) {
  const t0 = Date.now();
  const r = spawnSync(
    "npx",
    ["tsx", "scripts/classify-json.ts", "--body-file", "fixtures/atra-media-inquiry.txt"],
    {
      env: { ...process.env, LLM_MODEL: model },
      encoding: "utf8",
      shell: true,
      timeout: 120_000,
    },
  );
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = r.stdout?.includes('"ok": true') ?? false;
  const catMatch = r.stdout?.match(/"category": "([^"]+)"/);
  const cat = catMatch?.[1] ?? "n/a";
  const err = r.status !== 0 ? (r.stderr ?? "").trim().slice(0, 100) : "";
  console.log(`${model.padEnd(32)} ${sec}s  ${ok ? "OK" : "FAIL"}  ${cat}  ${err}`);
}
