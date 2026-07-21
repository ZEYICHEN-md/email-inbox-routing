/**
 * One-time Microsoft Graph sign-in via device code flow.
 * Usage: npm run graph:login
 */
import { resolveGraphConfig } from "../src/graph/config.js";
import { GraphAuthProvider } from "../src/graph/auth.js";
import { TokenCache } from "../src/graph/tokenCache.js";
import { HttpGraphClient } from "../src/graph/httpGraphClient.js";

const graphConfig = resolveGraphConfig();
const tokenCache = new TokenCache(graphConfig.tokenCachePath);
const auth = new GraphAuthProvider({
  clientId: graphConfig.clientId,
  tenantId: graphConfig.tenantId,
  scopes: graphConfig.scopes,
  tokenCache,
});

const client = new HttpGraphClient({ auth });
await auth.getAccessToken();

try {
  await client.fetchInboxDeltaAsync(undefined);
  console.log("Graph mail access OK. Token saved to", graphConfig.tokenCachePath);
} catch (err) {
  console.error("Signed in but inbox check failed:", err);
  console.error("(Token was saved; check Mail.Read scope / consent.)");
  process.exit(1);
}
