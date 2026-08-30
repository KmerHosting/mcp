#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  KmerHostingClient,
  KmerHostingError,
  type ApiEnvelope,
  type MutationOptions,
  type VpsAction,
} from "@kmerhosting/sdk";
import * as z from "zod/v4";

export const MCP_TOOL_NAMES = [
  "kmerhosting_account_get",
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
  "kmerhosting_vps_list",
  "kmerhosting_vps_get",
  "kmerhosting_vps_action",
  "kmerhosting_vps_auto_renew",
  "kmerhosting_vps_snapshots_list",
  "kmerhosting_vps_snapshot_create",
  "kmerhosting_vps_snapshot_update",
  "kmerhosting_vps_snapshot_delete",
] as const;

const mutationFields = {
  idempotencyKey: z.string().min(8).max(128).optional().describe("Stable key to safely retry the same mutation"),
};

const idInput = (label: string) => z.object({
  id: z.string().min(1).describe(label),
});

function clientFromEnvironment(): KmerHostingClient {
  const apiKey = process.env.KMERHOSTING_API_KEY;
  if (!apiKey) throw new Error("KMERHOSTING_API_KEY is required.");
  return new KmerHostingClient({
    apiKey,
    baseUrl: process.env.KMERHOSTING_API_URL,
  });
}

function mutationOptions(input: { idempotencyKey?: string }): MutationOptions {
  return { idempotencyKey: input.idempotencyKey };
}

function resultText(result: ApiEnvelope): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

function errorText(error: unknown): { isError: true; content: [{ type: "text"; text: string }] } {
  if (error instanceof KmerHostingError) {
    const request = error.requestId ? ` Request ID: ${error.requestId}.` : "";
    return { isError: true, content: [{ type: "text", text: `KmerHosting API error (${error.code}, HTTP ${error.status}): ${error.message}.${request}` }] };
  }
  return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
}

async function execute(work: () => Promise<ApiEnvelope>) {
  try {
    return resultText(await work());
  } catch (error) {
    return errorText(error);
  }
}

function createServer(api = clientFromEnvironment()): McpServer {
  const server = new McpServer({ name: "kmerhosting", version: "0.1.0" });

  server.registerTool("kmerhosting_account_get", {
    description: "Get the authenticated KmerHosting account.",
    inputSchema: z.object({}),
  }, () => execute(() => api.account.get()));

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

  server.registerTool("kmerhosting_vps_list", {
    description: "List owned KmerHosting LXC VPS instances.",
    inputSchema: z.object({}),
  }, () => execute(() => api.vps.list()));

  server.registerTool("kmerhosting_vps_get", {
    description: "Get details for one owned LXC VPS instance.",
    inputSchema: idInput("VPS instance UUID"),
  }, ({ id }) => execute(() => api.vps.get(id)));

  server.registerTool("kmerhosting_vps_action", {
    description: "Start, restart, stop, or shut down an owned LXC VPS. stop and shutdown require confirm=true.",
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
    return api.vps.action(serviceId, action as VpsAction, { idempotencyKey });
  }));

  server.registerTool("kmerhosting_vps_auto_renew", {
    description: "Enable or disable automatic renewal for an owned LXC VPS.",
    inputSchema: z.object({
      serviceId: z.string().min(1).describe("VPS instance UUID"),
      enabled: z.boolean(),
      ...mutationFields,
    }),
  }, ({ serviceId, enabled, idempotencyKey }) => execute(() => api.vps.setAutoRenew(serviceId, enabled, { idempotencyKey })));

  server.registerTool("kmerhosting_vps_snapshots_list", {
    description: "List snapshots for an owned LXC VPS.",
    inputSchema: z.object({ serviceId: z.string().min(1).describe("VPS instance UUID") }),
  }, ({ serviceId }) => execute(() => api.vps.snapshots.list(serviceId)));

  server.registerTool("kmerhosting_vps_snapshot_create", {
    description: "Create a snapshot for an owned LXC VPS.",
    inputSchema: z.object({
      serviceId: z.string().min(1).describe("VPS instance UUID"),
      name: z.string().min(1).max(160),
      description: z.string().max(1000).optional(),
      ...mutationFields,
    }),
  }, ({ serviceId, name, description, idempotencyKey }) => execute(() => api.vps.snapshots.create(serviceId, { name, description }, { idempotencyKey })));

  server.registerTool("kmerhosting_vps_snapshot_update", {
    description: "Update the name or description of an owned LXC VPS snapshot.",
    inputSchema: z.object({
      serviceId: z.string().min(1).describe("VPS instance UUID"),
      snapshotId: z.string().min(1).describe("Snapshot ID"),
      name: z.string().min(1).max(160).optional(),
      description: z.string().max(1000).optional(),
      ...mutationFields,
    }),
  }, ({ serviceId, snapshotId, name, description, idempotencyKey }) => execute(() => api.vps.snapshots.update(serviceId, snapshotId, { name, description }, { idempotencyKey })));

  server.registerTool("kmerhosting_vps_snapshot_delete", {
    description: "Delete an LXC VPS snapshot. Requires confirm=true because this is destructive.",
    inputSchema: z.object({
      serviceId: z.string().min(1).describe("VPS instance UUID"),
      snapshotId: z.string().min(1).describe("Snapshot ID"),
      confirm: z.literal(true).describe("Explicit confirmation of snapshot deletion"),
      ...mutationFields,
    }),
  }, ({ serviceId, snapshotId, idempotencyKey }) => execute(() => api.vps.snapshots.delete(serviceId, snapshotId, { idempotencyKey })));

  return server;
}

export async function startServer(): Promise<void> {
  serveStdio(() => createServer(), { onerror: (error) => console.error(`MCP transport error: ${error.message}`) });
  console.error("KmerHosting MCP server running on stdio");
}

if (import.meta.main) {
  startServer().catch((error) => {
    console.error(`KmerHosting MCP server failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
