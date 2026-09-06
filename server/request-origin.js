// The browser decides whether a page is a secure context from the origin it
// typed, not from the socket the server sees. A container publishing its port
// to the host is reached as http://localhost even though the connection
// arrives from the Docker bridge, so every decision here reads the Host header
// and only consults forwarded headers from explicitly trusted proxies.

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function parseTrustedProxies(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseTrustedProxyEntry)
    .filter(Boolean);
}

export function getRequestOrigin(request, trustedProxies = []) {
  const remoteAddress = normalizeAddress(request.socket?.remoteAddress || "");
  const trusted = isTrustedProxy(remoteAddress, trustedProxies);
  const forwardedProtocol = trusted ? firstToken(request.headers["x-forwarded-proto"]) : "";
  const forwardedHost = trusted ? firstToken(request.headers["x-forwarded-host"]) : "";
  const protocol = request.socket?.encrypted
    ? "https"
    : forwardedProtocol === "https" ? "https" : "http";
  const hostname = parseHostname(forwardedHost || request.headers.host || "");
  const loopback = LOOPBACK_HOSTNAMES.has(hostname);
  return {
    protocol,
    hostname,
    remoteAddress,
    // Who to hold responsible for this request. Behind a trusted proxy every
    // connection shares one socket address, so the forwarded client address is
    // what keeps one visitor's failures from counting against everyone else.
    clientAddress: (trusted && firstToken(request.headers["x-forwarded-for"])) || remoteAddress,
    trustedProxy: trusted,
    // Matches the browser's own rule: HTTPS, or a loopback host name.
    secureContext: protocol === "https" || loopback,
    loopback
  };
}

export function isTrustedProxy(address, trustedProxies = []) {
  if (!address) return false;
  return trustedProxies.some((entry) => entry.matches(address));
}

function parseTrustedProxyEntry(value) {
  if (value === "loopback") {
    return { matches: (address) => address === "127.0.0.1" || address === "::1" };
  }
  const [candidate, prefixLength] = value.split("/");
  const network = parseIpv4(candidate);
  if (network !== null && prefixLength !== undefined) {
    const bits = Number(prefixLength);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
    // Shifting by 32 is a no-op in JavaScript, so build the mask from a 64-bit
    // value and coerce back into the unsigned 32-bit space the addresses use.
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return {
      matches: (address) => {
        const value = parseIpv4(address);
        return value !== null && (value & mask) >>> 0 === (network & mask) >>> 0;
      }
    };
  }
  if (prefixLength !== undefined) return null;
  const normalized = normalizeAddress(candidate);
  if (!normalized) return null;
  return { matches: (address) => address === normalized };
}

function parseIpv4(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result;
}

function normalizeAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  // Node reports IPv4 connections on a dual-stack listener as ::ffff:127.0.0.1.
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function parseHostname(value) {
  const host = String(value || "").trim().toLowerCase();
  if (!host) return "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end < 0 ? host : host.slice(1, end);
  }
  const colon = host.indexOf(":");
  return colon < 0 ? host : host.slice(0, colon);
}

function firstToken(value) {
  const header = Array.isArray(value) ? value[0] : value;
  return String(header || "").split(",")[0].trim().toLowerCase();
}
