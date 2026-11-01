#!/usr/bin/env node
// Dependency-free self-checks for the security-critical pieces.
//   node verify.js
// Covers the host policy, the packer parser, and the Worker's request guard.
// No network access: blocked-path and parser cases only.

import {
  checkProxyUrl,
  isBlockedIPv4,
  isHostAllowed,
  isSafePublicHost,
  normalizeHost,
  parseHostList,
} from "./allowlist.js";
import { isPacked, unpackDeanEdwards } from "./packer.js";
import worker from "./cloudflare-worker.js";

let failures = 0;
let checks = 0;

function ok(name, condition, detail = "") {
  checks++;
  if (condition) return;
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
console.log("normalizeHost");
eq("bracketed v6", normalizeHost("[::1]"), "::1");
eq("url form", normalizeHost("http://Example.COM.:8080/x"), "example.com");
eq("bare host", normalizeHost("TNMR.org."), "tnmr.org");
eq("empty", normalizeHost(""), "");

// ---------------------------------------------------------------------------
console.log("isBlockedIPv4");
for (const h of [
  "127.0.0.1",
  "127.9.9.9",
  "10.0.0.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "192.0.0.1",
  "169.254.169.254",
  "100.64.0.1",
  "0.0.0.0",
  "224.0.0.1",
  "999.1.1.1",
]) {
  ok(`blocked ${h}`, isBlockedIPv4(h) === true);
}
for (const h of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34"]) {
  ok(`public ${h}`, isBlockedIPv4(h) === false);
}

// ---------------------------------------------------------------------------
console.log("isSafePublicHost");
for (const h of [
  "localhost",
  "foo.localhost",
  "printer.local",
  "[::1]",
  "::ffff:127.0.0.1",
  "127.0.0.1",
  "169.254.169.254",
]) {
  ok(`refused ${h}`, isSafePublicHost(h) === false);
}
ok("pornx11.com", isSafePublicHost("pornx11.com") === true);
ok("public ip", isSafePublicHost("93.184.216.34") === true);

// ---------------------------------------------------------------------------
console.log("isHostAllowed");
ok("known host", isHostAllowed("tnmr.org") === true);
ok("known subdomain", isHostAllowed("kes002m6dp2g.tnmr.org") === true);
ok("site host", isHostAllowed("pornx11.com") === true);
ok("unknown host", isHostAllowed("evil.example") === false);
ok("v6 literal", isHostAllowed("[::1]") === false);
ok("loopback", isHostAllowed("127.0.0.1") === false);
ok("localhost", isHostAllowed("localhost") === false);
ok("extra host", isHostAllowed("cdn.example", { extraHosts: ["cdn.example"] }) === true);
ok("learned host", isHostAllowed("cdn.random.tld", { learned: ["cdn.random.tld"] }) === true);
ok("learned sibling", isHostAllowed("x.cdn.random.tld", { learned: ["cdn.random.tld"] }) === true);
ok("allowAny", isHostAllowed("evil.example", { allowAny: true }) === true);
eq("parseHostList", parseHostList("a.com, b.com  c.com").length, 3);

// ---------------------------------------------------------------------------
console.log("checkProxyUrl");
const blocked = [
  ["http://127.0.0.1:7000/manifest.json", "host_not_allowed"],
  ["http://[::1]:7000/manifest.json", "host_not_allowed"],
  ["http://localhost/x", "host_not_allowed"],
  ["http://2130706433/x", "host_not_allowed"],
  ["https://evil.example/x.m3u8", "host_not_allowed"],
  ["file:///etc/passwd", "bad_scheme"],
  ["https://user:pass@tnmr.org/x", "credentials_in_url"],
];
for (const [url, reason] of blocked) {
  const r = checkProxyUrl(url);
  eq(`refuse ${url}`, r.ok, false);
  eq(`reason ${url}`, r.reason, reason);
}
const allowedUrl = checkProxyUrl("https://kes002m6dp2g.tnmr.org/hls2/x/master.m3u8?t=1");
ok("allow real cdn", allowedUrl.ok === true);
eq("allow real cdn host", allowedUrl.host, "kes002m6dp2g.tnmr.org");

// ---------------------------------------------------------------------------
console.log("packer");
const packed =
  "eval(function(p,a,c,k,e,d){e=function(c){return c};}('0 1',2,2,'hello|world'.split('|'),0,{}))";
ok("detects packed", isPacked(packed) === true);
eq("unpacks", unpackDeanEdwards(packed), "hello world");
eq(
  "keeps $ literal in words",
  unpackDeanEdwards("eval(function(p,a,c,k,e,d){}('0',2,1,'a$&b'.split('|'),0,{}))"),
  "a$&b"
);
eq("ignores plain script", unpackDeanEdwards("var x = 1;"), null);
eq("ignores broken pack", unpackDeanEdwards("eval(function(p,a,c,k,e,d){}('x')"), null);

// ---------------------------------------------------------------------------
console.log("worker guard");
const w = (path, env = {}) => worker.fetch(new Request(`https://worker.example${path}`), env);

{
  const r = await w(`/hls.ts?url=${encodeURIComponent("http://[::1]:7000/manifest.json")}`);
  eq("worker blocks [::1]", r.status, 403);
  eq("worker reason", (await r.json()).reason, "host_not_allowed");
}
{
  const r = await w(`/hls.ts?url=${encodeURIComponent("http://127.0.0.1:7000/")}`);
  eq("worker blocks loopback", r.status, 403);
}
{
  const r = await w(`/hls.ts?url=${encodeURIComponent("https://evil.example/x.ts")}`);
  eq("worker blocks unknown host", r.status, 403);
}
{
  const r = await w(`/hls.ts`);
  eq("worker requires url", r.status, 400);
}
{
  const r = await w(`/hls.ts?url=${encodeURIComponent("https://evil.example/x.ts")}`, {
    PROXY_ALLOW_ANY: "1",
  });
  ok("worker escape hatch skips policy", r.status !== 403, `status ${r.status}`);
}
{
  const r = await worker.fetch(
    new Request("https://worker.example/x", { method: "OPTIONS" }),
    {}
  );
  eq("worker preflight", r.status, 204);
}
{
  const r = await w("/healthz");
  eq("worker healthz", r.status, 200);
  eq("worker healthz ok", (await r.json()).ok, true);
}

// ---------------------------------------------------------------------------
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exitCode = 1;
}
