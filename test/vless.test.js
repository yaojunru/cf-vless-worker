import assert from "node:assert/strict";
import test from "node:test";

import { normalizePath, normalizeUuid, parseVlessHeader } from "../src/vless.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

function vlessRequest({ address = "example.com", port = 443, command = 1, payload = [] } = {}) {
  const uuidBytes = UUID.replaceAll("-", "").match(/../g).map((hex) => Number.parseInt(hex, 16));
  const addressBytes = new TextEncoder().encode(address);
  return new Uint8Array([0, ...uuidBytes, 0, command, port >> 8, port & 0xff, 2, addressBytes.length, ...addressBytes, ...payload]);
}

test("parses a TCP domain request and preserves its payload", () => {
  const result = parseVlessHeader(vlessRequest({ payload: [1, 2, 3] }), UUID);
  assert.equal(result.address, "example.com");
  assert.equal(result.port, 443);
  assert.deepEqual(result.rawData, new Uint8Array([1, 2, 3]));
  assert.deepEqual(result.responseHeader, new Uint8Array([0, 0]));
});

test("rejects an invalid UUID and non-TCP commands", () => {
  assert.equal(parseVlessHeader(vlessRequest(), "00000000-0000-4000-8000-000000000000").error, "invalid uuid");
  assert.equal(parseVlessHeader(vlessRequest({ command: 2 }), UUID).error, "tcp only");
});

test("rejects malformed addresses and normalizes configuration", () => {
  assert.equal(parseVlessHeader(vlessRequest({ address: "" }), UUID).error, "packet too short");
  assert.equal(normalizeUuid(UUID.toUpperCase()), UUID);
  assert.equal(normalizeUuid("not-a-uuid"), "");
  assert.equal(normalizePath("/assets/a1b2c3d4"), "/assets/a1b2c3d4");
  assert.equal(normalizePath("/../secret"), "");
});
