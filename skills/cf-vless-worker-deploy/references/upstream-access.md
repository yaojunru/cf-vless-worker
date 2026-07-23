# Upstream Access Diagnosis

This project creates a raw TCP connection from the Worker after the VLESS client establishes WebSocket transport. It does not fetch, rewrite, or browser-render destination websites.

## Correct test order

1. Confirm a normal TLS destination works through the configured VLESS client.
2. Confirm the client uses VLESS, TLS, WebSocket, the custom Worker host, and the exact `WS_PATH`.
3. Test the target in an ordinary browser routed through that client. Keep browser JavaScript and cookies enabled.
4. Capture only status, timestamp, client mode, and the target's response category. Do not collect login cookies, tokens, or challenge parameters.

## `openai.com` and `x.com`

`openai.com` and `x.com` are both protected, dynamic services. Their availability depends on the destination's policy, account and regional eligibility, browser integrity checks, and the egress network's reputation. A Worker cannot make a destination accept a request that it elects to challenge or deny.

An OpenAI response containing `cf-mitigated: challenge` or a page asking for JavaScript and cookies is an upstream Cloudflare managed challenge. Do not try to replay its cookies, alter fingerprints, or use a Worker to solve it. Test with a supported, logged-in browser and follow the service's normal access route.

`x.com` returning `200` only shows that its landing page responded for that test. Authentication, media, API, and WebSocket subresources can still have different policies.

## Cloudflare Worker limits

Cloudflare Workers TCP sockets provide outbound TCP connections. Destination behavior and platform limits can change. Check the current Cloudflare TCP sockets documentation before diagnosing a new platform error: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
