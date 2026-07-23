# Known Issues And Interpretation

## Wrangler authentication

Wrangler 4.113.0 may print the account from plain `whoami` but remain running. Use `node node_modules/wrangler/bin/wrangler.js whoami --json` as the only authentication gate. If it is not authenticated, open the URL printed by `login --browser=false` and require the account holder to complete authorization. Do not automate consent, MFA, or challenge steps.

The same session can leave `wrangler deploy` open after printing the upload progress. Do not launch another deployment just because the command has not exited. Use a bounded wait, then inspect `wrangler deployments list` and perform root plus VLESS verification; the production script follows this procedure.

## Local DNS and Workerd failures

This environment has intermittently failed to resolve the custom hostname and reset Cloudflare DoH requests. Retry with a known Cloudflare edge IP only while preserving the hostname as TLS SNI, or verify through a network with healthy DNS. A root `404` from the custom hostname is the expected Worker behavior.

For the production script only, pass a recently verified A record through `CF_VLESS_EDGE_IP=<address>` when both DNS methods fail. This is a transient connectivity workaround, not a value to commit or retain after DNS recovers.

On macOS, the downloaded Workerd binary can fail before the Worker starts because the system rejects its signature. Treat that as a local runtime-tool failure; use the edge deployment and VLESS smoke result as the deployment evidence. Do not disable macOS security checks to force it to run.

## GitHub access

GitHub authentication can allow fetch and API metadata while rejecting content writes. Do not report a repository update until `git push` succeeds. Reauthorize an HTTPS credential with repository contents write access or configure an SSH key that has access to the target repository.

## `x.com` and `openai.com`

The deployed Worker has completed VLESS TCP and TLS to `www.google.com` with `HTTP/1.1 204 No Content`, proving the Worker entrypoint, UUID, WebSocket path, and generic TCP egress work. In the same test, `x.com:443` reset before a TLS handshake. This is an upstream policy applied to the Cloudflare Worker egress path, not an HTTP reverse-proxy or VLESS framing error. Do not add an HTTP mirror, spoof browser fingerprints, replay cookies, or otherwise bypass the site's controls.

`openai.com` can return a Cloudflare Managed Challenge to some egresses. Test in a normal browser through a configured client after neutral-site validation, and respect the upstream service and Cloudflare terms.
