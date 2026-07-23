import { connect } from "cloudflare:sockets";
import { normalizePath, normalizeUuid, parseVlessHeader } from "./vless.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade") || "";

    if (upgrade.toLowerCase() !== "websocket") return notFound();

    const uuid = normalizeUuid(env.UUID);
    const wsPath = normalizePath(env.WS_PATH);
    if (!uuid || !wsPath || url.pathname !== wsPath) return notFound();

    const pair = new WebSocketPair();
    const client = pair[0];
    const webSocket = pair[1];
    webSocket.accept();
    handleVless(webSocket, uuid).catch(() => safeClose(webSocket));

    return new Response(null, { status: 101, webSocket: client });
  },
};

async function handleVless(webSocket, uuid) {
  let remoteSocket = null;
  let firstPacket = true;
  let closed = false;
  let pendingWrite = Promise.resolve();

  webSocket.addEventListener("message", (event) => {
    // Message callbacks may overlap; serialize them to preserve TCP byte order.
    pendingWrite = pendingWrite.then(() => writeMessage(event.data)).catch(() => {
      closed = true;
      safeClose(webSocket);
    });
  });

  webSocket.addEventListener("close", closeRemote);
  webSocket.addEventListener("error", closeRemote);

  function closeRemote() {
    closed = true;
    try {
      remoteSocket?.close();
    } catch {}
  }

  async function writeMessage(data) {
    if (closed) return;
    const chunk = await toUint8Array(data);
    if (!chunk || chunk.byteLength === 0) return;

    if (firstPacket) {
      firstPacket = false;
      const parsed = parseVlessHeader(chunk, uuid);
      if (parsed.error) throw new Error(parsed.error);

      remoteSocket = connect({ hostname: parsed.address, port: parsed.port });
      remoteSocket.closed.catch(() => {}).finally(() => safeClose(webSocket));
      webSocket.send(parsed.responseHeader);
      pipeRemoteToWebSocket(remoteSocket, webSocket);

      if (parsed.rawData.byteLength > 0) {
        await writeToRemote(parsed.rawData, "first write timeout");
      }
      return;
    }

    if (!remoteSocket) throw new Error("remote socket is unavailable");
    await writeToRemote(chunk, "write timeout");
  }

  async function writeToRemote(chunk, message) {
    const writer = remoteSocket.writable.getWriter();
    try {
      await withTimeout(writer.write(chunk), 5000, message);
    } finally {
      writer.releaseLock();
    }
  }
}

async function pipeRemoteToWebSocket(remoteSocket, webSocket) {
  try {
    for await (const chunk of remoteSocket.readable) {
      if (webSocket.readyState !== WebSocket.OPEN) break;
      webSocket.send(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    }
  } catch {
  } finally {
    safeClose(webSocket);
  }
}

async function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && typeof data.arrayBuffer === "function") return new Uint8Array(await data.arrayBuffer());
  if (typeof data === "string") return new TextEncoder().encode(data);
  return null;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain;charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function safeClose(webSocket) {
  try {
    if (webSocket.readyState === WebSocket.OPEN || webSocket.readyState === WebSocket.CONNECTING) {
      webSocket.close();
    }
  } catch {}
}
