# Hosted MCP rollout

Run the database and Edge Function changes before starting the VPS service.

## Supabase

From the Dashboard repository, apply the new migration and deploy the OAuth function:

```bash
supabase db push
supabase functions deploy dashboard-mcp-oauth
```

From the API repository, apply `supabase/migrations/0003_oauth_access_tokens.sql` to the same Supabase project. It adds the API-side OAuth usage, rate-limit and idempotency tables.

The OAuth function must use the existing Dashboard secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Do not copy either secret into the MCP repository.

## VPS

The service listens privately on 127.0.0.1:8791. Keep the existing API listener unchanged, even if it uses 8790.

```bash
sudo useradd --system --home /opt/kmerhosting-mcp --shell /usr/sbin/nologin kmermcp || true
sudo install -d -o kmermcp -g kmermcp /opt/kmerhosting-mcp
sudo -u kmermcp git clone https://github.com/KmerHosting/mcp.git /opt/kmerhosting-mcp
cd /opt/kmerhosting-mcp
sudo -u kmermcp bun install --frozen-lockfile
sudo install -o root -g root -m 0600 .env.example /etc/kmerhosting-mcp.env
sudoedit /etc/kmerhosting-mcp.env
sudo install -o root -g root -m 0644 deploy/kmerhosting-mcp.service /etc/systemd/system/kmerhosting-mcp.service
sudo install -o root -g root -m 0644 deploy/nginx/mcp.kmerhosting.com.conf /etc/nginx/sites-available/mcp.kmerhosting.com.conf
sudo ln -s /etc/nginx/sites-available/mcp.kmerhosting.com.conf /etc/nginx/sites-enabled/mcp.kmerhosting.com.conf
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now kmerhosting-mcp
sudo systemctl reload nginx
```

Set `KMERHOSTING_OAUTH_BACKEND_URL` in `/etc/kmerhosting-mcp.env` to the real Supabase URL:

```
https://YOUR_PROJECT.supabase.co/functions/v1/dashboard-mcp-oauth
```

The certificate paths in the Nginx template must exist before \\`nginx -t\\`. If the certificate does not already exist, issue it first with your existing ACME method (for example, temporarily stop Nginx and use standalone mode):

```bash
sudo systemctl stop nginx
sudo certbot certonly --standalone -d mcp.kmerhosting.com
sudo systemctl start nginx
```

## Smoke test

```bash
curl -fsS https://mcp.kmerhosting.com/health
curl -fsS https://mcp.kmerhosting.com/.well-known/oauth-protected-resource
curl -fsS https://mcp.kmerhosting.com/.well-known/oauth-authorization-server
```

The public endpoint must not contain `KMERHOSTING_API_KEY`; every hosted user receives an individual OAuth token after Dashboard consent.
