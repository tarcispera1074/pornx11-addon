// Cloudflare Worker: resolves the embed fresh (so the signed token matches the
// worker's IP) and relays HLS playlists/segments with the right Referer.
//
// Deploy:  npx wrangler deploy
// Vars:    ALLOWED_EXTRA_HOSTS="cdn.example.com,other.example"
//          PROXY_ALLOW_ANY="1"   (disables the host allowlist — trusted use only)
//
// Caching:
//   * media pieces (segments, keys) go into Cloudflare's edge cache under a key
//     with the volatile token/timestamp params stripped, so the same piece is
//     reused across token refreshes and repeat/backward seeks are edge hits.
//   * the embed -> master lookup is memoised in memory for a couple of minutes so
//     repeated playlist requests are instant and return an identical playlist.
//   * playlists themselves are never cached: they carry per-request tokens.

import {
  checkProxyUrl,
  isSafePublicHost,
  parseHostList,
  normalizeHost,
} from "./allowlist.js";
import { isPacked, unpackDeanEdwards } from "./packer.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/** Edge cache lifetime for media pieces. Tokens live ~8h; an hour is conservative. */
const MEDIA_CACHE_TTL = 60 * 60;
/** Refuse to cache single pieces larger than this (bytes). */
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
/** How long a resolved embed -> master URL is reused. */
const RESOLVE_TTL_MS = 120_000;

// Per-isolate memory of hosts that real playlists/embeds pointed at.
const learnedHosts = new Set();
const MAX_LEARNED = 100;

// Per-isolate memo of embed -> fresh master URL.
const resolveCache = new Map();
const MAX_RESOLVES = 200;

function learnHost(rawHost) {
  const h = normalizeHost(rawHost);
  if (!h || h.includes(":")) return;
  if (learnedHosts.size >= MAX_LEARNED) return;
  learnedHosts.add(h);
  const parts = h.split(".");
  if (parts.length > 2) learnedHosts.add(parts.slice(-2).join("."));
}

function policy(env) {
  return {
    allowAny: env?.PROXY_ALLOW_ANY === "1",
    extraHosts: parseHostList(env?.ALLOWED_EXTRA_HOSTS || ""),
    learned: learnedHosts,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, "Cache-Control": "no-store" },
  });
}

/** Rewrite every media line (and URI= attribute) through this worker. */
function rewritePlaylist(text, baseUrl, referer, origin) {
  const link = (abs) => {
    let ext = ".ts";
    if (abs.includes(".m3u8")) ext = ".m3u8";
    else if (abs.includes(".key")) ext = ".key";
    return `${origin}/hls${ext}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}`;
  };

  const rewriteOne = (raw) => {
    try {
      return link(new URL(raw, baseUrl).href);
    } catch {
      return raw;
    }
  };

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        if (!/URI="/i.test(trimmed)) return line;
        return trimmed.replace(/URI="([^"]+)"/gi, (_, p1) => `URI="${rewriteOne(p1)}"`);
      }
      return rewriteOne(trimmed);
    })
    .join("\n");
}

function learnPlaylistHosts(text, baseUrl) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    try {
      learnHost(new URL(trimmed, baseUrl).hostname);
    } catch {}
  }
}

/** Resolve an embed page to a fresh master URL. */
async function resolveFromEmbed(embedUrl) {
  const er = await fetch(embedUrl, {
    headers: {
      "User-Agent": UA,
      Referer: "https://pornx11.com/",
      Accept: "text/html,*/*",
    },
    redirect: "follow",
  });
  const html = await er.text();
  let unpacked = "";
  let packedSeen = 0;

  // Only the packed blocks matter; unpack them without evaluating anything.
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let s;
  while ((s = scriptRe.exec(html))) {
    const body = s[1];
    if (!isPacked(body)) continue;
    packedSeen++;
    const out = unpackDeanEdwards(body);
    if (out) unpacked += "\n" + out;
  }

  const full = html + unpacked;
  const m =
    full.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i) ||
    full.match(/file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);

  return {
    masterUrl: m ? m[1].replace(/\\\//g, "/") : null,
    htmlLength: html.length,
    packedSeen,
    unpackedLength: unpacked.length,
  };
}

function getResolve(embedUrl) {
  const hit = resolveCache.get(embedUrl);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    resolveCache.delete(embedUrl);
    return null;
  }
  return hit.url;
}

function setResolve(embedUrl, url) {
  if (resolveCache.size >= MAX_RESOLVES) {
    resolveCache.delete(resolveCache.keys().next().value);
  }
  resolveCache.set(embedUrl, { url, expires: Date.now() + RESOLVE_TTL_MS });
}

/** Edge cache key: the media URL with volatile token/timestamp params removed. */
function cacheKeyFor(target) {
  try {
    const u = new URL(target);
    for (const p of ["t", "s", "e"]) u.searchParams.delete(p);
    return new Request(u.toString(), { method: "GET" });
  } catch {
    return new Request(target, { method: "GET" });
  }
}

function cacheStore() {
  return typeof caches !== "undefined" && caches?.default ? caches.default : null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/healthz") {
      return json({
        ok: true,
        role: "worker",
        knownHosts: learnedHosts.size,
        allowAny: env?.PROXY_ALLOW_ANY === "1",
        edgeCache: Boolean(cacheStore()),
        resolvedMemo: resolveCache.size,
      });
    }

    // -----------------------------------------------------------------------
    // 1. STREAM RESOLVER: /stream.m3u8?embed=...  (fresh token per play)
    // -----------------------------------------------------------------------
    if (url.pathname.startsWith("/stream") || url.pathname.includes("master.m3u8")) {
      const embedUrl = url.searchParams.get("embed") || url.searchParams.get("referer");
      let directTarget = url.searchParams.get("url");

      if (directTarget) {
        const check = checkProxyUrl(directTarget, policy(env));
        if (!check.ok) {
          return json({ error: "Target host not allowed", reason: check.reason }, 403);
        }
        directTarget = check.url.toString();
      }

      let masterUrl = directTarget;
      let debug = {};

      if (embedUrl) {
        if (!isSafePublicHost(embedUrl)) {
          return json({ error: "Embed host not allowed" }, 403);
        }

        const memo = getResolve(embedUrl);
        if (memo) {
          masterUrl = memo;
          debug = { resolvedFrom: "memo" };
        } else {
          try {
            const r = await resolveFromEmbed(embedUrl);
            debug = {
              htmlLength: r.htmlLength,
              packedSeen: r.packedSeen,
              unpackedLength: r.unpackedLength,
            };
            if (r.masterUrl && isSafePublicHost(r.masterUrl)) {
              masterUrl = r.masterUrl;
              learnHost(masterUrl);
              setResolve(embedUrl, masterUrl);
            }
          } catch (err) {
            debug = { resolveError: err.message };
          }
        }
      }

      if (!masterUrl) {
        return json({ error: "No video found", embedUrl, ...debug }, 404);
      }

      try {
        const mr = await fetch(masterUrl, {
          headers: {
            "User-Agent": UA,
            Referer: embedUrl || "https://luluvido.com/",
            Accept: "*/*",
          },
          redirect: "follow",
        });
        if (!mr.ok) {
          return json({ error: "Upstream error", status: mr.status }, 502);
        }
        const masterText = await mr.text();
        learnPlaylistHosts(masterText, masterUrl);

        return new Response(rewritePlaylist(masterText, masterUrl, embedUrl || "", url.origin), {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            ...CORS,
            "Cache-Control": "no-store",
          },
        });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // -----------------------------------------------------------------------
    // 2. PLAYLIST / SEGMENT / KEY PROXY: /hls.m3u8, /hls.ts, /hls.key
    // -----------------------------------------------------------------------
    const targetUrl = url.searchParams.get("url");
    const referer = url.searchParams.get("referer") || "https://luluvido.com/";

    if (!targetUrl) return json({ error: "Missing target url" }, 400);

    const check = checkProxyUrl(targetUrl, policy(env));
    if (!check.ok) {
      return json({ error: "Host not allowed", reason: check.reason, host: check.host }, 403);
    }
    const target = check.url.toString();

    const isM3u8Target = /\.m3u8(\?|$)/i.test(target);
    const rangeHeader = request.headers.get("Range");
    const cache = cacheStore();
    // Whole-file GETs only: a 206 would poison the entry with a slice.
    const cacheable = Boolean(cache) && !isM3u8Target && !rangeHeader && request.method === "GET";
    const cacheKeyReq = cacheable ? cacheKeyFor(target) : null;

    if (cacheable) {
      try {
        const hit = await cache.match(cacheKeyReq);
        if (hit) return hit;
      } catch {}
    }

    const upstreamHeaders = new Headers();
    upstreamHeaders.set("User-Agent", UA);
    upstreamHeaders.set("Referer", referer);
    upstreamHeaders.set("Accept", "*/*");
    if (rangeHeader) upstreamHeaders.set("Range", rangeHeader);

    try {
      const response = await fetch(target, {
        method: request.method,
        headers: upstreamHeaders,
        redirect: "follow",
      });

      const responseHeaders = new Headers(response.headers);
      for (const [k, v] of Object.entries(CORS)) responseHeaders.set(k, v);

      const isM3u8 =
        isM3u8Target || (response.headers.get("content-type") || "").includes("mpegurl");

      if (isM3u8) {
        if (!response.ok) {
          return json({ error: "Upstream error", status: response.status }, 502);
        }
        const text = await response.text();
        learnPlaylistHosts(text, target);
        responseHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
        responseHeaders.set("Cache-Control", "no-store");
        return new Response(rewritePlaylist(text, target, referer, url.origin), {
          status: 200,
          headers: responseHeaders,
        });
      }

      if (!response.ok && response.status !== 206) {
        return json({ error: "Upstream error", status: response.status }, 502);
      }

      // Whole media piece: answer at once and fill the edge cache behind the
      // scenes, so the slow origin fetch only happens once per piece.
      if (cacheable && response.ok && response.status === 200) {
        const len = Number(response.headers.get("content-length") || 0);
        if (len === 0 || len <= MAX_CACHE_BYTES) {
          const cacheHeaders = new Headers(responseHeaders);
          cacheHeaders.set("Cache-Control", `public, max-age=${MEDIA_CACHE_TTL}, immutable`);
          cacheHeaders.delete("set-cookie");
          cacheHeaders.delete("vary");

          const body = response.clone().body;
          if (body) {
            const forCache = new Response(body, { status: 200, headers: cacheHeaders });
            const put = cache.put(cacheKeyReq, forCache).catch(() => {});
            if (ctx?.waitUntil) ctx.waitUntil(put);
          }
          responseHeaders.set("Cache-Control", `public, max-age=${MEDIA_CACHE_TTL}, immutable`);
        }
      }

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (err) {
      return json({ error: err.message }, 502);
    }
  },
};
