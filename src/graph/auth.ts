/**
 * Microsoft identity platform — device code flow (delegated, no IT admin needed
 * if user consent is allowed for Mail.Read / Mail.ReadWrite).
 */
import { TokenCache, type CachedTokens } from "./tokenCache.js";

export interface GraphAuthConfig {
  clientId: string;
  tenantId: string;
  scopes: string[];
  tokenCache: TokenCache;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function tokenEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

function deviceCodeEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`;
}

export class GraphAuthProvider {
  private readonly config: GraphAuthConfig;

  constructor(config: GraphAuthConfig) {
    this.config = config;
  }

  /** Returns a valid access token, refreshing or prompting via device code as needed. */
  async getAccessToken(): Promise<string> {
    const cached = this.config.tokenCache.load();
    if (cached && cached.expires_at > Date.now() + 60_000) {
      return cached.access_token;
    }
    if (cached?.refresh_token) {
      try {
        return await this.refresh(cached.refresh_token);
      } catch {
        // fall through to device code
      }
    }
    return this.deviceCodeLogin();
  }

  private async refresh(refreshToken: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: this.config.scopes.join(" "),
    });
    const res = await fetch(tokenEndpoint(this.config.tenantId), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json()) as TokenResponse;
    if (!res.ok || json.error) {
      throw new Error(json.error_description ?? json.error ?? `refresh failed HTTP ${res.status}`);
    }
    return this.persist(json);
  }

  private async deviceCodeLogin(): Promise<string> {
    const scope = this.config.scopes.join(" ");
    const startBody = new URLSearchParams({
      client_id: this.config.clientId,
      scope,
    });
    const startRes = await fetch(deviceCodeEndpoint(this.config.tenantId), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: startBody,
    });
    const device = (await startRes.json()) as DeviceCodeResponse;
    if (!startRes.ok) {
      throw new Error(`device code start failed HTTP ${startRes.status}: ${JSON.stringify(device)}`);
    }

    console.log("\n=== Microsoft Graph sign-in ===");
    console.log(device.message);
    console.log(`Or open: ${device.verification_uri}`);
    console.log(`Code:     ${device.user_code}\n`);

    const deadline = Date.now() + device.expires_in * 1000;
    let intervalMs = (device.interval ?? 5) * 1000;

    while (Date.now() < deadline) {
      await sleep(intervalMs);
      const pollBody = new URLSearchParams({
        client_id: this.config.clientId,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: device.device_code,
      });
      const pollRes = await fetch(tokenEndpoint(this.config.tenantId), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: pollBody,
      });
      const json = (await pollRes.json()) as TokenResponse;

      if (pollRes.ok && json.access_token) {
        console.log("Signed in successfully.\n");
        return this.persist(json);
      }
      if (json.error === "authorization_pending") continue;
      if (json.error === "slow_down") {
        intervalMs += 5000;
        continue;
      }
      throw new Error(json.error_description ?? json.error ?? "device code poll failed");
    }
    throw new Error("device code login timed out");
  }

  private persist(json: TokenResponse): string {
    const cached: CachedTokens = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + json.expires_in * 1000,
      scope: json.scope,
    };
    this.config.tokenCache.save(cached);
    return json.access_token;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
