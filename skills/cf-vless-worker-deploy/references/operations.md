# Deployment Operations

## Prerequisites

Use Node.js 20 or newer, an authenticated Wrangler session, and a Cloudflare account with Workers enabled. Start in the repository root.

```bash
npm install
npm run check
npm test
npx wrangler login
npx wrangler whoami
```

Confirm that `whoami` displays the intended account before secrets or deploys. Use the dashboard or `npx wrangler deployments list` to inspect existing deployments.

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
