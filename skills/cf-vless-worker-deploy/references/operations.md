# Deployment Operations

## Prerequisites

Use Node.js 20 or newer, an authenticated Wrangler session, and a Cloudflare account with Workers enabled. Start in the repository root. This is a hard gate: do not set secrets or deploy until `whoami --json` succeeds.

```bash
npm install
npm run check
npm test
node node_modules/wrangler/bin/wrangler.js whoami --json
```

If `whoami --json` reports that you are not authenticated, log in with:

```bash
node node_modules/wrangler/bin/wrangler.js login --use-keyring
```

Complete the browser authorization, then repeat `whoami --json`. When the browser cannot be opened automatically, add `--browser=false` and open the printed link manually. Do not use plain `whoami` for automation because Wrangler 4.113.0 can stay open after printing the result. Confirm that the JSON has `loggedIn: true` and displays the intended account before secrets or deploys. Use the dashboard or `npx wrangler deployments list` to inspect existing deployments.

Pull the tracked repository before deploying. Require a clean worktree and fast-forward only; a fetch or pull confirms read access only.

```bash
git status --short
git pull --ff-only
```

## Production workflow

Run the bundled workflow with an exact custom domain supplied by the account holder:

```bash
node skills/cf-vless-worker-deploy/scripts/production-deploy.mjs . proxy.example.com
```

It performs the following in order: verifies the checkout, checks Wrangler JSON authentication, opens a browser authorization page if authentication is missing, runs code tests, requires the user to confirm the exact custom domain before binding it, creates a new UUID and WebSocket path only in process memory, stores them as Worker Secrets, deploys with `--domain`, requires the hidden root to return `404`, establishes a VLESS tunnel to `www.google.com:443`, completes TLS, requires an HTTP response, and writes a private client bundle.

For non-interactive automation, require an explicit confirmation variable whose value exactly matches the deployment hostname:

```bash
CF_VLESS_CONFIRM_DOMAIN=proxy.example.com node skills/cf-vless-worker-deploy/scripts/production-deploy.mjs . proxy.example.com
```

The bundle is written to `.vless-client/`, which must remain ignored by Git:

- `config.json`: Xray-compatible client configuration that proxies all traffic by default.
- `config-priority-domains.json`: Xray-compatible client configuration that proxies only high-priority domains and sends unmatched traffic direct.
- `priority-domains.txt`: the exact domain matchers used by `config-priority-domains.json`.
- `vless-uri.txt`: import URI for compatible clients.
- `vless-qr.svg`: offline QR code for the URI.

The default priority matcher list targets common OpenAI/ChatGPT, X/Twitter, and Google hostnames. Override it with a comma- or whitespace-separated list when the user asks for a different set:

```bash
CF_VLESS_PRIORITY_DOMAINS="openai.com chatgpt.com x.com twitter.com google.com" node skills/cf-vless-worker-deploy/scripts/production-deploy.mjs . proxy.example.com
```

Values without a matcher prefix are written as `domain:<hostname>`. Values beginning with `domain:`, `full:`, `keyword:`, `regexp:`, or `geosite:` are preserved after validation. This only controls client routing priority; it does not make protected sites accept Worker egress.

The script never prints generated credentials. Treat every file in this directory and screenshots of its QR code as a credential.

## Credential-free temporary smoke test

Run the local test first. It starts the Worker through Workerd, sends a valid VLESS request, and requires an HTTP response from its TCP socket. It does not use a Cloudflare account or publish anything:

```bash
node skills/cf-vless-worker-deploy/scripts/local-smoke.mjs .
```

Use this only to validate the Worker implementation before a real account deployment. It creates an expiring Cloudflare temporary preview, keeps its UUID and path in process memory, checks the hidden root behavior, and sends a valid VLESS request that relays an HTTP request to `example.com:80`.

```bash
node skills/cf-vless-worker-deploy/scripts/temporary-smoke-deploy.mjs .
```

The preview URL is not a production endpoint. It does not set persistent Worker Secrets, bind a domain, or test protected sites such as `openai.com`. If the preview URL returns a Cloudflare managed challenge or times out, treat that as a network or edge-access block before the Worker, not as a successful runtime test.

## Secrets and deploy

Generate the UUID locally:

```bash
uuidgen | tr '[:upper:]' '[:lower:]'
```

Use a long, unguessable WebSocket path such as `/assets/` followed by random characters. Enter both values only into the interactive Wrangler prompt:

```bash
npx wrangler secret put UUID
npx wrangler secret put WS_PATH
npm run deploy
```

Do not use `wrangler secret bulk` with a committed JSON file. Do not place either value in `wrangler.toml`.

## Custom domain

First create the binding for an exact hostname in a Cloudflare zone you control:

```bash
node node_modules/wrangler/bin/wrangler.js deploy --domain proxy.example.com --keep-vars
```

Do not commit that personal hostname to `wrangler.toml`. Future custom-domain deployments must pass `--domain proxy.example.com` again, or use the production script after confirming the domain. Then query the hostname and require the Worker root behavior:

```bash
dig +short proxy.example.com
curl -fsS -o /dev/null -w '%{http_code}\n' https://proxy.example.com/
```

The root response must be `404`. Do not bind an unowned hostname, an unproxied DNS record, or a wildcard route for this Worker.

## Smoke test

Replace `worker.example.com` and the path locally. The root must return `404`; that is the expected privacy behavior.

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://worker.example.com/
curl -i --http1.1 \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://worker.example.com/assets/replaceme
```

The second command is only a handshake check. A real VLESS client must supply a valid UUID and VLESS header to verify TCP forwarding.

## Rollback

After a deployment, save the version ID printed by Wrangler. To recover from a regression, use the known-good version ID:

```bash
npx wrangler rollback <version-id>
```

Run the root and client smoke tests again after rollback. Rotate the UUID and WS path when either secret may have been exposed.
