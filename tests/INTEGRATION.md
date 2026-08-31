# Remote integration test

The remote integration test is intentionally skipped unless
`RUN_KMERHOSTING_INTEGRATION=1` is set. The GitHub Actions workflow enables it
with dedicated credentials for two different KmerHosting users.

Required repository secrets:

- `KH_TEST_TOKEN_A` and `KH_TEST_TOKEN_B`: user-scoped OAuth access tokens for
  two separate test tenants.
- `KH_TEST_SERVICE_ID_A` and `KH_TEST_SERVICE_ID_B`: optional UUIDs of one
  service owned by each tenant. When set, the test verifies cross-tenant reads
  return `service_not_found`.
- `KH_TEST_REVOKED_TOKEN` and `KH_TEST_EXPIRED_TOKEN`: optional tokens used to
  verify the API and MCP reject revoked and expired credentials.

Optional repository variables:

- `KH_INTEGRATION_API_URL` (defaults to `https://api.kmerhosting.com`)
- `KH_INTEGRATION_MCP_URL` (defaults to `https://mcp.kmerhosting.com/mcp`)

The workflow only performs reads and tool calls. The manual
`allow_sandbox_writes` input is reserved for a future explicitly scoped,
reversible sandbox test; it is not a switch for production writes.

Run locally with:

```bash
RUN_KMERHOSTING_INTEGRATION=1 \
KH_TEST_TOKEN_A='...' \
KH_TEST_TOKEN_B='...' \
bun test tests/integration.test.ts
```

Do not echo tokens or put them in repository files.
