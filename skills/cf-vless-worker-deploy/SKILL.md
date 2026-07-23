---
name: cf-vless-worker-deploy
description: Deploy, update, validate, or diagnose the yaojunru/cf-vless-worker Cloudflare Worker. Use when pulling the repository, authenticating Wrangler, configuring UUID and WS_PATH secrets, binding custom Worker domains, verifying VLESS-over-WebSocket connectivity to Google, generating client configuration and QR codes, or diagnosing access failures for openai.com and x.com.
---

# CF VLESS Worker Deploy

Deploy this Worker as a VLESS-over-WebSocket TCP relay. Do not treat it as an HTTP reverse proxy and do not add logic intended to bypass an upstream's anti-bot, access-control, or regional policy.

## Procedure

1. Work from a clean checkout. Run `git pull --ff-only`, then inspect `wrangler.toml`, `src/worker.js`, and `package.json` before changing configuration. A successful pull does not prove GitHub write access.
2. Run `scripts/preflight.sh <repo-dir>`. Resolve all failures before deployment.
3. Run `node scripts/local-smoke.mjs <repo-dir>` to verify the Worker runtime, WebSocket handling, VLESS framing, and an outbound TCP relay to `example.com:80` with random in-memory test variables.
4. For a credential-free edge preview, run `node scripts/temporary-smoke-deploy.mjs <repo-dir>`. It creates an expiring temporary Worker with random in-memory test variables and runs the same remote smoke checks.
5. Pass the authentication gate before any persistent deployment. Run:

   ```bash
   node node_modules/wrangler/bin/wrangler.js whoami --json
   ```

   Use `--json` because the human-readable command can remain open after printing its result. If it reports that Wrangler is not authenticated, run `node node_modules/wrangler/bin/wrangler.js login --use-keyring`. Open the authorization URL when Wrangler cannot launch a browser and wait for the account holder to complete consent. Do not bypass login, consent, MFA, or anti-bot controls. Stop here if its `loggedIn` field is not `true` or it does not show the intended account; do not set secrets or deploy.
6. For the repeatable production workflow, run `node scripts/production-deploy.mjs <repo-dir> <custom-domain>`. It pulls, opens the authorization page when required, requires the user to confirm the exact custom domain before binding it, creates secrets in memory, deploys with `--domain`, requires a hidden-root `404`, verifies a VLESS TLS request to Google, and writes ignored client configuration plus a QR SVG.
7. Otherwise, generate a UUID locally and choose a unique path at least eight characters long. Never write either secret to tracked files, shell history, CI logs, or client screenshots. Set secrets interactively:

   ```bash
   npx wrangler secret put UUID
   npx wrangler secret put WS_PATH
   ```

8. Deploy with `npm run deploy` for the default Worker endpoint, or bind a custom domain only after the Worker works. Keep the DNS record proxied. Use the exact FQDN and require user confirmation before binding it. Do not commit personal custom-domain routes, zone names, or hostnames to `wrangler.toml`.
9. Confirm that `/` is a `404`, the exact configured path only upgrades with a WebSocket request, and Google completes both TLS and an HTTP response through VLESS. Confirm the custom hostname resolves to Cloudflare before testing with a VLESS client.
10. Record the Worker version ID shown by Wrangler. Roll back with `npx wrangler rollback <version-id>` when the deployment regresses.

## Guardrails

- Treat successful `whoami --json` output as a hard prerequisite for `wrangler secret put`, `npm run deploy`, custom-domain changes, rollback, and deployment inspection. A `--temporary` deployment is not a substitute for the user's Cloudflare account.
- Treat custom domains as account-owner private configuration. Require the user to provide and confirm the exact FQDN during deployment; do not add `routes = [...]` or `workers_dev = false` to tracked config just to bind a personal hostname.
- Keep `UUID` and `WS_PATH` as Worker secrets, not `[vars]` in `wrangler.toml`.
- Validate the local implementation with `npm run check` and `npm test` before every production deployment.
- Treat a `403` from an upstream as the upstream's response, not proof that VLESS framing failed. Check a neutral HTTPS site first, then test the target from an ordinary browser through the configured VLESS client.
- Do not use Worker `fetch()` to make a generic browsing reverse proxy. It changes origin, cookies, redirects, CSP, WebSockets, and anti-abuse signals; it is not equivalent to a client TCP tunnel.
- Do not claim that a successful direct `curl` proves browser access. Conversely, do not attempt to evade challenges by spoofing browser data or relaying challenge cookies.

Read [references/operations.md](references/operations.md) for exact commands, generated artifacts, and rollback checks. Read [references/upstream-access.md](references/upstream-access.md) when diagnosing `openai.com`, `x.com`, or another protected site. Read [references/known-issues.md](references/known-issues.md) before treating a local tool, DNS, GitHub credential, or upstream reset as a Worker defect.
