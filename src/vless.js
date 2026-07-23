export function parseVlessHeader(buffer, expectedUuid) {
  if (!(buffer instanceof Uint8Array) || buffer.byteLength < 24) {
    return { error: "packet too short" };
  }

  const version = buffer[0];
  const clientUuid = stringifyUuid(buffer.slice(1, 17));
  if (clientUuid !== expectedUuid) return { error: "invalid uuid" };

  const optLen = buffer[17];
  const commandIndex = 18 + optLen;
  if (buffer.byteLength < commandIndex + 4) return { error: "invalid command" };

  if (buffer[commandIndex] !== 1) return { error: "tcp only" };

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
    const length = buffer[addressIndex];
    addressIndex += 1;
    if (length === 0 || buffer.byteLength < addressIndex + length) return { error: "bad domain" };
    try {
      address = new TextDecoder("utf-8", { fatal: true }).decode(buffer.slice(addressIndex, addressIndex + length));
    } catch {
      return { error: "bad domain" };
    }
    addressIndex += length;
  } else if (addressType === 3) {
    if (buffer.byteLength < addressIndex + 16) return { error: "bad ipv6" };
    const parts = [];
    for (let index = 0; index < 16; index += 2) {
      parts.push(((buffer[addressIndex + index] << 8) | buffer[addressIndex + index + 1]).toString(16));
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

export function normalizeUuid(uuid) {
  const value = String(uuid || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : "";
}

export function normalizePath(path) {
  const value = String(path || "").trim();
  if (!value.startsWith("/") || value.includes("..") || value.length < 8) return "";
  return value;
}

function stringifyUuid(bytes) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
}
