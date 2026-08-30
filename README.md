# KmerHosting MCP Server

Official Model Context Protocol server for the KmerHosting API.

It lets MCP-compatible AI clients inspect and manage the authenticated KmerHosting account through the official TypeScript SDK.

## Install

```bash
bun add -g @kmerhosting/mcp
```

Set the API key in the MCP client's environment:

```bash
export KMERHOSTING_API_KEY='kh_live_...'
```

Optional API URL override for staging:

```bash
export KMERHOSTING_API_URL='https://api.kmerhosting.com'
```

## MCP client configuration

After publishing, configure a local MCP client to start the server:

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

The server uses stdio. Keep stdout reserved for MCP protocol messages; diagnostics are written to stderr.

## Tools

The server exposes account, service, domain/DNS, email hosting, shared hosting and LXC VPS tools. Mutations accept an optional `idempotencyKey`. DNS deletion, snapshot deletion and VPS stop/shutdown require explicit `confirm: true`.

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
