#!/usr/bin/env node
// Forwards a Windows localhost port to a Porvoz container published inside
// WSL, so the Windows browser reaches the site at http://localhost:<port>.
//
// Why this exists: with WSL's mirrored networking, a listener inside the distro
// is reachable from Windows at the shared LAN address but not at 127.0.0.1.
// Browsers treat only HTTPS and localhost as secure contexts, and recording
// needs a secure context — so testing Capture from Windows needs a localhost
// address rather than the LAN one. Mirrored networking also means the WSL
// listener already holds its port in the shared namespace, so this bridge
// listens on a different local port by default.
//
// Usage:
//   node scripts/wsl-localhost-bridge.js [--port 8091] [--target-port 8090] [--target 192.168.8.200]
//
// Leave --target off to probe the addresses WSL reports and use the first that
// accepts a connection. Stop the bridge with Ctrl+C. It changes no system
// settings and needs no administrator rights.

import { execFileSync } from "node:child_process";
import net from "node:net";

const options = parseArguments(process.argv.slice(2));
const target = options.target || (await discoverWslAddress(options.targetPort));

if (!target) {
  console.error(`Could not find a WSL address answering on port ${options.targetPort}.`);
  console.error("Check that the container is running, then pass --target <address>.");
  process.exit(1);
}

const server = net.createServer((client) => {
  const upstream = net.connect(options.targetPort, target);
  client.on("error", () => upstream.destroy());
  upstream.on("error", (error) => {
    console.error(`Upstream connection failed: ${error.message}`);
    client.destroy();
  });
  client.pipe(upstream);
  upstream.pipe(client);
});

server.on("error", (error) => {
  console.error(`Could not listen on 127.0.0.1:${options.port}: ${error.message}`);
  if (error.code === "EADDRINUSE") {
    console.error("Mirrored WSL networking shares ports with Windows. Choose a local port the");
    console.error("container is not already publishing, for example --port " + (options.targetPort + 1) + ".");
  }
  process.exit(1);
});

server.listen(options.port, "127.0.0.1", () => {
  console.log(`Bridging http://localhost:${options.port} to ${target}:${options.targetPort}`);
  console.log("Leave this running while testing; press Ctrl+C to stop.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}

function parseArguments(argv) {
  const options = { port: 0, targetPort: 8090, target: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--port" || flag === "--target-port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`${flag} must be an integer from 1 through 65535.`);
        process.exit(1);
      }
      if (flag === "--port") options.port = port;
      else options.targetPort = port;
      index += 1;
    } else if (flag === "--target") {
      options.target = String(value || "").trim();
      index += 1;
    }
  }
  if (!options.port) options.port = options.targetPort + 1;
  return options;
}

async function discoverWslAddress(port) {
  let candidates = [];
  try {
    candidates = execFileSync("wsl.exe", ["-e", "hostname", "-I"], { encoding: "utf8" })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  } catch (error) {
    console.error(`Could not ask WSL for its addresses: ${error.message}`);
    return "";
  }
  for (const candidate of candidates) {
    if (await accepts(candidate, port)) return candidate;
  }
  return "";
}

function accepts(host, port) {
  return new Promise((resolve) => {
    const probe = net.connect({ host, port, timeout: 1500 });
    const finish = (result) => {
      probe.destroy();
      resolve(result);
    };
    probe.once("connect", () => finish(true));
    probe.once("timeout", () => finish(false));
    probe.once("error", () => finish(false));
  });
}
