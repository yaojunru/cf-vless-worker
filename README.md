# CF VLESS Worker

一个极简 Cloudflare Worker VLESS over WebSocket 实现。

特点：

- 根路径默认返回 `404 Not found`，不会直接暴露节点信息
- 仅隐藏 WebSocket 路径接受代理连接
- UUID 和 WS 路径通过 Cloudflare 环境变量配置，不写死在公开代码里
- 只实现 VLESS TCP 转发，代码较短，便于审计
- 适合 Shadowrocket、v2rayN、sing-box、Xray 等支持 VLESS + WebSocket + TLS 的客户端

> 请遵守当地法律法规和 Cloudflare 服务条款。本项目仅用于学习、研究和合法网络连接场景。

## 工作方式

客户端使用：

```text
VLESS + TLS + WebSocket
```

Cloudflare 提供 TLS 和 WebSocket 入口，Worker 通过 `cloudflare:sockets` 发起 TCP 出站连接。

## 部署方式一：Cloudflare Dashboard

1. 打开 Cloudflare Dashboard。
2. 进入 `Workers & Pages`。
3. 创建一个 Worker。
4. 把 [`src/worker.js`](./src/worker.js) 的内容复制进去。
5. 在 Worker 的 `Settings` / `Variables and Secrets` 中添加：

   | 名称 | 示例 | 说明 |
   | --- | --- | --- |
   | `UUID` | `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` | 你的 VLESS UUID |
   | `WS_PATH` | `/assets/your-random-path` | 隐藏 WebSocket 路径 |

6. 部署 Worker。
7. 在 `Domains` 中绑定自定义域名，例如 `proxy.example.com`。

## 部署方式二：Wrangler CLI

安装依赖：

```bash
npm install
```

登录 Cloudflare：

```bash
npx wrangler login
```

生成 UUID：

```bash
uuidgen | tr '[:upper:]' '[:lower:]'
```

设置 Secret：

```bash
npx wrangler secret put UUID
npx wrangler secret put WS_PATH
```

`WS_PATH` 建议使用较长随机路径，例如：

```text
/assets/a1b2c3d4e5f60708
```

部署：

```bash
npm run deploy
```

自定义域名需要写入 `wrangler.toml`，避免下一次部署丢失绑定：

```toml
workers_dev = false
routes = [
  { pattern = "proxy.example.com", custom_domain = true }
]
```

首次绑定可执行 `npx wrangler deploy --domain proxy.example.com --keep-vars`，成功后再按上述配置执行一次 `npm run deploy`。

## Codex 部署 Skill

仓库内包含可复用的部署 Skill：[`skills/cf-vless-worker-deploy`](./skills/cf-vless-worker-deploy/)。它已覆盖预检、Secret 配置、部署验证、回滚和受保护网站的诊断边界。

在 Codex 全局安装目录中创建链接后，可直接调用 `$cf-vless-worker-deploy`：

```bash
ln -s "$(pwd)/skills/cf-vless-worker-deploy" "${CODEX_HOME:-$HOME/.codex}/skills/cf-vless-worker-deploy"
```

先执行不需要 Cloudflare 凭据的预检：

```bash
skills/cf-vless-worker-deploy/scripts/preflight.sh .
```

无需 Cloudflare 账户凭据也可运行一次性端到端预览。该命令随机生成仅在进程内使用的 UUID/路径，部署临时 Worker，并通过 VLESS TCP 请求验证到 `example.com:80` 的转发：

```bash
node skills/cf-vless-worker-deploy/scripts/temporary-smoke-deploy.mjs .
```

部署前可先运行本地 Workerd 验收，它会实际验证 WebSocket、VLESS 帧和 TCP 出站：

```bash
node skills/cf-vless-worker-deploy/scripts/local-smoke.mjs .
```

生产部署可使用内置流程。它会先执行 `git pull --ff-only`，检查 Wrangler 登录；未登录时打开 Cloudflare 授权页并等待账户持有人确认。随后它会创建新的 Worker Secrets、部署、验证根路径为 `404`、通过 VLESS 对 `www.google.com` 完成 TLS 与 HTTP 验证，并生成私有客户端配置和二维码：

```bash
node skills/cf-vless-worker-deploy/scripts/production-deploy.mjs . proxy.example.com
```

生成的 `config.json`、VLESS 导入链接和 QR SVG 位于 `.vless-client/`。该目录被 Git 忽略；不要提交、分享或截图其中的内容。Wrangler 在部分桌面环境中可能会在输出上传进度后不退出，流程会有界等待并通过部署列表和实际连通性继续验证。

## 客户端配置

假设：

```text
域名：proxy.example.com
UUID：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
WS_PATH：/assets/a1b2c3d4e5f60708
```

VLESS 链接：

```text
vless://xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx@proxy.example.com:443?encryption=none&security=tls&type=ws&host=proxy.example.com&sni=proxy.example.com&path=%2Fassets%2Fa1b2c3d4e5f60708#cf-vless-worker
```

Shadowrocket 手动配置：

```text
类型：VLESS
地址：proxy.example.com
端口：443
UUID：你的 UUID
加密：none
TLS：开启
传输：WebSocket
Host：proxy.example.com
SNI：proxy.example.com
Path：/assets/a1b2c3d4e5f60708
```

## 安全建议

- 不要把真实 UUID 和 WS 路径提交到 GitHub。
- 根路径不会显示节点，只有正确的隐藏 WS 路径才处理连接。
- 定期轮换 `UUID` 和 `WS_PATH`。
- 自定义域名建议开启 Cloudflare 代理。
- 如果节点泄露，立即更换 `UUID` 和 `WS_PATH` 后重新部署。

## 速度优化建议

- 使用离你客户端网络更近、延迟更低的 Cloudflare 自定义域。
- 优先使用 `VLESS + WebSocket + TLS`，不要再套一层 Shadowsocks `v2ray-plugin`。
- 客户端路由使用“规则”模式，国内直连、国外代理，可减少无效代理流量。
- Shadowrocket 中可关闭不必要的 UDP/Mux 选项，保持 TCP + WS 简洁。

## 为什么不使用 v2ray-plugin？

`v2ray-plugin` 主要用于 Shadowsocks，把 Shadowsocks 流量伪装成 WebSocket/TLS。

这个项目本身就是：

```text
VLESS over WebSocket over TLS
```

再套 `v2ray-plugin` 不会更安全，反而会增加复杂度、兼容性问题和延迟。更推荐使用隐藏路径、强 UUID、Cloudflare TLS 和最小化公开响应。

## 验证部署

根路径应返回 404：

```bash
curl -i https://proxy.example.com/
```

正确隐藏路径应返回 WebSocket `101 Switching Protocols`：

```bash
curl -i --http1.1 \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://proxy.example.com/assets/a1b2c3d4e5f60708
```

## `openai.com` 与 `x.com` 的访问说明

本项目是 VLESS TCP 隧道，不是 HTTP 反向代理。正确的访问链路是浏览器或应用通过 VLESS 客户端建立到目标站点的 TLS 连接；不要把 Worker URL 当作 `https://openai.com` 或 `https://x.com` 的镜像地址。

- `x.com` 首页可响应不代表登录、媒体、API 或 WebSocket 子资源一定可用，应在正常浏览器中通过已配置的客户端实测。
- 已验证的生产节点可以通过 VLESS 与 `www.google.com` 完成 TLS 并取得 `HTTP 204`，但同一条隧道连接 `x.com:443` 会在 TLS 握手前关闭。该结果表明节点的通用 TCP 出站正常，而 X 对 Cloudflare Worker 出口施加了上游策略；不能通过修改 Worker、增加 HTTP 镜像、伪造浏览器指纹或重放 Cookie 来绕过。
- `openai.com` 可能向某些出口返回 Cloudflare Managed Challenge（例如要求 JavaScript 和 Cookie）。这是上游的访问控制，不是 VLESS 帧或 Worker 路由错误，不能且不应通过伪造 Cookie、浏览器指纹或挑战参数来绕过。
- 先用普通 HTTPS 站点确认隧道可用，再使用支持 JavaScript 与 Cookie 的正常浏览器测试目标服务，并遵守目标服务和 Cloudflare 的条款。

详细的部署、排障与回滚步骤见 [`skills/cf-vless-worker-deploy`](./skills/cf-vless-worker-deploy/)。

## License

MIT
