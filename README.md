# KmerHosting MCP Server

Official Model Context Protocol server for the KmerHosting API.

It lets MCP-compatible AI clients inspect and manage the authenticated KmerHosting account through the official TypeScript SDK.

## Choose a connection method

| Method | Best for | Authentication |
| --- | --- | --- |
| Hosted OAuth | MCP clients with OAuth 2.1 support | Sign in to your KmerHosting account; no shared API key |
| Local stdio | Local clients, development and controlled automation | A scoped KmerHosting API key stored in the client environment |

## Method 1 — Hosted OAuth

Connect an OAuth 2.1-compatible MCP client to:

```text
https://mcp.kmerhosting.com/mcp
```

The server publishes OAuth discovery and Dynamic Client Registration metadata. Your client redirects you to `https://dashboard.kmerhosting.com/oauth/authorize` for PKCE consent. Sign in, select only the scopes the client needs, and approve the request. Hosted clients do **not** need a shared `KMERHOSTING_API_KEY`.

Use this method when the client supports hosted MCP servers and OAuth. Request `offline_access` only when the client genuinely needs refresh access.

## Method 2 — Local stdio

Install the official GitHub repository. The executable is bundled in the repository so Bun does not need to trust or run a package lifecycle script:

```bash
bun add --global github:KmerHosting/mcp
```

The installed executable is `kmerhosting-mcp`. Put a scoped API key in the MCP client's protected environment, never in its configuration file or source control:

```bash
export KMERHOSTING_API_KEY='kh_live_...'
```

Configure the local MCP client to start the server:

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

Optional API URL override for staging:

```bash
export KMERHOSTING_API_URL='https://api.kmerhosting.com'
```

Keep stdout reserved for MCP protocol messages in stdio mode; diagnostics are written to stderr.

## Hosted deployment (operators)

The server uses stdio by default. Set these variables only when operating a Streamable HTTP deployment at `/mcp`:

```bash
MCP_HTTP_PORT=8791
MCP_HTTP_HOST=127.0.0.1
MCP_PUBLIC_URL=https://mcp.kmerhosting.com
KMERHOSTING_OAUTH_BACKEND_URL=https://YOUR_PROJECT.supabase.co/functions/v1/dashboard-mcp-oauth
```

## Tools

The server exposes account details and API activity (including operation routes and source IPv4s), service, domain/DNS, email hosting, shared hosting, complete public LXC management, and KVM management tools. Mutations accept an optional `idempotencyKey`. Destructive, credential, terminal and subscription-changing tools require explicit confirmation; dangerous API scopes are additionally restricted by the key's IPv4 allowlist.

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
