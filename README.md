# KmerHosting MCP Server

Official Model Context Protocol server for the KmerHosting API.

It lets MCP-compatible AI clients inspect and manage the authenticated KmerHosting account through the official TypeScript SDK.

## Install

The package is not published on the npm registry yet. Install the official GitHub repository instead; the `prepare` step builds the executable automatically:

```bash
bun add -g github:KmerHosting/mcp
```

The installed executable is `kmerhosting-mcp`.

Set the API key in the MCP client's environment:

```bash
export KMERHOSTING_API_KEY='kh_live_...'
```

Optional API URL override for staging:

```bash
export KMERHOSTING_API_URL='https://api.kmerhosting.com'
```

## MCP client configuration

Configure a local MCP client to start the server:

```json
{
  "mcpServers": {
    "kmerhosting": {
      "command": "kmerhosting-mcp",
      "env": {
        "KMERHOSTING_API_KEY": "kh_live_..."
      }
    }
  }
}
```

The server uses stdio by default. For the hosted deployment, set `MCP_HTTP_PORT` to serve Streamable HTTP at `/mcp`; each request uses its user-scoped OAuth bearer token.

Hosted MCP endpoint: `https://mcp.kmerhosting.com/mcp`. It publishes OAuth 2.1 discovery and Dynamic Client Registration, then sends users to `https://dashboard.kmerhosting.com/oauth/authorize` for PKCE consent. No shared API key is required for hosted users.

HTTP environment variables:

```bash
MCP_HTTP_PORT=8791
MCP_HTTP_HOST=127.0.0.1
MCP_PUBLIC_URL=https://mcp.kmerhosting.com
KMERHOSTING_OAUTH_BACKEND_URL=https://YOUR_PROJECT.supabase.co/functions/v1/dashboard-mcp-oauth
```

Keep stdout reserved for MCP protocol messages in stdio mode; diagnostics are written to stderr.

## Tools

The server exposes account details and API activity (including operation routes and source IPv4s), service, domain/DNS, email hosting, shared hosting, read-only LXC, and KVM management tools. Mutations accept an optional `idempotencyKey`. DNS deletion, KVM snapshot deletion, and KVM stop/shutdown require explicit `confirm: true`.

## Security

The API key is read only from the environment and is never returned by a tool or written to logs. Use a secret manager or the MCP client's protected environment configuration. Never place the key in source control or a client-side application.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

## License

Apache-2.0. KmerHosting trademarks are not granted by the license.
