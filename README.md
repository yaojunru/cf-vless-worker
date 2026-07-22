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

## License

MIT
