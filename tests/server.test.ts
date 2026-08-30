import { expect, test } from "bun:test";
import { MCP_TOOL_NAMES } from "../src/index";

test("registers the complete KmerHosting API tool surface", () => {
  expect(MCP_TOOL_NAMES).toHaveLength(25);
  expect(new Set(MCP_TOOL_NAMES).size).toBe(25);
  expect(MCP_TOOL_NAMES).toContain("kmerhosting_account_get");
  expect(MCP_TOOL_NAMES).toContain("kmerhosting_domain_dns_delete");
  expect(MCP_TOOL_NAMES).toContain("kmerhosting_vps_snapshot_delete");
});
