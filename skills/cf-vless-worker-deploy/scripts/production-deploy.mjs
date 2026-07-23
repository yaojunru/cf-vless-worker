#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { request } from "node:https";
import { resolve4 } from "node:dns/promises";
import tls from "node:tls";
import process from "node:process";

const require = createRequire(import.meta.url);
const QRCode = require("../assets/qrcode-terminal/QRCode");
const QRErrorCorrectLevel = require("../assets/qrcode-terminal/QRCode/QRErrorCorrectLevel");
const { WebSocket, createWebSocketStream } = require("ws");

const repoDir = resolve(process.argv[2] || ".");
const domain = process.argv[3];
const outputDir = resolve(process.argv[4] || join(repoDir, ".vless-client"));
if (!domain || !/^[a-z0-9.-]+$/i.test(domain) || domain.startsWith(".") || domain.endsWith(".")) {
  throw new Error("Usage: node production-deploy.mjs <repo-dir> <custom-domain> [output-dir]");
}

const wrangler = resolve(repoDir, "node_modules/wrangler/bin/wrangler.js");
if (!existsSync(wrangler)) throw new Error("Wrangler is not installed. Run npm install first.");
const configPath = join(repoDir, "wrangler.toml");
const config = await readFile(configPath, "utf8");
if (!config.includes(`pattern = \"${domain}\"`) || !config.includes("custom_domain = true")) {
  throw new Error(`${domain} is not a custom-domain route in ${configPath}.`);
}

await requireCleanCheckout();
await run("git", ["pull", "--ff-only"], repoDir);
await ensureWranglerLogin();
await run("npm", ["run", "check"], repoDir);
await run("npm", ["test"], repoDir);

const uuid = randomUUID();
const wsPath = `/assets/${randomBytes(20).toString("hex")}`;
await putSecret("UUID", uuid);
await putSecret("WS_PATH", wsPath);
await writeClientBundle(uuid, wsPath);

const deployment = await run(process.execPath, [wrangler, "deploy", "--keep-vars"], repoDir, { allowFailure: true, timeoutMs: 45_000 });
if (!deployment.output.includes("Total Upload") && deployment.code !== 0) {
  throw new Error(`Wrangler deployment did not begin successfully (exit ${deployment.code}).`);
}
if (deployment.code === 124) console.log("Wrangler deploy timed out after upload; confirming the active version through Cloudflare.");
const deployments = await run(process.execPath, [wrangler, "deployments", "list"], repoDir, { print: false });
const version = deployment.output.match(/Current Version ID:\s*([\w-]+)/)?.[1]
  || [...deployments.matchAll(/Version\(s\):\s+\(100%\)\s+([\w-]+)/g)].at(-1)?.[1]
  || "unknown";
const edgeAddress = await resolveEdgeAddress(domain);
const rootStatus = await requestRoot(domain, edgeAddress);
if (rootStatus !== 404) throw new Error(`Expected ${domain}/ to return 404, received ${rootStatus}.`);
const googleStatus = await verifyVlessTls(domain, edgeAddress, wsPath, uuid, "www.google.com", "/generate_204");
console.log(`Deployment verified: version ${version}; root 404; Google ${googleStatus}.`);
console.log(`Private client bundle written to ${outputDir}`);

async function requireCleanCheckout() {
  const status = await run("git", ["status", "--porcelain"], repoDir, { print: false });
  if (status.trim()) throw new Error("The checkout is not clean. Commit or stash changes before running production deployment.");
}

async function ensureWranglerLogin() {
  const result = await run(process.execPath, [wrangler, "whoami", "--json"], repoDir, { print: false, allowFailure: true });
  try {
    if (result.code === 0 && JSON.parse(result.output).loggedIn === true) return;
  } catch {
    // Start the documented authorization flow below.
  }

  console.log("Wrangler is not authenticated. Opening the Cloudflare authorization page when its URL is available.");
  await runLogin();
  const verified = await run(process.execPath, [wrangler, "whoami", "--json"], repoDir, { print: false });
  if (JSON.parse(verified).loggedIn !== true) throw new Error("Cloudflare authorization did not complete.");
}

async function runLogin() {
  await new Promise((resolveLogin, rejectLogin) => {
    const child = spawn(process.execPath, [wrangler, "login", "--browser=false"], { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"] });
    let opened = false;
    const handleOutput = (chunk, destination) => {
      const text = chunk.toString();
      destination.write(text);
      const url = text.match(/https?:\/\/[^\s)]+/)?.[0];
      if (url && !opened) {
        opened = true;
        openBrowser(url);
      }
    };
    child.stdout.on("data", (chunk) => handleOutput(chunk, process.stdout));
    child.stderr.on("data", (chunk) => handleOutput(chunk, process.stderr));
    child.once("error", rejectLogin);
    child.once("close", (code) => code === 0 ? resolveLogin() : rejectLogin(new Error(`Wrangler login failed with exit code ${code}.`)));
  });
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

async function putSecret(name, value) {
  await run(process.execPath, [wrangler, "secret", "put", name], repoDir, { input: value, print: true });
}

async function resolveEdgeAddress(hostname) {
  if (process.env.CF_VLESS_EDGE_IP) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(process.env.CF_VLESS_EDGE_IP)) {
      throw new Error("CF_VLESS_EDGE_IP must be an IPv4 address.");
    }
    return process.env.CF_VLESS_EDGE_IP;
  }
  try {
    return (await resolve4(hostname))[0];
  } catch {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json();
    const address = body.Answer?.find((record) => record.type === 1)?.data;
    if (!address) throw new Error(`No IPv4 address found for ${hostname}.`);
    return address;
  }
}

function cloudflareLookup(address) {
  return (_hostname, options, callback) => options?.all
    ? callback(null, [{ address, family: 4 }])
    : callback(null, address, 4);
}

function requestRoot(hostname, address) {
  return new Promise((resolveStatus, rejectStatus) => {
    const req = request({ hostname, method: "GET", path: "/", lookup: cloudflareLookup(address), servername: hostname, timeout: 20_000 }, (response) => {
      response.resume();
      resolveStatus(response.statusCode);
    });
    req.once("timeout", () => req.destroy(new Error("Timed out requesting Worker root.")));
    req.once("error", rejectStatus);
    req.end();
  });
}

async function verifyVlessTls(workerHost, workerAddress, path, clientUuid, targetHost, targetPath) {
  const socket = new WebSocket(`wss://${workerHost}${path}`, {
    handshakeTimeout: 20_000,
    lookup: cloudflareLookup(workerAddress),
  });
  try {
    await withTimeout(once(socket, "open"), 25_000, "VLESS WebSocket connection");
    const tunnel = createWebSocketStream(socket);
    tunnel.write(vlessRequest(clientUuid, targetHost, 443));
    const header = await withTimeout(readPrefix(tunnel, 2), 25_000, "VLESS response");
    if (!header.equals(Buffer.from([0, 0]))) throw new Error(`Unexpected VLESS response header: ${header.toString("hex")}`);
    const secure = tls.connect({ socket: tunnel, servername: targetHost, ALPNProtocols: ["http/1.1"] });
    await withTimeout(once(secure, "secureConnect"), 25_000, `TLS handshake with ${targetHost}`);
    const status = await readHttpStatus(secure, `GET ${targetPath} HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\n\r\n`);
    if (!/^HTTP\/1\.[01] [23]\d\d/.test(status)) throw new Error(`${targetHost} returned ${status}.`);
    secure.destroy();
    return status;
  } finally {
    socket.close();
  }
}

function vlessRequest(uuid, hostname, port) {
  const address = Buffer.from(hostname);
  return Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll("-", ""), "hex"), Buffer.from([0, 1, port >> 8, port & 255, 2, address.length]), address]);
}

function readPrefix(stream, length) {
  return new Promise((resolvePrefix, rejectPrefix) => {
    let received = Buffer.alloc(0);
    const cleanup = () => { stream.off("data", onData); stream.off("error", onError); stream.off("close", onClose); };
    const onData = (chunk) => {
      received = Buffer.concat([received, Buffer.from(chunk)]);
      if (received.length < length) return;
      stream.pause();
      cleanup();
      const remaining = received.subarray(length);
      if (remaining.length) stream.unshift(remaining);
      resolvePrefix(received.subarray(0, length));
    };
    const onError = (error) => { cleanup(); rejectPrefix(error); };
    const onClose = () => { cleanup(); rejectPrefix(new Error("Tunnel closed before the VLESS response header.")); };
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("close", onClose);
    stream.resume();
  });
}

function readHttpStatus(socket, requestText) {
  return new Promise((resolveStatus, rejectStatus) => {
    const timer = setTimeout(() => done(rejectStatus, new Error("Timed out waiting for HTTP response through VLESS.")), 25_000);
    const done = (callback, value) => { clearTimeout(timer); socket.off("data", onData); socket.off("error", onError); callback(value); };
    const onData = (chunk) => {
      const status = Buffer.from(chunk).toString("latin1").split("\r\n", 1)[0];
      if (status.startsWith("HTTP/")) done(resolveStatus, status);
    };
    const onError = (error) => done(rejectStatus, error);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(requestText);
  });
}

function withTimeout(promise, milliseconds, name) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out.`)), milliseconds))]);
}

async function writeClientBundle(uuid, path) {
  const uri = new URL(`vless://${uuid}@${domain}:443`);
  uri.searchParams.set("encryption", "none");
  uri.searchParams.set("security", "tls");
  uri.searchParams.set("type", "ws");
  uri.searchParams.set("host", domain);
  uri.searchParams.set("path", path);
  uri.searchParams.set("sni", domain);
  uri.hash = `${domain}-ws`;
  const config = {
    log: { loglevel: "warning" },
    inbounds: [
      { tag: "socks-in", listen: "127.0.0.1", port: 10808, protocol: "socks", settings: { udp: true } },
      { tag: "http-in", listen: "127.0.0.1", port: 10809, protocol: "http" },
    ],
    outbounds: [{
      tag: "proxy",
      protocol: "vless",
      settings: { vnext: [{ address: domain, port: 443, users: [{ id: uuid, encryption: "none" }] }] },
      streamSettings: { network: "ws", security: "tls", tlsSettings: { serverName: domain }, wsSettings: { path, headers: { Host: domain } } },
    }, { tag: "direct", protocol: "freedom" }],
  };
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(uri.toString());
  qr.make();
  const quietZone = 4;
  const size = qr.getModuleCount() + quietZone * 2;
  const cells = [];
  for (let y = 0; y < qr.modules.length; y += 1) for (let x = 0; x < qr.modules.length; x += 1) if (qr.modules[y][x]) cells.push(`<rect x=\"${x + quietZone}\" y=\"${y + quietZone}\" width=\"1\" height=\"1\"/>`);
  const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ${size} ${size}\" shape-rendering=\"crispEdges\"><rect width=\"100%\" height=\"100%\" fill=\"#fff\"/><g fill=\"#000\">${cells.join("")}</g></svg>\n`;
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(join(outputDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(outputDir, "vless-uri.txt"), `${uri}\n`, { mode: 0o600 }),
    writeFile(join(outputDir, "vless-qr.svg"), svg, { mode: 0o600 }),
  ]);
}

function run(command, args, cwd, { input, print = true, allowFailure = false, timeoutMs = 0 } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };
    const capture = (chunk, destination) => { output += chunk; if (print) destination.write(chunk); };
    child.stdout.on("data", (chunk) => capture(chunk, process.stdout));
    child.stderr.on("data", (chunk) => capture(chunk, process.stderr));
    child.once("error", (error) => finish(rejectRun, error));
    child.once("close", (code) => {
      if (code === 0 || allowFailure) finish(resolveRun, allowFailure ? { code, output } : output);
      else finish(rejectRun, new Error(`${command} ${args.join(" ")} failed with exit code ${code}.`));
    });
    const timer = timeoutMs > 0 ? setTimeout(() => {
      child.kill("SIGTERM");
      finish(resolveRun, { code: 124, output });
    }, timeoutMs) : undefined;
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}
