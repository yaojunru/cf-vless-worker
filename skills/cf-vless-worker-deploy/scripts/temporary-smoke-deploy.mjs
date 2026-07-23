#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";

const repoDir = resolve(process.argv[2] || ".");
const wrangler = resolve(repoDir, "node_modules/wrangler/bin/wrangler.js");
if (!existsSync(wrangler)) throw new Error("Wrangler is not installed. Run npm install with a writable npm cache first.");

const uuid = randomUUID();
const wsPath = `/assets/smoke-${randomBytes(12).toString("hex")}`;
const deploy = await run(process.execPath, [
  wrangler,
  "deploy",
  "--temporary",
  "--var", `UUID:${uuid}`,
  "--var", `WS_PATH:${wsPath}`,
], repoDir);

const workerUrl = deploy.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
if (!workerUrl) throw new Error("Wrangler did not print a temporary Worker URL.");

let root;
try {
  root = await fetch(workerUrl, { signal: AbortSignal.timeout(20_000) });
} catch (error) {
  throw new Error(`Temporary Worker URL was unreachable before runtime verification: ${error.message}`);
}
if (root.status !== 404) {
  const mitigation = root.headers.get("cf-mitigated");
  throw new Error(`Expected root status 404, received ${root.status}${mitigation ? ` (cf-mitigated: ${mitigation})` : ""}.`);
}

await verifyVlessTcp(workerUrl, wsPath, uuid);
console.log(`Temporary deployment verified: ${workerUrl}`);

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { output += chunk; process.stderr.write(chunk); });
    child.once("error", rejectRun);
    child.once("close", (code) => code === 0 ? resolveRun(output) : rejectRun(new Error(`Temporary deploy failed with exit code ${code}`)));
  });
}

async function verifyVlessTcp(workerUrl, path, clientUuid) {
  const { WebSocket } = await import("ws");
  const endpoint = new URL(path, workerUrl).href.replace(/^http/, "ws");
  const socket = new WebSocket(endpoint);

  try {
    await once(socket, "open");
    socket.send(vlessRequest(clientUuid));
    await new Promise((resolveResponse, rejectResponse) => {
      let response = Buffer.alloc(0);
      const timer = setTimeout(() => rejectResponse(new Error("Timed out waiting for the VLESS TCP response.")), 20_000);
      const complete = (result) => {
        clearTimeout(timer);
        socket.off("message", onMessage);
        socket.off("close", onClose);
        socket.off("error", onError);
        result();
      };
      const onMessage = (message) => {
        response = Buffer.concat([response, Buffer.from(message)]);
        if (response.length >= 2 && response.subarray(0, 2).equals(Buffer.from([0, 0])) && response.includes("HTTP/")) {
          complete(resolveResponse);
        }
      };
      const onClose = () => complete(() => rejectResponse(new Error("Worker closed before receiving an HTTP response through VLESS TCP.")));
      const onError = (error) => complete(() => rejectResponse(error));
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
