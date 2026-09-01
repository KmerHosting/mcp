#!/usr/bin/env node

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  KmerHostingClient,
  KmerHostingError,
  type ApiEnvelope,
  type KvmAction,
  type MutationOptions,
} from "@kmerhosting/sdk";
import * as z from "zod/v4";

export const MCP_TOOL_NAMES = [
  "kmerhosting_account_get",
  "kmerhosting_account_api_usage",
  "kmerhosting_services_list",
  "kmerhosting_service_get",
  "kmerhosting_domains_list",
  "kmerhosting_domain_get",
  "kmerhosting_domain_dns_list",
  "kmerhosting_domain_dns_create",
  "kmerhosting_domain_dns_update",
  "kmerhosting_domain_dns_delete",
  "kmerhosting_domain_auto_renew",
  "kmerhosting_domain_nameservers",
  "kmerhosting_email_services_list",
  "kmerhosting_email_provision",
  "kmerhosting_email_dns_sync",
  "kmerhosting_hosting_services_list",
  "kmerhosting_hosting_stats",
  "kmerhosting_hosting_panel_access",
  "kmerhosting_lxc_list", "kmerhosting_lxc_get", "kmerhosting_lxc_metrics", "kmerhosting_lxc_action", "kmerhosting_lxc_snapshots",
  "kmerhosting_kvm_list", "kmerhosting_kvm_get", "kmerhosting_kvm_action", "kmerhosting_kvm_auto_renew",
  "kmerhosting_kvm_snapshots_list", "kmerhosting_kvm_snapshot_create", "kmerhosting_kvm_snapshot_update", "kmerhosting_kvm_snapshot_delete",
] as const;

// Keep OAuth discovery aligned with the operations exposed by this server.
// LXC currently has read-only list/get tools; mutating LXC scopes must not be
// advertised until those operations are implemented and permission-checked.
export const MCP_SUPPORTED_SCOPES = [
  "account:read",
  "account:usage:read",
  "services:read",
  "domains:read",
  "domains:write",
  "domains:dns:write",
  "email:read",
  "email:write",
  "hosting:read",
  "hosting:panel:access",
  "lxc:read",
  "lxc:power:write",
  "lxc:snapshots:write",
  "kvm:read",
  "kvm:power:write",
  "kvm:snapshots:write",
  "kvm:subscription:write",
  "offline_access",
] as const;

const mutationFields = {
  idempotencyKey: z.string().min(8).max(128).optional().describe("Stable key to safely retry the same mutation"),
};

const idInput = (label: string) => z.object({
  id: z.string().min(1).describe(label),
});

function clientFromEnvironment(accessToken?: string): KmerHostingClient {
  const apiKey = accessToken || process.env.KMERHOSTING_API_KEY;
  if (!apiKey) throw new Error("KMERHOSTING_API_KEY is required.");
  const client = new KmerHostingClient({
    apiKey,
    baseUrl: process.env.KMERHOSTING_API_URL,
  });
  // Keep the MCP binary compatible with SDK 0.2.x installations while the
  // coordinated SDK release containing account.apiUsage is rolled out.
  const account = client.account as { apiUsage?: () => Promise<ApiEnvelope> };
  if (!account.apiUsage) {
    const baseUrl = (process.env.KMERHOSTING_API_URL || "https://api.kmerhosting.com").replace(/\/+$/, "");
    account.apiUsage = async () => {
      const response = await fetch(`${baseUrl}/v1/account/api-usage`, { headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || "Unable to load API activity.");
      return payload as ApiEnvelope;
    };
  }
  const lxc = client.lxc as typeof client.lxc & {
    metrics?: (id: string) => Promise<ApiEnvelope>;
    action?: (id: string, action: string, options?: MutationOptions) => Promise<ApiEnvelope>;
    snapshots?: { list: (id: string) => Promise<ApiEnvelope>; mutate: (id: string, action: string, name: string, options?: MutationOptions) => Promise<ApiEnvelope> };
  };
  const legacyRequest = async (path: string, method = "GET", body?: unknown): Promise<ApiEnvelope> => {
    const baseUrl = (process.env.KMERHOSTING_API_URL || "https://api.kmerhosting.com").replace(/\/+$/, "");
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${apiKey}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || "Unable to complete the LXC request.");
    return payload as ApiEnvelope;
  };
  if (!lxc.metrics) lxc.metrics = (id) => legacyRequest(`/v1/lxc/instances/${encodeURIComponent(id)}/metrics`);
  if (!lxc.action) lxc.action = (id, action, options) => legacyRequest(`/v1/lxc/instances/${encodeURIComponent(id)}/actions`, "POST", { action, ...(options?.idempotencyKey ? {} : {}) });
  if (!lxc.snapshots) lxc.snapshots = { list: (id) => legacyRequest(`/v1/lxc/instances/${encodeURIComponent(id)}/snapshots`), mutate: (id, action, name) => legacyRequest(`/v1/lxc/instances/${encodeURIComponent(id)}/snapshots`, "POST", { action, name }) };
  return client;
}

function resultText(result: ApiEnvelope): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

function errorText(error: unknown): { isError: true; content: [{ type: "text"; text: string }] } {
  if (error instanceof KmerHostingError) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          error: {
            code: error.code,
            status: error.status,
            message: error.message,
            ...(error.requestId ? { request_id: error.requestId } : {}),
          },
        }, null, 2),
      }],
    };
  }
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code: "mcp_error", message: error instanceof Error ? error.message : String(error) } }, null, 2) }],
  };
}

async function execute(work: () => Promise<ApiEnvelope>) {
  try {
    return resultText(await work());
  } catch (error) {
    return errorText(error);
  }
}

export function createServer(api = clientFromEnvironment()): McpServer {
  const server = new McpServer({ name: "kmerhosting", version: "0.2.0" });

  server.registerTool("kmerhosting_account_get", {
    description: "Get the authenticated KmerHosting account.",
    inputSchema: z.object({}),
  }, () => execute(() => api.account.get()));

  server.registerTool("kmerhosting_account_api_usage", {
    description: "List API request activity, including non-product operations and client IPv4 addresses.",
    inputSchema: z.object({}),
  }, () => execute(() => {
    const apiUsage = (api.account as { apiUsage?: () => Promise<ApiEnvelope> }).apiUsage;
    if (!apiUsage) throw new Error("Install the latest KmerHosting SDK before using API activity.");
    return apiUsage();
  }));

  server.registerTool("kmerhosting_services_list", {
    description: "List all KmerHosting services owned by the authenticated account.",
    inputSchema: z.object({}),
  }, () => execute(() => api.services.list()));

  server.registerTool("kmerhosting_service_get", {
    description: "Get details for one KmerHosting service.",
    inputSchema: idInput("Service UUID"),
  }, ({ id }) => execute(() => api.services.get(id)));

  server.registerTool("kmerhosting_domains_list", {
    description: "List domains owned by the authenticated KmerHosting account.",
    inputSchema: z.object({}),
  }, () => execute(() => api.domains.list()));

  server.registerTool("kmerhosting_domain_get", {
    description: "Get details for one owned domain.",
    inputSchema: idInput("Domain UUID"),
  }, ({ id }) => execute(() => api.domains.get(id)));

  server.registerTool("kmerhosting_domain_dns_list", {
    description: "List DNS records for an owned domain.",
    inputSchema: z.object({ domainId: z.string().min(1).describe("Domain UUID") }),
  }, ({ domainId }) => execute(() => api.domains.dns.list(domainId)));

  server.registerTool("kmerhosting_domain_dns_create", {
    description: "Create a DNS record on an owned domain. The API validates the record.",
    inputSchema: z.object({
      domainId: z.string().min(1).describe("Domain UUID"),
      record: z.record(z.string(), z.unknown()).describe("DNS record object"),
      ...mutationFields,
    }),
  }, ({ domainId, record, idempotencyKey }) => execute(() => api.domains.dns.create(domainId, record, { idempotencyKey })));

  server.registerTool("kmerhosting_domain_dns_update", {
    description: "Update a DNS record on an owned domain. The API validates the record.",
    inputSchema: z.object({
      domainId: z.string().min(1).describe("Domain UUID"),
      recordId: z.string().min(1).describe("DNS record UUID"),
      record: z.record(z.string(), z.unknown()).describe("DNS record object"),
      ...mutationFields,
    }),
  }, ({ domainId, recordId, record, idempotencyKey }) => execute(() => api.domains.dns.update(domainId, recordId, record, { idempotencyKey })));

  server.registerTool("kmerhosting_domain_dns_delete", {
    description: "Delete a DNS record. Requires confirm=true because this is destructive.",
    inputSchema: z.object({
      domainId: z.string().min(1).describe("Domain UUID"),
      recordId: z.string().min(1).describe("DNS record UUID"),
      confirm: z.literal(true).describe("Explicit confirmation of DNS record deletion"),
      ...mutationFields,
    }),
  }, ({ domainId, recordId, idempotencyKey }) => execute(() => api.domains.dns.delete(domainId, recordId, { idempotencyKey })));

  server.registerTool("kmerhosting_domain_auto_renew", {
    description: "Enable or disable automatic renewal for an owned domain.",
    inputSchema: z.object({
      domainId: z.string().min(1).describe("Domain UUID"),
      enabled: z.boolean(),
      ...mutationFields,
    }),
  }, ({ domainId, enabled, idempotencyKey }) => execute(() => api.domains.setAutoRenew(domainId, enabled, { idempotencyKey })));

  server.registerTool("kmerhosting_domain_nameservers", {
    description: "Replace the nameservers for an owned domain.",
    inputSchema: z.object({
      domainId: z.string().min(1).describe("Domain UUID"),
      nameservers: z.array(z.string().min(1)).min(1).describe("Nameservers to apply"),
      ...mutationFields,
    }),
  }, ({ domainId, nameservers, idempotencyKey }) => execute(() => api.domains.setNameservers(domainId, nameservers, { idempotencyKey })));

  server.registerTool("kmerhosting_email_services_list", {
    description: "List owned KmerHosting email hosting services.",
    inputSchema: z.object({}),
  }, () => execute(() => api.email.listServices()));

  server.registerTool("kmerhosting_email_provision", {
    description: "Provision an owned email hosting service.",
    inputSchema: z.object({ serviceId: z.string().min(1).describe("Email service UUID"), ...mutationFields }),
  }, ({ serviceId, idempotencyKey }) => execute(() => api.email.provision(serviceId, { idempotencyKey })));

  server.registerTool("kmerhosting_email_dns_sync", {
    description: "Synchronize DNS for an owned email hosting service.",
    inputSchema: z.object({ serviceId: z.string().min(1).describe("Email service UUID"), ...mutationFields }),
  }, ({ serviceId, idempotencyKey }) => execute(() => api.email.syncDns(serviceId, { idempotencyKey })));

  server.registerTool("kmerhosting_hosting_services_list", {
    description: "List owned KmerHosting shared-hosting services.",
    inputSchema: z.object({}),
  }, () => execute(() => api.hosting.listServices()));

  server.registerTool("kmerhosting_hosting_stats", {
    description: "Get statistics for an owned shared-hosting service.",
    inputSchema: z.object({ serviceId: z.string().min(1).describe("Hosting service UUID") }),
  }, ({ serviceId }) => execute(() => api.hosting.stats(serviceId)));

  server.registerTool("kmerhosting_hosting_panel_access", {
    description: "Create a short-lived access link for an owned hosting panel or file manager.",
    inputSchema: z.object({
      serviceId: z.string().min(1).describe("Hosting service UUID"),
      target: z.enum(["panel", "filemanager"]).default("panel"),
      ...mutationFields,
    }),
  }, ({ serviceId, target, idempotencyKey }) => execute(() => api.hosting.createPanelAccess(serviceId, target, { idempotencyKey })));

  server.registerTool("kmerhosting_lxc_list", {
    description: "List LXC instances owned by the authenticated KmerHosting account.",
    inputSchema: z.object({}),
  }, () => execute(() => api.lxc.list()));

  server.registerTool("kmerhosting_lxc_get", {
    description: "Get details for one owned LXC instance.",
    inputSchema: idInput("LXC instance UUID"),
  }, ({ id }) => execute(() => api.lxc.get(id)));

  server.registerTool("kmerhosting_lxc_metrics", {
    description: "Get metrics for an owned LXC instance for the last 24 hours.",
    inputSchema: idInput("LXC instance UUID"),
  }, ({ id }) => execute(() => {
    const method = (api.lxc as typeof api.lxc & { metrics?: (id: string) => Promise<ApiEnvelope> }).metrics;
    if (!method) throw new Error("Install the latest KmerHosting SDK before using LXC metrics.");
    return method(id);
  }));

  server.registerTool("kmerhosting_lxc_action", {
    description: "Control an owned LXC instance. This can interrupt services and requires explicit confirmation for stop.",
    inputSchema: z.object({ id: z.string().min(1), action: z.enum(["start", "restart", "freeze", "stop"]), confirm: z.literal(true).optional(), ...mutationFields }),
  }, ({ id, action, confirm, idempotencyKey }) => execute(() => {
    if (["stop", "freeze"].includes(action) && confirm !== true) throw new Error("Set confirm=true to run this disruptive LXC action.");
    const method = (api.lxc as typeof api.lxc & { action?: (id: string, action: "start" | "restart" | "freeze" | "stop", options?: MutationOptions) => Promise<ApiEnvelope> }).action;
    if (!method) throw new Error("Install the latest KmerHosting SDK before using LXC actions.");
    return method(id, action, { idempotencyKey });
  }));

  server.registerTool("kmerhosting_lxc_snapshots", {
    description: "List or mutate an owned LXC snapshot. Delete and restore require confirm=true.",
    inputSchema: z.object({ id: z.string().min(1), action: z.enum(["list", "create", "delete", "restore"]), name: z.string().min(1).max(48).optional(), confirm: z.literal(true).optional(), ...mutationFields }),
  }, ({ id, action, name, confirm, idempotencyKey }) => execute(() => {
    const snapshots = (api.lxc as typeof api.lxc & { snapshots?: { list: (id: string) => Promise<ApiEnvelope>; mutate: (id: string, action: "create" | "delete" | "restore", name: string, options?: MutationOptions) => Promise<ApiEnvelope> } }).snapshots;
    if (!snapshots) throw new Error("Install the latest KmerHosting SDK before using LXC snapshots.");
    if (action === "list") return snapshots.list(id);
    if (!name) throw new Error("A snapshot name is required.");
    if (["delete", "restore"].includes(action) && confirm !== true) throw new Error("Set confirm=true for snapshot deletion or restoration.");
    return snapshots.mutate(id, action, name, { idempotencyKey });
  }));

  server.registerTool("kmerhosting_kvm_list", {
    description: "List owned KmerHosting KVM instances.",
    inputSchema: z.object({}),
  }, () => execute(() => api.kvm.list()));

  server.registerTool("kmerhosting_kvm_get", {
    description: "Get details for one owned KVM instance.",
    inputSchema: idInput("KVM instance UUID"),
  }, ({ id }) => execute(() => api.kvm.get(id)));

  server.registerTool("kmerhosting_kvm_action", {
    description: "Start, restart, stop, or shut down an owned KVM instance. stop and shutdown require confirm=true.",
    inputSchema: z.object({
      serviceId: z.string().min(1).describe("VPS instance UUID"),
      action: z.enum(["start", "stop", "shutdown", "restart"]),
      confirm: z.boolean().optional().describe("Required for stop or shutdown"),
      ...mutationFields,
    }),
  }, ({ serviceId, action, confirm, idempotencyKey }) => execute(() => {
    if ((action === "stop" || action === "shutdown") && confirm !== true) {
      throw new Error(`${action} requires confirm=true.`);
    }
    return api.kvm.action(serviceId, action as KvmAction, { idempotencyKey });
  }));

  server.registerTool("kmerhosting_kvm_auto_renew", {
    description: "Enable or disable automatic renewal for an owned KVM instance.",
    inputSchema: z.object({
      serviceId: z.string().min(1).describe("VPS instance UUID"),
      enabled: z.boolean(),
      ...mutationFields,
    }),
  }, ({ serviceId, enabled, idempotencyKey }) => execute(() => api.kvm.setAutoRenew(serviceId, enabled, { idempotencyKey })));

  server.registerTool("kmerhosting_kvm_snapshots_list", {
    description: "List snapshots for an owned KVM instance.",
    inputSchema: z.object({ serviceId: z.string().min(1).describe("VPS instance UUID") }),
  }, ({ serviceId }) => execute(() => api.kvm.snapshots.list(serviceId)));

  server.registerTool("kmerhosting_kvm_snapshot_create", {
    description: "Create a snapshot for an owned KVM instance.",
    inputSchema: z.object({
      serviceId: z.string().min(1).describe("VPS instance UUID"),
      name: z.string().min(1).max(160),
      description: z.string().max(1000).optional(),
      ...mutationFields,
    }),
  }, ({ serviceId, name, description, idempotencyKey }) => execute(() => api.kvm.snapshots.create(serviceId, { name, description }, { idempotencyKey })));

  server.registerTool("kmerhosting_kvm_snapshot_update", {
    description: "Update the name or description of an owned KVM snapshot.",
    inputSchema: z.object({
      serviceId: z.string().min(1).describe("VPS instance UUID"),
      snapshotId: z.string().min(1).describe("Snapshot ID"),
      name: z.string().min(1).max(160).optional(),
      description: z.string().max(1000).optional(),
      ...mutationFields,
    }),
  }, ({ serviceId, snapshotId, name, description, idempotencyKey }) => execute(() => api.kvm.snapshots.update(serviceId, snapshotId, { name, description }, { idempotencyKey })));

  server.registerTool("kmerhosting_kvm_snapshot_delete", {
    description: "Delete a KVM snapshot. Requires confirm=true because this is destructive.",
    inputSchema: z.object({
      serviceId: z.string().min(1).describe("VPS instance UUID"),
      snapshotId: z.string().min(1).describe("Snapshot ID"),
      confirm: z.literal(true).describe("Explicit confirmation of snapshot deletion"),
      ...mutationFields,
    }),
  }, ({ serviceId, snapshotId, idempotencyKey }) => execute(() => api.kvm.snapshots.delete(serviceId, snapshotId, { idempotencyKey })));

  return server;
}

export async function startServer(): Promise<void> {
  const port = Number(process.env.MCP_HTTP_PORT || 0);
  if (port > 0) {
    await startHttpServer(port);
    return;
  }
  serveStdio(() => createServer(), { onerror: (error) => console.error(`MCP transport error: ${error.message}`) });
  console.error("KmerHosting MCP server running on stdio");
}

const publicMcpUrl = () => (process.env.MCP_PUBLIC_URL || "https://mcp.kmerhosting.com").replace(/\/+$/, "");
const oauthBackendUrl = () => (process.env.KMERHOSTING_OAUTH_BACKEND_URL || "").replace(/\/+$/, "");

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(kh_(?:live|oauth)_[A-Za-z0-9_-]+)$/i)?.[1] || null;
}

function oauthChallenge() {
  return `Bearer resource_metadata="${publicMcpUrl()}/.well-known/oauth-protected-resource"`;
}

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

async function proxyOAuth(request: Request, path: string) {
  const backend = oauthBackendUrl();
  if (!backend) return jsonResponse({ error: "server_configuration_error", message: "OAuth backend is not configured." }, 503);
  const backendPath = path.replace(/^\/oauth(?=\/|$)/, "");
  const response = await fetch(`${oauthBackendUrl()}${backendPath}`, {
    method: request.method,
    headers: {
      "Content-Type": request.headers.get("content-type") || "application/json",
      Accept: "application/json",
    },
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
  });
  const headers = new Headers(response.headers);
  // Bun transparently decodes compressed upstream bodies; do not forward
  // encoding/length metadata that would describe the compressed payload.
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  headers.delete("Transfer-Encoding");
  headers.set("Cache-Control", "no-store");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "content-type");
  return new Response(response.body, { status: response.status, headers });
}

async function oauthTokenActive(token: string) {
  const backend = oauthBackendUrl();
  if (!backend) return false;
  try {
    const response = await fetch(`${backend}/introspect`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ token }).toString(),
    });
    if (!response.ok) return false;
    const payload = await response.json() as { active?: boolean };
    return payload.active === true;
  } catch {
    return false;
  }
}

export async function startHttpServer(port: number): Promise<void> {
  const fetchHandler = createHttpHandler();
  Bun.serve({
    hostname: process.env.MCP_HTTP_HOST || "127.0.0.1",
    port,
    fetch: fetchHandler,
  });
  console.error(`KmerHosting MCP server listening on http://${process.env.MCP_HTTP_HOST || "127.0.0.1"}:${port}/mcp`);
}

export function createHttpHandler(): (request: Request) => Promise<Response> {
  const mcpHandler = createMcpHandler((context) => {
    const token = context.requestInfo ? bearerToken(context.requestInfo) : null;
    if (!token) throw new Error("OAuth bearer token is required.");
    return createServer(clientFromEnvironment(token));
  }, { legacy: "stateless", onerror: (error) => console.error(`MCP HTTP error: ${error.message}`) });

  return async (request) => {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Expose-Headers": "MCP-Session-Id, WWW-Authenticate" } });
      }
      if (url.pathname === "/health") return jsonResponse({ status: "ok", service: "kmerhosting-mcp", transport: "streamable-http" });
      if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        return jsonResponse({ resource: `${publicMcpUrl()}/mcp`, authorization_servers: [publicMcpUrl()], scopes_supported: [...MCP_SUPPORTED_SCOPES] });
      }
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return jsonResponse({ issuer: publicMcpUrl(), authorization_endpoint: "https://dashboard.kmerhosting.com/oauth/authorize", token_endpoint: `${publicMcpUrl()}/oauth/token`, registration_endpoint: `${publicMcpUrl()}/oauth/register`, revocation_endpoint: `${publicMcpUrl()}/oauth/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], scopes_supported: [...MCP_SUPPORTED_SCOPES], token_endpoint_auth_methods_supported: ["none"] });
      }
      if (["/oauth/register", "/oauth/token", "/oauth/revoke"].includes(url.pathname)) return proxyOAuth(request, url.pathname);
      if (url.pathname !== "/mcp") return jsonResponse({ error: "not_found", message: "Not found." }, 404);
      const token = bearerToken(request);
      if (!token) return jsonResponse({ error: "invalid_token", message: "OAuth bearer token required." }, 401, { "WWW-Authenticate": oauthChallenge() });
      if (token.startsWith("kh_oauth_") && !(await oauthTokenActive(token))) return jsonResponse({ error: "invalid_token", message: "The OAuth access token is invalid, revoked, or expired." }, 401, { "WWW-Authenticate": oauthChallenge() });
      const response = await mcpHandler.fetch(request);
      response.headers.set("Access-Control-Expose-Headers", "MCP-Session-Id, WWW-Authenticate");
      return response;
    };
}

if (import.meta.main) {
  startServer().catch((error) => {
    console.error(`KmerHosting MCP server failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
