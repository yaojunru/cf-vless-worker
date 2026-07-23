---
name: cf-vless-worker-deploy
description: Deploy, update, validate, or diagnose the yaojunru/cf-vless-worker Cloudflare Worker. Use when configuring Wrangler, UUID and WS_PATH secrets, custom Worker domains, VLESS over WebSocket connectivity, deployment rollback, or access failures for websites such as openai.com and x.com.
---

# CF VLESS Worker Deploy

Deploy this Worker as a VLESS-over-WebSocket TCP relay. Do not treat it as an HTTP reverse proxy and do not add logic intended to bypass an upstream's anti-bot, access-control, or regional policy.

## Procedure

1. Work from a clean checkout and inspect `wrangler.toml`, `src/worker.js`, and `package.json` before changing configuration.
2. Run `scripts/preflight.sh <repo-dir>`. Resolve all failures before deployment.
3. Run `node scripts/local-smoke.mjs <repo-dir>` to verify the Worker runtime, WebSocket handling, VLESS framing, and an outbound TCP relay to `example.com:80` with random in-memory test variables.
4. For a credential-free edge preview, run `node scripts/temporary-smoke-deploy.mjs <repo-dir>`. It creates an expiring temporary Worker with random in-memory test variables and runs the same remote smoke checks.
5. Authenticate with `npx wrangler login`, then confirm the intended account with `npx wrangler whoami` before a persistent deployment.
6. Generate a UUID locally and choose a unique path at least eight characters long. Never write either secret to tracked files, shell history, CI logs, or client screenshots.
7. Set secrets interactively:

   ```bash
   npx wrangler secret put UUID
   npx wrangler secret put WS_PATH
   ```

8. Deploy with `npm run deploy`. Bind a custom domain only after the Worker URL works. Keep the DNS record proxied.
9. Confirm that `/` is a `404` and that the exact configured path only upgrades with a WebSocket request. Use a VLESS client to test an actual TCP connection.
10. Record the Worker version ID shown by Wrangler. Roll back with `npx wrangler rollback <version-id>` when the deployment regresses.

## Guardrails

- Keep `UUID` and `WS_PATH` as Worker secrets, not `[vars]` in `wrangler.toml`.
- Validate the local implementation with `npm run check` and `npm test` before every production deployment.
- Treat a `403` from an upstream as the upstream's response, not proof that VLESS framing failed. Check a neutral HTTPS site first, then test the target from an ordinary browser through the configured VLESS client.
- Do not use Worker `fetch()` to make a generic browsing reverse proxy. It changes origin, cookies, redirects, CSP, WebSockets, and anti-abuse signals; it is not equivalent to a client TCP tunnel.
- Do not claim that a successful direct `curl` proves browser access. Conversely, do not attempt to evade challenges by spoofing browser data or relaying challenge cookies.

Read [references/operations.md](references/operations.md) for exact commands and rollback checks. Read [references/upstream-access.md](references/upstream-access.md) when diagnosing `openai.com`, `x.com`, or another protected site.
