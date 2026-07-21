/**
 * Production runner: polls the real mailbox via Microsoft Graph and processes
 * Contact Us notifications end-to-end.
 *
 * Usage:
 *   npm run graph:login
 *   npm run run:pipeline -- --once --dry-run
 *   npm run run:pipeline
 */
import { resolve } from "node:path";
import { resolveGraphConfig } from "../src/graph/config.js";
import { GraphAuthProvider } from "../src/graph/auth.js";
import { TokenCache } from "../src/graph/tokenCache.js";
import { HttpGraphClient } from "../src/graph/httpGraphClient.js";
import { GraphForwardPort } from "../src/graph/graphForwardPort.js";
import { PipelineStateStore } from "../src/graph/pipelineState.js";
import { mapGraphMessage } from "../src/inboundEmailSource/index.js";
import { NotificationFilter } from "../src/notificationFilter/index.js";
import { IngestionTracker } from "../src/ingestion/index.js";
import { SubmitterExtractor } from "../src/submitterExtractor/index.js";
import { LlmClient } from "../src/classifier/llmClient.js";
import { LlmEmailClassifier } from "../src/classifier/llmEmailClassifier.js";
import { EmailRouter } from "../src/router/index.js";
import { AuditLog } from "../src/auditLog/index.js";
import { FileAuditLogStore, FileErrorChannel } from "../src/auditLog/fileStores.js";
import { ReviewQueue } from "../src/reviewQueue/index.js";
import { RuleManager } from "../src/ruleSet/index.js";
import { RoutingPipeline, type ProcessedResult } from "../src/pipeline/index.js";
import { resolveLlmConfig } from "../src/config/env.js";
import type { InboundEmailSource } from "../src/inboundEmailSource/index.js";

const STUB_SOURCE: InboundEmailSource = {
  fetchNewMessages: () => [],
  acknowledge: () => {},
  healthCheck: () => "connected",
};

function parseArgs(argv: string[]) {
  let once = false;
  let dryRun = false;
  let intervalSec = 60;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--once") once = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--interval") intervalSec = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run run:pipeline -- [options]

Options:
  --once           Poll once and exit
  --dry-run        Classify/route but do not send Graph forwards
  --interval <sec> Poll interval (default 60)
`);
      process.exit(0);
    }
  }
  return { once, dryRun, intervalSec };
}

function logResult(result: ProcessedResult): void {
  console.log(`${result.disposition.padEnd(18)} ${result.messageId}`);
  if (!result.auditEntry) return;
  const e = result.auditEntry;
  console.log(`  submitter:  ${e.submitterEmail}`);
  if (e.finalCategory) console.log(`  category:   ${e.finalCategory}`);
  if (e.recipients?.length) console.log(`  recipients: ${e.recipients.join(", ")}`);
}

function createPipeline(dryRun: boolean): RoutingPipeline {
  const llmConfig = resolveLlmConfig();
  const graphConfig = resolveGraphConfig();
  const auth = new GraphAuthProvider({
    clientId: graphConfig.clientId,
    tenantId: graphConfig.tenantId,
    scopes: graphConfig.scopes,
    tokenCache: new TokenCache(graphConfig.tokenCachePath),
  });
  const graph = new HttpGraphClient({ auth });
  const forwardPort = new GraphForwardPort(graph, dryRun);

  const dataDir = resolve(process.cwd(), "data");
  const auditLog = new AuditLog(
    new FileAuditLogStore(resolve(dataDir, "audit-log.jsonl")),
    new FileErrorChannel(resolve(dataDir, "audit-errors.jsonl")),
  );

  return new RoutingPipeline(
    {
      source: STUB_SOURCE,
      filter: new NotificationFilter(),
      ingestion: new IngestionTracker(STUB_SOURCE),
      extractor: new SubmitterExtractor(),
      classifier: new LlmEmailClassifier({
        client: new LlmClient({ ...llmConfig, apiStyle: llmConfig.apiStyle }),
      }),
      router: new EmailRouter(forwardPort),
      ruleManager: new RuleManager(),
      auditLog,
      reviewQueue: new ReviewQueue(),
    },
    { threshold: 0.5 },
  );
}

async function pollOnce(
  pipeline: RoutingPipeline,
  graph: HttpGraphClient,
  stateStore: PipelineStateStore,
): Promise<number> {
  const state = stateStore.load();
  const page = await graph.fetchInboxDeltaAsync(state.deltaToken);
  let processed = 0;

  for (const msg of page.messages) {
    const raw = mapGraphMessage(msg);
    if (state.processedIds.includes(raw.messageId)) continue;

    const result = await pipeline.processRawAsync(raw);
    state.processedIds.push(raw.messageId);

    if (result.disposition !== "IGNORED" && result.disposition !== "SKIPPED_UNREADABLE") {
      processed++;
      logResult(result);
    }
  }

  state.deltaToken = page.nextDeltaToken;
  stateStore.save(state);
  return processed;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const graphConfig = resolveGraphConfig();
  const auth = new GraphAuthProvider({
    clientId: graphConfig.clientId,
    tenantId: graphConfig.tenantId,
    scopes: graphConfig.scopes,
    tokenCache: new TokenCache(graphConfig.tokenCachePath),
  });
  const graph = new HttpGraphClient({ auth });
  const stateStore = new PipelineStateStore(graphConfig.statePath);
  const pipeline = createPipeline(opts.dryRun);

  console.log(`Pipeline starting (dry-run=${opts.dryRun}, mailbox=delegated /me)`);

  if (opts.once) {
    const n = await pollOnce(pipeline, graph, stateStore);
    console.log(`Done. ${n} notification(s) processed.`);
    return;
  }

  for (;;) {
    try {
      const n = await pollOnce(pipeline, graph, stateStore);
      console.log(`[${new Date().toISOString()}] ${n} notification(s) processed`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] poll error:`, err);
    }
    await new Promise((r) => setTimeout(r, opts.intervalSec * 1000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
