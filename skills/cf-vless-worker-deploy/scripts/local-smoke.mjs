#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const repoDir = resolve(process.argv[2] || ".");
const wrangler = resolve(repoDir, "node_modules/wrangler/bin/wrangler.js");
if (!existsSync(wrangler)) throw new Error("Wrangler is not installed. Run npm install with a writable npm cache first.");

const port = await unusedPort();
const uuid = randomUUID();
const wsPath = `/assets/smoke-${randomBytes(12).toString("hex")}`;
const worker = spawn(process.execPath, [
  wrangler,
  "dev",
  "--local",
  "--ip", "127.0.0.1",
  "--port", String(port),
  "--var", `UUID:${uuid}`,
  "--var", `WS_PATH:${wsPath}`,
], { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"] });

worker.stdout.pipe(process.stdout);
worker.stderr.pipe(process.stderr);

try {
  await waitForRoot(port, worker);
  await verifyVlessTcp(`ws://127.0.0.1:${port}${wsPath}`, uuid);
  console.log("Local Worker and VLESS TCP relay verified.");
} finally {
  worker.kill("SIGINT");
  await Promise.race([once(worker, "close"), delay(5_000)]);
  if (worker.exitCode === null) worker.kill("SIGKILL");
}

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port: allocatedPort } = server.address();
  server.close();
  return allocatedPort;
}

async function waitForRoot(port, worker) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`Local Worker exited with code ${worker.exitCode}.`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
      assert.equal(response.status, 404, "root route must remain hidden");
      return;
    } catch (error) {
      if (error?.name === "AssertionError") throw error;
      await delay(300);
    }
  }
  throw new Error("Timed out waiting for the local Worker.");
}

async function verifyVlessTcp(endpoint, clientUuid) {
  const { WebSocket } = await import("ws");
  const socket = new WebSocket(endpoint);
  try {
    await once(socket, "open");
    socket.send(vlessRequest(clientUuid));
    await new Promise((resolveResponse, rejectResponse) => {
      let response = Buffer.alloc(0);
      const timer = setTimeout(() => done(() => rejectResponse(new Error("Timed out waiting for the VLESS TCP response."))), 20_000);
      const done = (result) => {
        clearTimeout(timer);
        socket.off("message", onMessage);
        socket.off("close", onClose);
        socket.off("error", onError);
        result();
      };
      const onMessage = (message) => {
        response = Buffer.concat([response, Buffer.from(message)]);
        if (response.length >= 2 && response.subarray(0, 2).equals(Buffer.from([0, 0])) && response.includes("HTTP/")) {
          done(resolveResponse);
        }
      };
      const onClose = () => done(() => rejectResponse(new Error("Worker closed before receiving an HTTP response through VLESS TCP.")));
      const onError = (error) => done(() => rejectResponse(error));
      socket.on("message", onMessage);
      socket.once("close", onClose);
      socket.once("error", onError);
    });
  } finally {
    socket.close();
  }
}

function vlessRequest(clientUuid) {
  const uuid = Buffer.from(clientUuid.replaceAll("-", ""), "hex");
  const address = Buffer.from("example.com");
  const request = Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n");
  return Buffer.concat([Buffer.from([0]), uuid, Buffer.from([0, 1, 0, 80, 2, address.length]), address, request]);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
