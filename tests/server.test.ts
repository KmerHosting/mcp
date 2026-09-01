import { expect, test } from "bun:test";
import { createHttpHandler, MCP_SUPPORTED_SCOPES, MCP_TOOL_NAMES } from "../src/index";

const apiUrl = "https://api.example.test";

async function readMcpResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    if (!data) throw new Error(`MCP response did not contain an SSE data event: ${text}`);
    return JSON.parse(data);
  }
  return JSON.parse(text);
}

async function mcpRequest(handler: (request: Request) => Promise<Response>, body: unknown, token = "kh_oauth_test") {
  return handler(new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }));
}

test("serves OAuth discovery, validates users, exposes all tools, and preserves API errors", async () => {
  const previousApiUrl = process.env.KMERHOSTING_API_URL;
  const previousOAuthUrl = process.env.KMERHOSTING_OAUTH_BACKEND_URL;
  const previousPublicUrl = process.env.MCP_PUBLIC_URL;
  const originalFetch = globalThis.fetch;
  let apiErrorMode = false;
  const apiCalls: Array<{ url: string; init?: RequestInit }> = [];

  process.env.KMERHOSTING_API_URL = apiUrl;
  process.env.KMERHOSTING_OAUTH_BACKEND_URL = "https://oauth.example.test";
  process.env.MCP_PUBLIC_URL = "https://mcp.example.test";
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.startsWith(apiUrl)) {
      apiCalls.push({ url, init });
      if (apiErrorMode) {
        return Response.json({ error: { code: "insufficient_scope", message: "The services:read scope is missing.", request_id: "api-request-1" } }, { status: 403 });
      }
      return Response.json({ data: { email: "user@example.test", services: [] }, request_id: "api-request-1" });
    }
    if (url === "https://oauth.example.test/introspect") return Response.json({ active: true });
    throw new Error(`Unexpected network request in MCP test: ${url}`);
  }) as typeof fetch;

  try {
    const handler = createHttpHandler();

    const protectedResource = await handler(new Request("https://mcp.example.test/.well-known/oauth-protected-resource"));
    expect(protectedResource.status).toBe(200);
    const protectedResourceBody = await protectedResource.json() as { resource: string; scopes_supported: string[] };
    expect(protectedResourceBody).toMatchObject({ resource: "https://mcp.example.test/mcp" });

    const authorizationServer = await handler(new Request("https://mcp.example.test/.well-known/oauth-authorization-server"));
    expect(authorizationServer.status).toBe(200);
    expect(await authorizationServer.json()).toMatchObject({
      issuer: "https://mcp.example.test",
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      scopes_supported: [...MCP_SUPPORTED_SCOPES],
    });

    expect(protectedResourceBody.scopes_supported).toEqual([...MCP_SUPPORTED_SCOPES]);
    expect(protectedResourceBody.scopes_supported).not.toContain("lxc:reinstall");

    const unauthenticated = await handler(new Request("https://mcp.example.test/mcp", { method: "POST", body: "{}" }));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource");

    const initialize = await readMcpResponse(await mcpRequest(handler, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "contract-test", version: "1.0.0" } },
    }));
    expect(initialize.result.serverInfo).toMatchObject({ name: "kmerhosting", version: "0.2.0" });

    const listed = await readMcpResponse(await mcpRequest(handler, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    expect(listed.result.tools).toHaveLength(27);
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual([...MCP_TOOL_NAMES]);

    const toolResult = await readMcpResponse(await mcpRequest(handler, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "kmerhosting_account_get", arguments: {} } }));
    expect(toolResult.result.isError).not.toBe(true);
    expect(JSON.parse(toolResult.result.content[0].text)).toMatchObject({ data: { email: "user@example.test" } });
    expect(apiCalls.at(-1)?.init?.headers).toBeDefined();
    expect(new Headers(apiCalls.at(-1)?.init?.headers).get("Authorization")).toBe("Bearer kh_oauth_test");

    apiErrorMode = false;
    const toolArguments: Record<string, Record<string, unknown>> = {
      kmerhosting_account_get: {},
      kmerhosting_services_list: {},
      kmerhosting_service_get: { id: "service-1" },
      kmerhosting_domains_list: {},
      kmerhosting_domain_get: { id: "domain-1" },
      kmerhosting_domain_dns_list: { domainId: "domain-1" },
      kmerhosting_domain_dns_create: { domainId: "domain-1", record: { type: "A" } },
      kmerhosting_domain_dns_update: { domainId: "domain-1", recordId: "record-1", record: { content: "192.0.2.1" } },
      kmerhosting_domain_dns_delete: { domainId: "domain-1", recordId: "record-1", confirm: true },
      kmerhosting_domain_auto_renew: { domainId: "domain-1", enabled: true },
      kmerhosting_domain_nameservers: { domainId: "domain-1", nameservers: ["ns1.example.test"] },
      kmerhosting_email_services_list: {},
      kmerhosting_email_provision: { serviceId: "email-1" },
      kmerhosting_email_dns_sync: { serviceId: "email-1" },
      kmerhosting_hosting_services_list: {},
      kmerhosting_hosting_stats: { serviceId: "hosting-1" },
      kmerhosting_hosting_panel_access: { serviceId: "hosting-1", target: "panel" },
      kmerhosting_lxc_list: {},
      kmerhosting_lxc_get: { id: "lxc-1" },
      kmerhosting_kvm_list: {},
      kmerhosting_kvm_get: { id: "vps-1" },
      kmerhosting_kvm_action: { serviceId: "vps-1", action: "restart" },
      kmerhosting_kvm_auto_renew: { serviceId: "vps-1", enabled: true },
      kmerhosting_kvm_snapshots_list: { serviceId: "vps-1" },
      kmerhosting_kvm_snapshot_create: { serviceId: "vps-1", name: "test" },
      kmerhosting_kvm_snapshot_update: { serviceId: "vps-1", snapshotId: "snapshot-1", name: "renamed" },
      kmerhosting_kvm_snapshot_delete: { serviceId: "vps-1", snapshotId: "snapshot-1", confirm: true },
    };
    for (const [index, name] of MCP_TOOL_NAMES.entries()) {
      const result = await readMcpResponse(await mcpRequest(handler, { jsonrpc: "2.0", id: 10 + index, method: "tools/call", params: { name, arguments: toolArguments[name] } }));
      expect(result.result.isError, name).not.toBe(true);
    }

    apiErrorMode = true;
    const failedTool = await readMcpResponse(await mcpRequest(handler, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "kmerhosting_account_get", arguments: {} } }));
    expect(failedTool.result.isError).toBe(true);
    expect(JSON.parse(failedTool.result.content[0].text)).toMatchObject({ error: { code: "insufficient_scope", status: 403, request_id: "api-request-1" } });

    apiErrorMode = false;
    const apiCallsBeforeDestructive = apiCalls.length;
    const destructive = await readMcpResponse(await mcpRequest(handler, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "kmerhosting_kvm_action", arguments: { serviceId: "instance-1", action: "stop" } } }));
    expect(destructive.result.isError ?? destructive.error).toBeTruthy();
    expect(apiCalls).toHaveLength(apiCallsBeforeDestructive);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousApiUrl === undefined) delete process.env.KMERHOSTING_API_URL;
    else process.env.KMERHOSTING_API_URL = previousApiUrl;
    if (previousOAuthUrl === undefined) delete process.env.KMERHOSTING_OAUTH_BACKEND_URL;
    else process.env.KMERHOSTING_OAUTH_BACKEND_URL = previousOAuthUrl;
    if (previousPublicUrl === undefined) delete process.env.MCP_PUBLIC_URL;
    else process.env.MCP_PUBLIC_URL = previousPublicUrl;
  }
});

test("rejects inactive OAuth tokens before constructing an API client", async () => {
  const previousOAuthUrl = process.env.KMERHOSTING_OAUTH_BACKEND_URL;
  const originalFetch = globalThis.fetch;
  process.env.KMERHOSTING_OAUTH_BACKEND_URL = "https://oauth.example.test";
  globalThis.fetch = (async () => Response.json({ active: false })) as typeof fetch;
  try {
    const handler = createHttpHandler();
    const response = await mcpRequest(handler, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOAuthUrl === undefined) delete process.env.KMERHOSTING_OAUTH_BACKEND_URL;
    else process.env.KMERHOSTING_OAUTH_BACKEND_URL = previousOAuthUrl;
  }
});
