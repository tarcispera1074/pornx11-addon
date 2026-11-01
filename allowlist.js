// Shared host policy for the media proxy.
// Imported by server.js (Node) and cloudflare-worker.js (bundled by wrangler).
//
// Goals:
//   1. no loopback / private / link-local / metadata targets (SSRF)
//   2. no IPv6-literal bypass ("[::1]" must not slip past a "::1" comparison)
//   3. no open relay: only hosts we expect to (or have legitimately seen) serve media
//
// Escape hatch: PROXY_ALLOW_ANY=1 disables rules 1 and 3 for fully trusted,
// private deployments. It is deliberately awkward to enable.

/** Domains the addon is expected to stream from (suffix match, subdomains included). */
export const DEFAULT_ALLOWED_HOSTS = [
  "pornx11.com",
  // stream CDN used by the luluvido embed family
  "tnmr.org",
  // hosters + embeds the addon knows how to resolve
  "luluvido.com",
  "luluvid.com",
  "lulustream.com",
  "lulustream.to",
  "streamtape.com",
  "streamtape.to",
  "ds2play.com",
  "ds2video.com",
  "playmogo.com",
  "dood.wf",
  "dood.so",
  "dood.la",
  "dood.cx",
  "dood.sh",
  "dood.ws",
  "vidhide.com",
  "vidhidepro.com",
  "vidhidevip.com",
  "streamwish.com",
  "streamwish.to",
  "swdyu.com",
  "sfastwish.com",
  "mixdrop.co",
  "mixdrop.to",
  "mixdrop.sx",
  "mixdrop.bz",
  "mixdrop.ag",
  "voe.sx",
  "voe-unblock.com",
  "filemoon.sx",
  "filemoon.to",
  "filemoon.in",
  "filemoon.eu",
  "vidoza.net",
  "vidoza.org",
  "mp4upload.com",
  "player4me.com",
  "streamcrypt.net",
  "streamhg.com",
  "emturbovid.com",
  "upstream.to",
  "streamhub.to",
  "abyss.to",
  "cloudemb.com",
  "watchsb.com",
  "streamsb.com",
];

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Normalise anything host-ish into a bare lowercase hostname.
 * Accepts a URL or a bare host, strips IPv6 brackets and trailing dots.
 */
export function normalizeHost(raw) {
  if (raw == null) return "";
  let value = String(raw).trim().toLowerCase();
  if (!value) return "";
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch {
      return "";
    }
  }
  if (value.startsWith("[")) value = value.slice(1);
  if (value.endsWith("]")) value = value.slice(0, -1);
  while (value.endsWith(".")) value = value.slice(0, -1);
  return value;
}

/** True for IPv4 literals in any reserved / private / loopback range. */
export function isBlockedIPv4(host) {
  const m = IPV4_RE.exec(host);
  if (!m) return false;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((n) => n > 255)) return true; // malformed: refuse to guess
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return true; // this-network / private / loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && (b === 168 || b === 0)) return true; // private / IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/**
 * "Would fetching this host be safe at all?" — used for scraping targets that
 * are not media hosts (article pages, hoster embeds). No allowlist required.
 */
export function isSafePublicHost(raw) {
  const h = normalizeHost(raw);
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return false;
  if (h.includes(":")) return false; // every IPv6 literal, incl. ::ffff:127.0.0.1
  if (isBlockedIPv4(h)) return false;
  return true;
}

/** Comma/space separated env list -> array of normalised hosts. */
export function parseHostList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,\s]+/)
    .map((s) => normalizeHost(s))
    .filter(Boolean);
}

function matchesSuffix(host, domains) {
  for (const d of domains) {
    if (!d) continue;
    if (host === d || host.endsWith("." + d)) return true;
  }
  return false;
}

/**
 * Media-proxy policy.
 * @param {string} raw host or URL
 * @param {{allowAny?: boolean, extraHosts?: string[], learned?: Iterable<string>}} opts
 */
export function isHostAllowed(raw, opts = {}) {
  const h = normalizeHost(raw);
  if (!h) return false;
  if (opts.allowAny) return true;
  if (!isSafePublicHost(h)) return false;

  const domains = DEFAULT_ALLOWED_HOSTS;
  if (matchesSuffix(h, domains)) return true;

  const extra = opts.extraHosts || [];
  if (extra.length && matchesSuffix(h, extra)) return true;

  if (opts.learned) {
    for (const learned of opts.learned) {
      if (learned && (h === learned || h.endsWith("." + learned))) return true;
    }
  }
  return false;
}

/**
 * Validate a proxy target end to end.
 * @returns {{ok: true, url: URL, host: string} | {ok: false, reason: string, host?: string}}
 */
export function checkProxyUrl(rawUrl, opts = {}) {
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: "bad_url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "bad_scheme" };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "credentials_in_url" };
  }
  const host = normalizeHost(u.hostname);
  if (!isHostAllowed(host, opts)) {
    return { ok: false, reason: "host_not_allowed", host };
  }
  return { ok: true, url: u, host };
}
