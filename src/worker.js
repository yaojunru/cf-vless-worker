import { connect } from "cloudflare:sockets";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade") || "";

    if (upgrade.toLowerCase() !== "websocket") {
      return notFound();
    }

    const uuid = normalizeUuid(env.UUID);
    const wsPath = normalizePath(env.WS_PATH);

    if (!uuid || !wsPath || url.pathname !== wsPath) {
      return notFound();
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const webSocket = pair[1];
    webSocket.accept();

    handleVless(webSocket, uuid).catch(() => {
      safeClose(webSocket);
    });

    return new Response(null, { status: 101, webSocket: client });
  },
};

async function handleVless(webSocket, uuid) {
  let remoteSocket = null;
  let remoteWriter = null;
  let firstPacket = true;

  webSocket.addEventListener("message", async (event) => {
    try {
      const chunk = await toUint8Array(event.data);
      if (!chunk || chunk.byteLength === 0) return;

      if (firstPacket) {
        firstPacket = false;
        const parsed = parseVlessHeader(chunk, uuid);
        if (parsed.error) {
          safeClose(webSocket);
          return;
        }

        remoteSocket = connect({
          hostname: parsed.address,
          port: parsed.port,
        });

        remoteSocket.closed.catch(() => {}).finally(() => safeClose(webSocket));
        pipeRemoteToWebSocket(remoteSocket, webSocket, parsed.responseHeader);

        remoteWriter = remoteSocket.writable.getWriter();
        if (parsed.rawData.byteLength > 0) {
          await withTimeout(remoteWriter.write(parsed.rawData), 5000, "first write timeout");
        }
        remoteWriter.releaseLock();
        remoteWriter = null;
        return;
      }

      if (!remoteSocket) {
        safeClose(webSocket);
        return;
      }

      remoteWriter = remoteSocket.writable.getWriter();
      await withTimeout(remoteWriter.write(chunk), 5000, "write timeout");
      remoteWriter.releaseLock();
      remoteWriter = null;
    } catch {
      try {
        if (remoteWriter) remoteWriter.releaseLock();
      } catch {}
      safeClose(webSocket);
    }
  });

  webSocket.addEventListener("close", () => {
    try {
      remoteSocket?.close();
    } catch {}
  });

  webSocket.addEventListener("error", () => {
    try {
      remoteSocket?.close();
    } catch {}
  });
}

async function pipeRemoteToWebSocket(remoteSocket, webSocket, responseHeader) {
  let headerSent = false;
  try {
    for await (const chunk of remoteSocket.readable) {
      if (webSocket.readyState !== WebSocket.OPEN) break;
      const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);

      if (!headerSent) {
        headerSent = true;
        const out = new Uint8Array(responseHeader.byteLength + data.byteLength);
        out.set(responseHeader, 0);
        out.set(data, responseHeader.byteLength);
        webSocket.send(out);
      } else {
        webSocket.send(data);
      }
    }
  } catch {
  } finally {
    safeClose(webSocket);
  }
}

function parseVlessHeader(buffer, expectedUuid) {
  if (buffer.byteLength < 24) return { error: "packet too short" };

  const version = buffer[0];
  const clientUuid = stringifyUuid(buffer.slice(1, 17));
  if (clientUuid !== expectedUuid) return { error: "invalid uuid" };

  const optLen = buffer[17];
  const commandIndex = 18 + optLen;
  if (buffer.byteLength < commandIndex + 4) return { error: "invalid command" };

  const command = buffer[commandIndex];
  if (command !== 1) return { error: "tcp only" };

  const portIndex = commandIndex + 1;
  const port = (buffer[portIndex] << 8) | buffer[portIndex + 1];
  const addressTypeIndex = portIndex + 2;
  const addressType = buffer[addressTypeIndex];
  let addressIndex = addressTypeIndex + 1;
  let address = "";

  if (addressType === 1) {
    if (buffer.byteLength < addressIndex + 4) return { error: "bad ipv4" };
    address = Array.from(buffer.slice(addressIndex, addressIndex + 4)).join(".");
    addressIndex += 4;
  } else if (addressType === 2) {
    const len = buffer[addressIndex];
    addressIndex += 1;
    if (buffer.byteLength < addressIndex + len) return { error: "bad domain" };
    address = new TextDecoder().decode(buffer.slice(addressIndex, addressIndex + len));
    addressIndex += len;
  } else if (addressType === 3) {
    if (buffer.byteLength < addressIndex + 16) return { error: "bad ipv6" };
    const parts = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(((buffer[addressIndex + i] << 8) | buffer[addressIndex + i + 1]).toString(16));
    }
    address = parts.join(":");
    addressIndex += 16;
  } else {
    return { error: "unknown address type" };
  }

  if (!address || !port) return { error: "empty address or port" };

  return {
    address,
    port,
    rawData: buffer.slice(addressIndex),
    responseHeader: new Uint8Array([version, 0]),
  };
}

function normalizeUuid(uuid) {
  const value = String(uuid || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : "";
}

function normalizePath(path) {
  const value = String(path || "").trim();
  if (!value.startsWith("/") || value.includes("..") || value.length < 8) return "";
  return value;
}

function stringifyUuid(bytes) {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
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
