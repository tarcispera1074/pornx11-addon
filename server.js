// PornX11 — Stremio/Nuvio addon
//
// Catalog comes from pornx11.com's WordPress REST API; streams are resolved by
// scraping the article page and any embedded hoster, then relayed through the
// /proxy endpoint with the Referer the CDN expects.

import http from "node:http";
import { URL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { load } from "cheerio";
import {
  checkProxyUrl,
  isSafePublicHost,
  parseHostList,
  normalizeHost,
} from "./allowlist.js";
import { isPacked, unpackDeanEdwards } from "./packer.js";

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "package.json"), "utf8")
);

const PORT = Number(process.env.PORT || 7000);
const BASE_URL = "https://pornx11.com";
const BASE_HOST = "pornx11.com";
const SITE_TAG = "pornx11";

const SITE_TIMEOUT_MS = Number(process.env.SITE_TIMEOUT_MS || 15000);
const CATALOG_TTL_MS = Number(process.env.CATALOG_TTL_MINUTES || 5) * 60_000;
const STREAM_TTL_MS = Number(process.env.STREAM_TTL_MS || 60_000);
const PER_PAGE = 25;

/** The r.jina.ai fallback sends the target URL to a third party. Disable with DISABLE_JINA_FALLBACK=1. */
const JINA_ENABLED = process.env.DISABLE_JINA_FALLBACK !== "1";
const DEBUG_TOKEN = process.env.DEBUG_TOKEN || "";
const PROXY_ALLOW_ANY = process.env.PROXY_ALLOW_ANY === "1";
const EXTRA_ALLOWED_HOSTS = parseHostList(process.env.ALLOWED_EXTRA_HOSTS || "");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const POSTER_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#1a1a1a"/><text x="50%" y="50%" fill="#666" font-family="sans-serif" font-size="28" text-anchor="middle">PX11</text></svg>`
  );

// ---------------------------------------------------------------------------
// LOGGING — every empty result carries a reason code so failures are visible
// ---------------------------------------------------------------------------
function log(scope, message) {
  console.log(`[${scope}] ${message}`);
}

// ---------------------------------------------------------------------------
// HOST POLICY STATE
// ---------------------------------------------------------------------------
const learnedHosts = new Set();
const MAX_LEARNED = 200;

function learnHost(rawHost) {
  const h = normalizeHost(rawHost);
  if (!h || h.includes(":")) return;
  if (learnedHosts.size >= MAX_LEARNED) return;
  learnedHosts.add(h);
  const parts = h.split(".");
  if (parts.length > 2) learnedHosts.add(parts.slice(-2).join("."));
}

function proxyOptions() {
  return {
    allowAny: PROXY_ALLOW_ANY,
    extraHosts: EXTRA_ALLOWED_HOSTS,
    learned: learnedHosts,
  };
}

// ---------------------------------------------------------------------------
// CATEGORIES (alphabetical)
// ---------------------------------------------------------------------------
const CATEGORIES = [
  // 1. Broad Formats & Languages
  { id: 15093, name: "Aagmaal.Com", slug: "aagmaal-com" },
  { id: 91, name: "Bengali Hot Short Film", slug: "bengali-hot-short-film" },
  { id: 19, name: "Filipino", slug: "filipino" },
  { id: 20, name: "Filipino Vivamax", slug: "filipino-vivamax" },
  { id: 1, name: "Hindi Hot Web Series", slug: "hindi-hot-web-series" },
  { id: 71, name: "Hindi Short Films", slug: "hindi-short-films" },
  { id: 70, name: "Hot Web Series", slug: "hot-web-series" },
  { id: 873, name: "Indian Hot Web Series", slug: "indian-hot-web-series" },
  { id: 90, name: "Uncut Hot Web Series", slug: "uncut-hot-web-series" },
  { id: 15135, name: "Wowmasti.Com", slug: "wowmasti-com" },

  // 2. Major OTT Networks & Studios
  { id: 85, name: "11Upmovies", slug: "11upmovies" },
  { id: 84, name: "ALTBalaji", slug: "altbalaji" },
  { id: 14709, name: "Atrangii", slug: "atrangii" },
  { id: 708, name: "Balloons", slug: "balloons" },
  { id: 53, name: "BigMoviezoo", slug: "bigmoviezoo" },
  { id: 62, name: "BindasTimes", slug: "bindastimes" },
  { id: 4, name: "BoomMovies", slug: "boommovies" },
  { id: 18, name: "CinePrime", slug: "cineprime" },
  { id: 678, name: "Digi Movieplex", slug: "digimovieplex" },
  { id: 17, name: "FeneoMovies", slug: "feneomovies" },
  { id: 81, name: "Fliz Movies", slug: "fliz-movies" },
  { id: 76, name: "GupChup", slug: "gupchup" },
  { id: 14, name: "HalKut", slug: "halkut-app" },
  { id: 89, name: "Hootzy", slug: "hootzy" },
  { id: 46, name: "HotMasti", slug: "hotmasti" },
  { id: 33, name: "Hotshots", slug: "hotshots" },
  { id: 6, name: "HotX", slug: "hotx-originals" },
  { id: 54, name: "HotXcreator", slug: "hotxcreator" },
  { id: 14658, name: "Hulchul", slug: "hulchul" },
  { id: 14710, name: "Hunters", slug: "hunters" },
  { id: 44, name: "IndianXworld", slug: "indianxworld" },
  { id: 80, name: "Kooku", slug: "kooku" },
  { id: 4588, name: "MoodX", slug: "moodx" },
  { id: 4587, name: "NeonX", slug: "neonx" },
  { id: 5, name: "NiFlix", slug: "niflix-originals" },
  { id: 12, name: "NiksIndian", slug: "niksindian" },
  { id: 73, name: "Nuefliks App", slug: "nuefliks-app" },
  { id: 4586, name: "PrimePlay", slug: "primeplay" },
  { id: 7, name: "PrimeShots", slug: "primeshots" },
  { id: 9, name: "Rabbit Movies", slug: "rabbit-movies" },
  { id: 78, name: "Ullu app", slug: "ullu-app" },
  { id: 86, name: "Uncut Adda", slug: "uncut-adda" },
  { id: 942, name: "Voovi Originals", slug: "voovi-originals" },
  { id: 15, name: "Woow", slug: "woow-originals" },
  { id: 45, name: "XPrime", slug: "xprime" },
  { id: 41, name: "Xtramood", slug: "xtramood" },

  // 3. Medium OTT Networks & Studios
  { id: 11, name: "AppleFlix", slug: "appleflix-originals" },
  { id: 83, name: "Banana Prime", slug: "banana-prime" },
  { id: 13965, name: "Besharams", slug: "besharams" },
  { id: 67, name: "ChikooFlix", slug: "chikooflix" },
  { id: 30, name: "Cine7", slug: "cine7" },
  { id: 82, name: "CinemaDosti", slug: "cinemadosti" },
  { id: 39, name: "CrabFlix", slug: "crabflix" },
  { id: 40, name: "DreamsFilms", slug: "dreamsfilms" },
  { id: 16, name: "Feelit", slug: "feelit" },
  { id: 730, name: "FilmyMurga", slug: "filmymurga" },
  { id: 14941, name: "FugiApp", slug: "fugiapp" },
  { id: 21, name: "GoldFlix", slug: "goldflix" },
  { id: 679, name: "GoodFlix Movies", slug: "goodflix-movies" },
  { id: 26, name: "HokYo", slug: "hokyo" },
  { id: 23, name: "HotMirchi", slug: "hotmirchi" },
  { id: 27, name: "HotMX", slug: "hotmx" },
  { id: 38, name: "HotSite", slug: "hotsite" },
  { id: 3, name: "HottyNaughty", slug: "hotty-naughty-originals" },
  { id: 59, name: "iEntertainment", slug: "ientertainment" },
  { id: 43, name: "KantiShah", slug: "kantishah" },
  { id: 64, name: "Kindibox", slug: "kindibox" },
  { id: 61, name: "MangoFlix", slug: "mangoflix" },
  { id: 47, name: "MojFlix", slug: "mojflix" },
  { id: 35, name: "OnlyFans", slug: "onlyfans" },
  { id: 32, name: "PrimeFlix", slug: "primeflix" },
  { id: 31, name: "Rangeen", slug: "rangeen" },
  { id: 49, name: "StreamEx", slug: "streamex" },
  { id: 87, name: "TopTenXXX", slug: "toptenxxx" },
  { id: 4590, name: "Triflicks", slug: "triflicks" },

  // 4. Niche & Smaller Studios
  { id: 42, name: "Desi Originals", slug: "desi-originals" },
  { id: 37, name: "Eortv", slug: "eortv" },
  { id: 56, name: "FaaduCinema", slug: "faaducinema" },
  { id: 24, name: "GoldenFans", slug: "goldenfans" },
  { id: 66, name: "GulluGullu", slug: "gullugullu" },
  { id: 29, name: "HorsePrime", slug: "horseprime" },
  { id: 88, name: "Hot Live", slug: "hot-live" },
  { id: 15432, name: "HotS", slug: "hots" },
  { id: 52, name: "HotVolt", slug: "hotvolt" },
  { id: 36, name: "InssaClub", slug: "inssaclub" },
  { id: 34, name: "Jollu", slug: "jollu" },
  { id: 25, name: "KancchaLannka", slug: "kancchalannka" },
  { id: 50, name: "Khirki", slug: "khirki" },
  { id: 8, name: "Kilukilluppu", slug: "kilukilluppu" },
  { id: 55, name: "MastiMovies", slug: "mastimovies" },
  { id: 13, name: "Mithoo", slug: "mithoo" },
  { id: 4589, name: "MoodFlix", slug: "moodflix" },
  { id: 22, name: "MyStudio07", slug: "mystudio07" },
  { id: 79, name: "NetPrime", slug: "netprime" },
  { id: 51, name: "NightCinema", slug: "nightcinema" },
  { id: 28, name: "NightShow", slug: "nightshow" },
  { id: 75, name: "NuefliksMovies", slug: "nuefliksmovies" },
  // was a duplicate of nuefliksmovies, which made one studio resolve to the other's catalog
  { id: 74, name: "Nuefliksplus", slug: "nuefliksplus" },
  { id: 68, name: "RDXMovies", slug: "rdxmovies" },
  { id: 65, name: "RedPrime", slug: "redprime" },
  { id: 77, name: "Solo Video", slug: "solo-video" },
  { id: 10, name: "Sudipa", slug: "sudipa-originals" },
  { id: 57, name: "ZoopTv", slug: "zooptv" },
];

const CAT_LOOKUP = new Map();
for (const c of CATEGORIES) {
  CAT_LOOKUP.set(String(c.id), c.id);
  CAT_LOOKUP.set(c.name.toLowerCase(), c.id);
  CAT_LOOKUP.set(c.slug.toLowerCase(), c.id);
  CAT_LOOKUP.set(c.slug.toLowerCase().replace(/-/g, " "), c.id);
  CAT_LOOKUP.set(c.slug.toLowerCase().replace(/-/g, "_"), c.id);
}

function resolveCategoryId(str) {
  if (str == null || str === "") return null;
  let decoded;
  try {
    decoded = decodeURIComponent(String(str)).toLowerCase().trim();
  } catch {
    decoded = String(str).toLowerCase().trim();
  }
  if (CAT_LOOKUP.has(decoded)) return CAT_LOOKUP.get(decoded);
  const stripped = decoded.replace(new RegExp(`^${SITE_TAG}[_-]`), "");
  if (CAT_LOOKUP.has(stripped)) return CAT_LOOKUP.get(stripped);
  return null;
}

const GENRE_OPTIONS = [...new Set(CATEGORIES.map((c) => c.name))].sort((a, b) =>
  a.localeCompare(b)
);

// ---------------------------------------------------------------------------
// MANIFEST
// ---------------------------------------------------------------------------
const manifest = {
  id: "com.pornx11.addon",
  // read from package.json so the two can never drift apart again
  version: pkg.version,
  name: "PornX11",
  description: "Latest releases from pornx11.com — 100+ OTT networks & studios",
  logo: POSTER_FALLBACK,
  resources: ["catalog", "meta", "stream"],
  // the site only publishes films/short films; "series" was advertised with no catalog behind it
  types: ["movie"],
  idPrefixes: [`${SITE_TAG}:`],
  catalogs: [
    {
      type: "movie",
      id: `${SITE_TAG}_latest`,
      name: "Latest",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false, options: GENRE_OPTIONS },
        { name: "skip", isRequired: false },
      ],
    },
  ],
  behaviorHints: { configurable: false },
};

// ---------------------------------------------------------------------------
// CACHE
// ---------------------------------------------------------------------------
const pageCache = new Map(); // pageUrl -> {html, expires}
const metaCache = new Map(); // id -> {meta, expires}
const streamCache = new Map(); // pageUrl -> {videoUrl, referer, expires}
const catalogCache = new Map(); // catKey -> {metas, expires}

function cacheGet(map, key) {
  const e = map.get(key);
  if (!e) return null;
  if (e.expires < Date.now()) {
    map.delete(key);
    return null;
  }
  return e;
}

function cacheSet(map, key, val, ttl) {
  map.set(key, { ...val, expires: Date.now() + ttl });
  if (map.size > 2000) map.delete(map.keys().next().value);
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
};

function sendJson(req, res, status, data, extraHeaders = {}) {
  if (res.headersSent) return res.end();
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
    "cache-control": extraHeaders["cache-control"] || "max-age=600, stale-while-revalidate=1200",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

function stripTags(s) {
  return (s || "").replace(/<[^>]*>/g, "").trim();
}

function norm(t) {
  try {
    return load(`<div>${t || ""}</div>`)("div").text().replace(/\s+/g, " ").trim();
  } catch {
    return stripTags(t);
  }
}

function getProxyBase(req) {
  if (process.env.CF_WORKER_URL) {
    return process.env.CF_WORKER_URL.replace(/\/+$/, "");
  }
  const proto = req.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || "http";
  const host =
    req.headers["x-forwarded-host"]?.split(",")[0]?.trim() ||
    req.headers.host ||
    `localhost:${PORT}`;
  return `${proto}://${host}`;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = SITE_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function extractPageUrl(rawId) {
  let s = String(rawId || "");
  try {
    s = decodeURIComponent(s);
  } catch {}
  s = s.replace(/:\d+:\d+$/, "");
  s = s.replace(new RegExp(`^${SITE_TAG}:`), "");
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch {}
  }
  return s.trim();
}

/** Article URLs must live on the site itself — otherwise a stream id could point the scraper anywhere. */
function normalizeSitePageUrl(pageUrl) {
  let u;
  try {
    u = new URL(pageUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = normalizeHost(u.hostname);
  if (host !== BASE_HOST && !host.endsWith("." + BASE_HOST)) return null;
  u.protocol = "https:";
  return u.toString();
}

// ---------------------------------------------------------------------------
// WORDPRESS REST API — CATALOG
// ---------------------------------------------------------------------------
/** Fetch one WP page of posts. Returns { posts, reason }. */
async function fetchPostsPage({ page, search, catId }) {
  const url = new URL(`${BASE_URL}/wp-json/wp/v2/posts`);
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("_embed", "wp:featuredmedia");
  url.searchParams.set("_fields", "id,title,link,excerpt,_links,_embedded");
  if (catId) url.searchParams.set("categories", String(catId));
  if (search) url.searchParams.set("search", search);

  let reason = "direct_failed";
  try {
    const r = await fetchWithTimeout(url.href, {
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (r.ok) {
      const posts = await r.json();
      if (Array.isArray(posts)) return { posts, reason: "direct_ok" };
      reason = "unexpected_payload";
    } else {
      reason = `direct_http_${r.status}`;
    }
  } catch (e) {
    reason = `direct_error_${e.name || "unknown"}`;
  }

  if (!JINA_ENABLED) return { posts: null, reason: `${reason}+jina_disabled` };

  // Fallback: third-party reader proxy (leaks the URL to r.jina.ai).
  log("CATALOG", `${reason} — falling back to r.jina.ai`);
  try {
    const pr = await fetchWithTimeout(`https://r.jina.ai/${url.href}`);
    if (pr.ok) {
      const text = await pr.text();
      const m = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (m) {
        const posts = JSON.parse(m[0]);
        if (Array.isArray(posts)) return { posts, reason: "jina_ok" };
      }
      reason = `${reason}+jina_unparseable`;
    } else {
      reason = `${reason}+jina_http_${pr.status}`;
    }
  } catch (e) {
    reason = `${reason}+jina_error_${e.name || "unknown"}`;
  }
  return { posts: null, reason };
}

function postToMeta(p, type) {
  const featured = p._embedded?.["wp:featuredmedia"]?.[0];
  const poster =
    featured?.source_url ||
    featured?.media_details?.sizes?.medium_large?.source_url ||
    featured?.media_details?.sizes?.large?.source_url ||
    featured?.media_details?.sizes?.full?.source_url ||
    POSTER_FALLBACK;

  const title = norm(p.title?.rendered || "");
  const link = p.link || "";
  const id = `${SITE_TAG}:${encodeURIComponent(link)}`;

  const meta = {
    id,
    type,
    name: title,
    poster,
    background: poster,
    description: norm(p.excerpt?.rendered || ""),
    website: link,
  };
  cacheSet(metaCache, id, { meta }, CATALOG_TTL_MS);
  return meta;
}

async function fetchCatalog({ skip = 0, search = "", type = "movie", genre = "", category = "" }) {
  const resolvedCatId = resolveCategoryId(category) ?? resolveCategoryId(genre);
  const catKey = `${type}_${resolvedCatId || "all"}_${skip}_${search}`;
  const cached = cacheGet(catalogCache, catKey);
  if (cached) return cached.metas;

  // Paginate correctly: WP pages are PER_PAGE long, so an unaligned `skip`
  // needs one page plus a slice instead of re-requesting the same page.
  const page = Math.floor(skip / PER_PAGE) + 1;
  const offset = skip % PER_PAGE;

  const first = await fetchPostsPage({ page, search, catId: resolvedCatId });
  let posts = first.posts;
  let reason = first.reason;

  if (!Array.isArray(posts)) {
    log("CATALOG", `empty (${reason}) page=${page} genre="${genre || category || "all"}" q="${search}"`);
    return [];
  }

  if (offset > 0) {
    if (posts.length === PER_PAGE) {
      const second = await fetchPostsPage({ page: page + 1, search, catId: resolvedCatId });
      if (Array.isArray(second.posts)) posts = posts.concat(second.posts);
    }
    posts = posts.slice(offset, offset + PER_PAGE);
  }

  if (posts.length === 0) {
    log("CATALOG", `no items after slice (${reason}) page=${page} skip=${skip}`);
    return [];
  }

  const metas = posts.map((p) => postToMeta(p, type));
  cacheSet(catalogCache, catKey, { metas }, CATALOG_TTL_MS);
  return metas;
}

// ---------------------------------------------------------------------------
// SCRAPING
// ---------------------------------------------------------------------------
async function fetchPageHtml(pageUrl) {
  const cached = cacheGet(pageCache, pageUrl);
  if (cached) return cached.html;

  let html = "";
  try {
    const r = await fetchWithTimeout(pageUrl, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (r.ok) html = await r.text();
  } catch {}

  if (!html || html.includes("<title>Just a moment...</title>")) {
    if (!JINA_ENABLED) throw new Error("page_blocked_and_jina_disabled");
    log("PAGE", "direct fetch blocked — falling back to r.jina.ai");
    const pr = await fetchWithTimeout(`https://r.jina.ai/${pageUrl}?_t=${Date.now()}`, {
      headers: { "X-Return-Format": "html", "X-No-Cache": "true" },
    });
    if (!pr.ok) throw new Error(`page_fetch_failed_${pr.status}`);
    html = await pr.text();
  }
  cacheSet(pageCache, pageUrl, { html }, CATALOG_TTL_MS);
  return html;
}

function extractEmbedCandidates($, html) {
  const candidates = [];
  const hosters = [
    "lulu", "streamtape", "dood", "vidhide", "streamwish", "mixdrop",
    "voe", "filemoon", "vidoza", "mp4upload", "player4me", "streamcrypt",
    "streamhg", "emturbovid", "tubev", "upstream", "streamhub", "abyssto",
    "cloudemb", "watchsb", "streamsb",
  ];

  $("iframe").each((_, el) => {
    let src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (!src) return;
    if (src.startsWith("//")) src = "https:" + src;
    const lower = src.toLowerCase();
    if (hosters.some((h) => lower.includes(h))) {
      candidates.push({ url: src, type: "hoster" });
    }
  });

  let m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i);
  if (m) candidates.push({ url: m[1], type: "direct" });

  m = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
  if (m) candidates.push({ url: m[1], type: "direct" });

  const re = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|m3u8)[^\s"'<>\\]*/gi;
  let mm;
  while ((mm = re.exec(html))) {
    candidates.push({ url: mm[0], type: "direct" });
  }

  $("video source, video").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (src) candidates.push({ url: src, type: "direct" });
  });

  const seen = new Set();
  return candidates.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

async function resolveHoster(embedUrl) {
  try {
    if (!isSafePublicHost(embedUrl)) {
      log("HOSTER", `refused non-public target ${embedUrl.slice(0, 80)}`);
      return null;
    }

    let html = "";
    try {
      const r = await fetchWithTimeout(embedUrl, {
        headers: { "user-agent": UA, referer: `${BASE_URL}/`, accept: "text/html,*/*" },
      });
      if (r.ok) html = await r.text();
    } catch {}

    if (!html || html.includes("<title>Just a moment...</title>")) {
      if (!JINA_ENABLED) return null;
      const pr = await fetchWithTimeout(`https://r.jina.ai/${embedUrl}?_t=${Date.now()}`, {
        headers: { "X-Return-Format": "html", "X-No-Cache": "true" },
      });
      if (pr.ok) html = await pr.text();
    }
    if (!html) return null;

    const $ = load(html);
    let fullText = html;
    let packedSeen = 0;
    let packedUnpacked = 0;

    $("script").each((_, el) => {
      const text = $(el).html() || "";
      if (!isPacked(text)) return;
      packedSeen++;
      const unpacked = unpackDeanEdwards(text);
      if (unpacked) {
        packedUnpacked++;
        fullText += "\n" + unpacked;
      }
    });

    if (packedSeen > 0 && packedUnpacked === 0) {
      log("HOSTER", `${embedUrl.slice(0, 60)} — packed script found but not unpacked`);
    }

    let m = fullText.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i);
    if (m) return { videoUrl: m[1].replace(/\\\//g, "/"), referer: embedUrl };

    m = fullText.match(/file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
    if (m) return { videoUrl: m[1].replace(/\\\//g, "/"), referer: embedUrl };

    m = fullText.match(/["']file["']\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
    if (m) return { videoUrl: m[1].replace(/\\\//g, "/"), referer: embedUrl };

    if (embedUrl.includes("streamtape")) {
      const sm =
        fullText.match(/id=['"](?:robotlink|videolink)['"][^>]*>([^<]+)/i) ||
        fullText.match(
          /document\.getElementById\(['"](?:robotlink|videolink)['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*['"]([^'"]+)['"]/i
        );
      if (sm) {
        let link = sm[1] + (sm[2] || "");
        if (link.startsWith("//")) link = "https:" + link;
        return { videoUrl: link, referer: embedUrl };
      }
    }

    const src = $("video source").attr("src") || $("video").attr("src") || $("source").attr("src");
    if (src) return { videoUrl: src, referer: embedUrl };

    m = fullText.match(/https?:\/\/[^\s"'<>\\]+\.(?:mp4|m3u8)[^\s"'<>\\]*/i);
    if (m) return { videoUrl: m[0].replace(/\\\//g, "/"), referer: embedUrl };

    return null;
  } catch (e) {
    log("HOSTER", `${embedUrl} -> ${e.message}`);
    return null;
  }
}

async function resolveVideoFromPage(pageUrl) {
  const cached = cacheGet(streamCache, pageUrl);
  if (cached) return cached;

  const html = await fetchPageHtml(pageUrl);
  const $ = load(html);
  const candidates = extractEmbedCandidates($, html);

  log("SCRAPE", `${candidates.length} candidate(s) on ${pageUrl}`);
  if (candidates.length === 0) {
    log("SCRAPE", "no candidates — the site's player markup probably changed");
    return null;
  }

  const direct = candidates.find((c) => c.type === "direct" && isSafePublicHost(c.url));
  if (direct) {
    learnHost(direct.url);
    const res = { videoUrl: direct.url, referer: pageUrl };
    cacheSet(streamCache, pageUrl, res, STREAM_TTL_MS);
    return res;
  }

  for (const c of candidates.filter((x) => x.type === "hoster")) {
    const resolved = await resolveHoster(c.url);
    if (resolved && resolved.videoUrl) {
      learnHost(resolved.videoUrl);
      log("SCRAPE", `resolved via hoster -> ${resolved.videoUrl.slice(0, 80)}`);
      cacheSet(streamCache, pageUrl, resolved, STREAM_TTL_MS);
      return resolved;
    }
  }

  log("SCRAPE", "candidates found but none resolved to a playable URL");
  return null;
}

// ---------------------------------------------------------------------------
// PROXY (with m3u8 rewriting + token refresh)
// ---------------------------------------------------------------------------
function httpUrl(pathAndQuery, req) {
  return `${getProxyBase(req)}${pathAndQuery}`;
}

function proxyLink(absUrl, referer, req) {
  let ext = ".ts";
  if (absUrl.includes(".m3u8")) ext = ".m3u8";
  else if (absUrl.includes(".key")) ext = ".key";
  return httpUrl(
    `/proxy/hls${ext}?url=${encodeURIComponent(absUrl)}&referer=${encodeURIComponent(referer)}`,
    req
  );
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

function rewriteM3u8(text, baseUrl, referer, req) {
  const lines = text.split(/\r?\n/);
  const out = [];

  const rewriteUri = (raw) => {
    let abs;
    try {
      abs = new URL(raw, baseUrl).href;
    } catch {
      return raw;
    }
    return proxyLink(abs, referer, req);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (trimmed.startsWith("#")) {
      if (/URI="/i.test(trimmed)) {
        out.push(trimmed.replace(/URI="([^"]+)"/gi, (_, u) => `URI="${rewriteUri(u)}"`));
      } else {
        out.push(line);
      }
      continue;
    }
    out.push(rewriteUri(trimmed));
  }
  return out.join("\n");
}

/**
 * Media URLs are signed and expire. When the CDN rejects our stored URL,
 * re-resolve the embed once to get a fresh token instead of failing playback.
 */
async function refreshMediaUrl(referer) {
  if (!referer || !isSafePublicHost(referer)) return null;
  try {
    const fresh = await resolveHoster(referer);
    if (fresh?.videoUrl) {
      learnHost(fresh.videoUrl);
      return fresh.videoUrl;
    }
  } catch {}
  return null;
}

async function handleProxy(req, res, u) {
  if (req.method === "OPTIONS") return sendJson(req, res, 204, null);
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(req, res, 405, { error: "Method not allowed" });
  }

  const rawTarget = u.searchParams.get("url");
  const referer = u.searchParams.get("referer") || `${BASE_URL}/`;
  if (!rawTarget) return sendJson(req, res, 400, { error: "Missing url" });

  const check = checkProxyUrl(rawTarget, proxyOptions());
  if (!check.ok) {
    log("PROXY BLOCK", `${check.reason} ${check.host || String(rawTarget).slice(0, 80)}`);
    return sendJson(req, res, 403, { error: "Host not allowed", reason: check.reason });
  }

  const ac = new AbortController();
  res.on("close", () => ac.abort());

  const range = req.headers.range;
  const upstreamHeaders = { "user-agent": UA, referer, accept: "*/*" };
  if (range) upstreamHeaders.range = range;

  try {
    let currentUrl = check.url.toString();
    let r = await fetch(currentUrl, {
      headers: upstreamHeaders,
      redirect: "follow",
      signal: ac.signal,
    });

    // 401/403/410 usually means the signed token aged out.
    if ([401, 403, 404, 410].includes(r.status) && referer) {
      const fresh = await refreshMediaUrl(referer);
      if (fresh && fresh !== currentUrl) {
        log("PROXY REFRESH", `${r.status} -> re-resolved token`);
        currentUrl = fresh;
        r = await fetch(currentUrl, {
          headers: upstreamHeaders,
          redirect: "follow",
          signal: ac.signal,
        });
      }
    }

    if (!r.ok && r.status !== 206) {
      log("PROXY FAIL", `${r.status} ${currentUrl.slice(0, 80)}`);
      return sendJson(req, res, r.status === 404 ? 404 : 502, {
        error: "Upstream error",
        status: r.status,
      });
    }

    let contentType = r.headers.get("content-type") || "video/mp4";
    const looksLikeM3u8 =
      currentUrl.includes(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("x-mpegURL");

    if (looksLikeM3u8) {
      const text = await r.text();
      learnPlaylistHosts(text, currentUrl);
      const rewritten = rewriteM3u8(text, currentUrl, referer, req);
      const body = Buffer.from(rewritten, "utf-8");
      res.writeHead(200, {
        "content-type": "application/vnd.apple.mpegurl",
        ...CORS_HEADERS,
        "cache-control": "no-store",
        "content-length": body.length,
      });
      return res.end(req.method === "HEAD" ? undefined : body);
    }

    if (contentType === "application/octet-stream") contentType = "video/mp4";

    const headers = {
      "content-type": contentType,
      ...CORS_HEADERS,
      "cache-control": "no-store",
      "accept-ranges": r.headers.get("accept-ranges") || "bytes",
    };
    const cl = r.headers.get("content-length");
    const cr = r.headers.get("content-range");
    if (cl) headers["content-length"] = cl;
    if (cr) headers["content-range"] = cr;

    res.writeHead(r.status === 206 ? 206 : 200, headers);
    if (!r.body || req.method === "HEAD") return res.end();

    const reader = r.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((r2) => res.once("drain", r2));
    }
    res.end();
  } catch (e) {
    if (e.name === "AbortError") return; // player seeked/closed: normal
    console.error("[PROXY ERR]", e.message);
    if (!res.headersSent) sendJson(req, res, 502, { error: "Proxy failed", detail: e.message });
    else res.end();
  }
}

// ---------------------------------------------------------------------------
// HTTP SERVER
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = u.pathname;
  log("HTTP", `${req.method} ${p}${u.search ? u.search.slice(0, 120) : ""}`);

  if (req.method === "OPTIONS") return sendJson(req, res, 204, null);

  if (p === "/healthz") {
    return sendJson(req, res, 200, {
      ok: true,
      version: manifest.version,
      uptimeSeconds: Math.round(process.uptime()),
      caches: {
        pages: pageCache.size,
        streams: streamCache.size,
        catalogs: catalogCache.size,
        metas: metaCache.size,
      },
      knownHosts: learnedHosts.size,
      proxy: { allowAny: PROXY_ALLOW_ANY, extraHosts: EXTRA_ALLOWED_HOSTS.length },
      jinaFallback: JINA_ENABLED,
    });
  }

  if (p === "/debug") {
    if (DEBUG_TOKEN && u.searchParams.get("token") !== DEBUG_TOKEN) {
      return sendJson(req, res, 401, { error: "Unauthorized" });
    }
    try {
      const dr = await fetchWithTimeout(`${BASE_URL}/wp-json/wp/v2/posts?per_page=1`, {
        headers: { "user-agent": UA, accept: "application/json", referer: `${BASE_URL}/` },
      });
      const txt = await dr.text();
      return sendJson(req, res, 200, {
        status: dr.status,
        ok: dr.ok,
        bodyPreview: txt.slice(0, 500),
      });
    } catch (err) {
      return sendJson(req, res, 502, { error: err.message });
    }
  }

  if (p === "/manifest.json") return sendJson(req, res, 200, manifest);

  if (p === "/") {
    return sendJson(req, res, 200, {
      name: manifest.name,
      manifest: "/manifest.json",
      install: `stremio://${req.headers.host}/manifest.json`,
    });
  }

  if (p === "/proxy" || p.startsWith("/proxy/")) return handleProxy(req, res, u);

  // -------------------------------------------------------------------------
  // CATALOG
  // -------------------------------------------------------------------------
  if (p.startsWith("/catalog/")) {
    const parts = p.split("/").filter(Boolean);
    const type = parts[1] || "movie";
    const catId = parts[2] ? parts[2].replace(/\.json$/, "") : "";
    const extraStr = parts[3] ? parts[3].replace(/\.json$/, "") : "";

    let skip = 0;
    let search = "";
    let genre = "";
    let category = "";

    if (catId && catId !== `${SITE_TAG}_latest` && catId !== `${SITE_TAG}_series_latest`) {
      category = catId;
    }

    for (const part of extraStr.split("&")) {
      if (!part) continue;
      if (part.startsWith("skip=")) skip = Number(part.slice(5)) || 0;
      if (part.startsWith("search=")) search = decodeURIComponent(part.slice(7));
      if (part.startsWith("genre=")) genre = decodeURIComponent(part.slice(6));
      if (part.startsWith("category=")) category = decodeURIComponent(part.slice(9));
    }

    if (u.searchParams.has("skip")) skip = Number(u.searchParams.get("skip")) || skip;
    if (u.searchParams.has("search")) search = u.searchParams.get("search") || search;
    if (u.searchParams.has("genre")) genre = u.searchParams.get("genre") || genre;
    if (u.searchParams.has("category")) category = u.searchParams.get("category") || category;

    if (genre && !resolveCategoryId(genre)) {
      log("CATALOG", `unknown genre "${genre}" — showing unfiltered results`);
    }

    try {
      const metas = await fetchCatalog({ skip, search, type, genre, category });
      log(
        "CATALOG",
        `returned ${metas.length} items (type=${type}, genre="${genre || category || "all"}", skip=${skip}, q="${search}")`
      );
      return sendJson(req, res, 200, { metas, cacheMaxAge: 1800 });
    } catch (e) {
      console.error("[CATALOG ERR]", e.message);
      return sendJson(req, res, 200, { metas: [] });
    }
  }

  // -------------------------------------------------------------------------
  // META
  // -------------------------------------------------------------------------
  if (p.startsWith("/meta/")) {
    const m = p.match(/\/meta\/(?:movie|series)\/(.+)\.json$/);
    const rawId = m ? m[1] : "";
    const pageUrl = extractPageUrl(rawId);
    const id = `${SITE_TAG}:${encodeURIComponent(pageUrl)}`;

    const cached = metaCache.get(id);
    if (cached) return sendJson(req, res, 200, { meta: cached.meta });

    const title = pageUrl.split("/").filter(Boolean).pop()?.replace(/-/g, " ") || "Video";
    return sendJson(req, res, 200, {
      meta: {
        id,
        type: p.includes("/series/") ? "series" : "movie",
        name: title,
        poster: POSTER_FALLBACK,
      },
    });
  }

  // -------------------------------------------------------------------------
  // STREAM
  // -------------------------------------------------------------------------
  if (p.startsWith("/stream/")) {
    const m = p.match(/\/stream\/(?:movie|series)\/(.+)\.json$/);
    const rawId = m ? m[1] : "";
    const requested = extractPageUrl(rawId);
    const pageUrl = normalizeSitePageUrl(requested);

    if (!pageUrl) {
      log("STREAM", `refused id that is not a ${BASE_HOST} URL: ${requested.slice(0, 80)}`);
      return sendJson(req, res, 200, { streams: [] });
    }

    log("STREAM", `request for ${pageUrl}`);

    try {
      const resolved = await resolveVideoFromPage(pageUrl);
      if (!resolved || !resolved.videoUrl) {
        log("STREAM", `no video URL found (reason: resolution_failed) for ${pageUrl}`);
        return sendJson(req, res, 200, { streams: [] });
      }

      const { videoUrl, referer } = resolved;
      log("STREAM", `-> ${videoUrl.slice(0, 100)}`);

      const title = videoUrl.includes(".mp4") ? "Direct MP4" : "Fast HLS (Auto Quality)";
      const ref = referer || pageUrl;

      let proxyUrl = httpUrl(
        `/proxy/master.m3u8?url=${encodeURIComponent(videoUrl)}&referer=${encodeURIComponent(ref)}`,
        req
      );
      if (process.env.CF_WORKER_URL) {
        const workerBase = process.env.CF_WORKER_URL.replace(/\/+$/, "");
        proxyUrl = `${workerBase}/stream.m3u8?embed=${encodeURIComponent(ref)}&url=${encodeURIComponent(videoUrl)}`;
      }

      return sendJson(
        req,
        res,
        200,
        {
          streams: [
            {
              name: "Stream",
              title,
              url: proxyUrl,
              behaviorHints: { notWebReady: false },
            },
          ],
        },
        { "cache-control": "no-cache, no-store, must-revalidate" }
      );
    } catch (e) {
      log("STREAM", `failed: ${e.message}`);
      return sendJson(req, res, 200, { streams: [] });
    }
  }

  return sendJson(req, res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Addon running on port ${PORT}`);
  console.log(`   Manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`   Health:   http://localhost:${PORT}/healthz`);
  console.log(
    `   Proxy:    ${PROXY_ALLOW_ANY ? "OPEN (PROXY_ALLOW_ANY=1)" : "allowlisted hosts only"}`
  );
  console.log(`   Jina fallback: ${JINA_ENABLED ? "enabled" : "disabled"}`);
  console.log(`   Pre-warming catalog cache...`);
  fetchCatalog({ skip: 0, type: "movie" })
    .then((m) => console.log(`   Catalog cache warmed (${m.length} items)`))
    .catch((e) => console.log(`   Catalog warm failed: ${e.message}`));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n${signal} received — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
