import { expect, test } from "bun:test";

const enabled = process.env.RUN_KMERHOSTING_INTEGRATION === "1";
const apiUrl = (process.env.KH_INTEGRATION_API_URL || "https://api.kmerhosting.com").replace(/\/+$/, "");
const mcpUrl = (process.env.KH_INTEGRATION_MCP_URL || "https://mcp.kmerhosting.com/mcp").replace(/\/+$/, "");

type Envelope = { data: any; request_id: string };

async function apiRequest(path: string, token: string): Promise<{ response: Response; payload: any }> {
  const response = await fetch(`${apiUrl}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  return { response, payload: await response.json() };
}

async function mcpRequest(token: string, body: unknown): Promise<{ response: Response; payload: any }> {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    return { response, payload: data ? JSON.parse(data) : null };
  }
  return { response, payload: text ? JSON.parse(text) : null };
}

test.skipIf(!enabled)("validates two tenants through API, SDK-backed MCP, and revocation boundaries", async () => {
  const tokenA = process.env.KH_TEST_TOKEN_A;
  const tokenB = process.env.KH_TEST_TOKEN_B;
  if (!tokenA || !tokenB) throw new Error("KH_TEST_TOKEN_A and KH_TEST_TOKEN_B are required for integration tests.");

  const accountA = await apiRequest("/v1/account", tokenA);
  const accountB = await apiRequest("/v1/account", tokenB);
  expect(accountA.response.status).toBe(200);
  expect(accountB.response.status).toBe(200);
  expect(accountA.payload.data.id).toBeString();
  expect(accountB.payload.data.id).toBeString();
  expect(accountA.payload.data.id).not.toBe(accountB.payload.data.id);

  const serviceA = process.env.KH_TEST_SERVICE_ID_A;
  const serviceB = process.env.KH_TEST_SERVICE_ID_B;
  if (serviceA && serviceB) {
    const crossA = await apiRequest(`/v1/services/${serviceA}`, tokenB);
    const crossB = await apiRequest(`/v1/services/${serviceB}`, tokenA);
    expect(crossA.response.status).toBe(404);
    expect(crossA.payload.error.code).toBe("service_not_found");
    expect(crossB.response.status).toBe(404);
    expect(crossB.payload.error.code).toBe("service_not_found");
  }

  for (const [index, token] of [tokenA, tokenB].entries()) {
    const initialize = await mcpRequest(token, {
      jsonrpc: "2.0",
      id: index + 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "kmerhosting-integration", version: "1.0.0" } },
    });
    expect(initialize.response.status).toBe(200);
    expect(initialize.payload.result.serverInfo.name).toBe("kmerhosting");

    const tools = await mcpRequest(token, { jsonrpc: "2.0", id: index + 10, method: "tools/list", params: {} });
    expect(tools.response.status).toBe(200);
    expect(tools.payload.result.tools).toHaveLength(36);

    const account = await mcpRequest(token, { jsonrpc: "2.0", id: index + 20, method: "tools/call", params: { name: "kmerhosting_account_get", arguments: {} } });
    expect(account.response.status).toBe(200);
    const accountEnvelope = JSON.parse(account.payload.result.content[0].text) as Envelope;
    expect(accountEnvelope.data.id).toBe(index === 0 ? accountA.payload.data.id : accountB.payload.data.id);
  }

  for (const variable of ["KH_TEST_REVOKED_TOKEN", "KH_TEST_EXPIRED_TOKEN"] as const) {
    const token = process.env[variable];
    if (!token) continue;
    const apiResult = await apiRequest("/v1/account", token);
    expect(apiResult.response.status, variable).toBe(401);
    const mcpResult = await mcpRequest(token, { jsonrpc: "2.0", id: 90, method: "tools/list", params: {} });
    expect(mcpResult.response.status, variable).toBe(401);
  }
});
