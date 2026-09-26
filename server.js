import http from "node:http";
import { URL } from "node:url";
import { load } from "cheerio";

const PORT = Number(process.env.PORT || 7000);
const BASE_URL = "https://pornx11.com";
const SITE_TAG = "pornx11";

const SITE_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const POSTER_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#1a1a1a"/><text x="50%" y="50%" fill="#666" font-family="sans-serif" font-size="24" text-anchor="middle">Latest</text></svg>`
  );

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0 Safari/537.36";

// ---------------------------------------------------------------------------
// CATEGORIES (Sorted alphabetically)
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
  { id: 74, name: "Nuefliksplus", slug: "nuefliksmovies" },
  { id: 68, name: "RDXMovies", slug: "rdxmovies" },
  { id: 65, name: "RedPrime", slug: "redprime" },
  { id: 77, name: "Solo Video", slug: "solo-video" },
  { id: 10, name: "Sudipa", slug: "sudipa-originals" },
  { id: 57, name: "ZoopTv", slug: "zooptv" }
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
  if (!str) return null;
  const decoded = decodeURIComponent(str).toLowerCase().trim();
  if (CAT_LOOKUP.has(decoded)) return CAT_LOOKUP.get(decoded);
  const stripped = decoded.replace(new RegExp(`^${SITE_TAG}[_-]`), "");
  if (CAT_LOOKUP.has(stripped)) return CAT_LOOKUP.get(stripped);
  return null;
}

const GENRE_OPTIONS = [...new Set(CATEGORIES.map((c) => c.name))].sort((a, b) => a.localeCompare(b));

// ---------------------------------------------------------------------------
// MANIFEST — Unified Single Catalog (No separate movies/series tabs!)
// ---------------------------------------------------------------------------
const manifest = {
  id: "com.pornx11.addon",
  version: "1.3.0",
  name: "OTT Networks & Studios",
  description: "Browse and stream by OTT network & studio",
  logo: POSTER_FALLBACK,
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: [`${SITE_TAG}:`],
  catalogs: [
    {
      type: "movie",
      id: `${SITE_TAG}_latest`,
      name: "Latest", // No "PornX11 —" prefix!
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false, options: GENRE_OPTIONS },
        { name: "skip", isRequired: false }
      ]
    }
  ],
  behaviorHints: { configurable: false }
};

// ---------------------------------------------------------------------------
// CACHE
// ---------------------------------------------------------------------------
const pageCache = new Map();     // pageUrl -> {html, expires}
const metaCache = new Map();     // id -> meta
const streamCache = new Map();   // pageUrl -> {videoUrl, referer, expires}
const catalogCache = new Map();  // catKey -> {metas, expires}

function cacheGet(map, key) {
  const e = map.get(key);
  if (!e) return null;
  if (e.expires < Date.now()) { map.delete(key); return null; }
  return e;
}
function cacheSet(map, key, val, ttl = CACHE_TTL_MS) {
  map.set(key, { ...val, expires: Date.now() + ttl });
  if (map.size > 2000) map.delete(map.keys().next().value);
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "cache-control": "max-age=600, stale-while-revalidate=1200",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
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
  const proto =
    req.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || "http";
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
  let s = decodeURIComponent(rawId || "");
  s = s.replace(/:\d+:\d+$/, "");
  s = s.replace(new RegExp(`^${SITE_TAG}:`), "");
  if (s.includes("%")) {
    try { s = decodeURIComponent(s); } catch {}
  }
  return s.trim();
}

// Unpack Dean Edwards packed JavaScript: eval(function(p,a,c,k,e,d)...)
function unpackDeanEdwards(scriptText) {
  try {
    const startIdx = scriptText.indexOf("eval(function(p,a,c,k,e,d)");
    if (startIdx === -1) return null;
    const sub = scriptText.slice(startIdx);
    const m = sub.match(/}\s*\(\s*['"]([\s\S]*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"]([\s\S]*?)['"]\.split\(['"]\|['"]\)/);
    if (m) {
      let [_, p, a, c, k] = m;
      a = parseInt(a, 10);
      c = parseInt(c, 10);
      const words = k.split("|");
      while (c--) {
        if (words[c]) {
          p = p.replace(new RegExp("\\b" + c.toString(a) + "\\b", "g"), words[c]);
        }
      }
      return p;
    }

    const lastParen = sub.lastIndexOf(")");
    const firstParenAfterFunc = sub.indexOf("}(", 20);
    if (firstParenAfterFunc !== -1 && lastParen !== -1) {
      const argsStr = sub.slice(firstParenAfterFunc + 2, lastParen);
      const fn = new Function(`
        function unpack(p, a, c, k, e, d) {
          while (c--) {
            if (k[c]) p = p.replace(new RegExp('\\\\b' + c.toString(a) + '\\\\b', 'g'), k[c]);
          }
          return p;
        }
        return unpack(${argsStr});
      `);
      return fn();
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// WORDPRESS REST API — CATALOG
// ---------------------------------------------------------------------------
async function fetchCatalog({ skip = 0, search = "", type = "movie", genre = "", category = "" }) {
  const resolvedCatId = resolveCategoryId(category) || resolveCategoryId(genre);
  const catKey = `${type}_${resolvedCatId || "all"}_${skip}_${search}`;
  const cached = cacheGet(catalogCache, catKey);
  if (cached) return cached.metas;

  const perPage = 25;
  const page = Math.floor(skip / perPage) + 1;

  const url = new URL(`${BASE_URL}/wp-json/wp/v2/posts`);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  url.searchParams.set("_embed", "wp:featuredmedia");
  url.searchParams.set("_fields", "id,title,link,excerpt,_links,_embedded");

  if (resolvedCatId) {
    url.searchParams.set("categories", String(resolvedCatId));
  }
  if (search) {
    url.searchParams.set("search", search);
  }

  let posts = null;
  try {
    const r = await fetchWithTimeout(url.href, {
      headers: { "user-agent": UA, accept: "application/json" }
    });
    if (r.ok) {
      posts = await r.json();
    }
  } catch (e) {}

  if (!Array.isArray(posts) || posts.length === 0) {
    console.log(`[CATALOG] Direct fetch blocked or empty, using Cloudflare bypass proxy...`);
    try {
      const pr = await fetchWithTimeout(`https://r.jina.ai/${url.href}`);
      if (pr.ok) {
        const text = await pr.text();
        const m = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (m) posts = JSON.parse(m[0]);
      }
    } catch (e) {
      console.log(`[CATALOG] Proxy fallback error: ${e.message}`);
    }
  }
  if (!Array.isArray(posts)) return [];

  const metas = posts.map((p) => {
    const featured = p._embedded?.["wp:featuredmedia"]?.[0];
    const poster =
      featured?.source_url ||
      featured?.media_details?.sizes?.medium_large?.source_url ||
      featured?.media_details?.sizes?.large?.source_url ||
      featured?.media_details?.sizes?.full?.source_url ||
      POSTER_FALLBACK;

    const title = norm(p.title?.rendered || "");
    const id = `${SITE_TAG}:${encodeURIComponent(p.link)}`;

    const meta = {
      id,
      type,
      name: title,
      poster,
      background: poster,
      description: norm(p.excerpt?.rendered || ""),
      website: p.link
    };

    cacheSet(metaCache, id, { meta }, CACHE_TTL_MS);
    return meta;
  });

  cacheSet(catalogCache, catKey, { metas }, CACHE_TTL_MS);
  return metas;
}

// ---------------------------------------------------------------------------
// SCRAPE VIDEO URL FROM ARTICLE PAGE
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
        "accept-language": "en-US,en;q=0.9"
      }
    });
    if (r.ok) html = await r.text();
  } catch (e) {}

  if (!html || html.includes("<title>Just a moment...</title>")) {
    console.log(`[PAGE] Direct fetch blocked, using Cloudflare bypass proxy...`);
    const pr = await fetchWithTimeout(`https://r.jina.ai/${pageUrl}`, {
      headers: { "X-Return-Format": "html" }
    });
    if (pr.ok) {
      html = await pr.text();
    } else {
      throw new Error("Page fetch failed");
    }
  }
  cacheSet(pageCache, pageUrl, { html });
  return html;
}

function extractEmbedCandidates($, html) {
  const candidates = [];
  const hosters = [
    "lulu", "streamtape", "dood", "vidhide", "streamwish", "mixdrop",
    "voe", "filemoon", "vidoza", "mp4upload", "player4me", "streamcrypt",
    "streamhg", "emturbovid", "tubev", "upstream", "streamhub", "abyssto",
    "cloudemb", "watchsb", "streamsb"
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
    let html = "";
    try {
      const r = await fetchWithTimeout(embedUrl, {
        headers: {
          "user-agent": UA,
          referer: BASE_URL + "/",
          accept: "text/html,*/*"
        }
      });
      if (r.ok) html = await r.text();
    } catch (err) {}

    if (!html || html.includes("<title>Just a moment...</title>")) {
      const pr = await fetchWithTimeout(`https://r.jina.ai/${embedUrl}`, {
        headers: { "X-Return-Format": "html" }
      });
      if (pr.ok) html = await pr.text();
    }
    if (!html) return null;
    const $ = load(html);

    let fullText = html;
    $("script").each((_, el) => {
      const text = $(el).html() || "";
      if (text.includes("eval(function(p,a,c,k,e,d)")) {
        const unpacked = unpackDeanEdwards(text);
        if (unpacked) {
          fullText += "\n" + unpacked;
        }
      }
    });

    let m = fullText.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i);
    if (m) return { videoUrl: m[1].replace(/\\\//g, "/"), referer: embedUrl };

    m = fullText.match(/file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
    if (m) return { videoUrl: m[1].replace(/\\\//g, "/"), referer: embedUrl };

    m = fullText.match(/["']file["']\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
    if (m) return { videoUrl: m[1].replace(/\\\//g, "/"), referer: embedUrl };

    if (embedUrl.includes("streamtape")) {
      const sm =
        fullText.match(/id=['"](?:robotlink|videolink)['"][^>]*>([^<]+)/i) ||
        fullText.match(/document\.getElementById\(['"](?:robotlink|videolink)['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*['"]([^'"]+)['"]/i);
      if (sm) {
        let link = sm[1] + (sm[2] || "");
        if (link.startsWith("//")) link = "https:" + link;
        return { videoUrl: link, referer: embedUrl };
      }
    }

    const src =
      $("video source").attr("src") ||
      $("video").attr("src") ||
      $("source").attr("src");
    if (src) return { videoUrl: src, referer: embedUrl };

    m = fullText.match(/https?:\/\/[^\s"'<>\\]+\.(?:mp4|m3u8)[^\s"'<>\\]*/i);
    if (m) return { videoUrl: m[0].replace(/\\\//g, "/"), referer: embedUrl };

    return null;
  } catch (e) {
    console.log(`[HOSTER] ${embedUrl} -> ${e.message}`);
    return null;
  }
}

async function resolveVideoFromPage(pageUrl) {
  const cached = cacheGet(streamCache, pageUrl);
  if (cached) return cached;

  const html = await fetchPageHtml(pageUrl);
  const $ = load(html);
  const candidates = extractEmbedCandidates($, html);

  console.log(`[SCRAPE] ${candidates.length} candidate(s) on ${pageUrl}`);

  const direct = candidates.find((c) => c.type === "direct");
  if (direct) {
    const res = { videoUrl: direct.url, referer: pageUrl };
    cacheSet(streamCache, pageUrl, res, 30 * 60 * 1000);
    return res;
  }

  for (const c of candidates.filter((x) => x.type === "hoster")) {
    const resolved = await resolveHoster(c.url);
    if (resolved && resolved.videoUrl) {
      console.log(`[SCRAPE] Resolved via hoster -> ${resolved.videoUrl.slice(0, 80)}`);
      cacheSet(streamCache, pageUrl, resolved, 30 * 60 * 1000);
      return resolved;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// PROXY (with m3u8 rewriting)
// ---------------------------------------------------------------------------
function isHostAllowed(host) {
  if (!host) return false;
  host = host.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.startsWith("172.16.") ||
    host.startsWith("172.17.") ||
    host.startsWith("172.18.") ||
    host.startsWith("172.19.") ||
    host.startsWith("172.20.") ||
    host.startsWith("172.21.") ||
    host.startsWith("172.22.") ||
    host.startsWith("172.23.") ||
    host.startsWith("172.24.") ||
    host.startsWith("172.25.") ||
    host.startsWith("172.26.") ||
    host.startsWith("172.27.") ||
    host.startsWith("172.28.") ||
    host.startsWith("172.29.") ||
    host.startsWith("172.30.") ||
    host.startsWith("172.31.")
  ) {
    return false;
  }
  return true;
}

function rewriteM3u8(text, baseUrl, referer, proxyBase) {
  const lines = text.split(/\r?\n/);
  const out = [];

  const rewriteUri = (raw) => {
    let abs;
    try { abs = new URL(raw, baseUrl).href; } catch { return raw; }
    return `${proxyBase}/proxy?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}`;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { out.push(line); continue; }

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

async function handleProxy(req, res, u) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS"
    });
    return res.end();
  }

  const targetUrl = u.searchParams.get("url");
  const referer = u.searchParams.get("referer") || `${BASE_URL}/`;
  if (!targetUrl) return sendJson(res, 400, { error: "Missing url" });

  let host;
  try { host = new URL(targetUrl).hostname; }
  catch { return sendJson(res, 400, { error: "Bad url" }); }

  if (!isHostAllowed(host)) {
    console.log(`[PROXY BLOCK] ${host}`);
    return sendJson(res, 403, { error: "Host not allowed" });
  }

  try {
    const rangeHeader = req.headers.range;
    const upstreamHeaders = {
      "user-agent": UA,
      referer,
      accept: "*/*"
    };
    if (rangeHeader) upstreamHeaders.range = rangeHeader;

    const r = await fetch(targetUrl, { headers: upstreamHeaders });

    if (!r.ok && r.status !== 206) {
      console.log(`[PROXY FAIL ${r.status}] ${targetUrl.slice(0, 80)}`);
      return sendJson(res, r.status, { error: "Upstream error" });
    }

    let contentType = r.headers.get("content-type") || "video/mp4";

    const looksLikeM3u8 =
      targetUrl.includes(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("x-mpegURL");

    if (looksLikeM3u8) {
      const text = await r.text();
      const proxyBase = getProxyBase(req);
      const rewritten = rewriteM3u8(text, targetUrl, referer, proxyBase);
      const body = Buffer.from(rewritten, "utf-8");
      res.writeHead(200, {
        "content-type": "application/vnd.apple.mpegurl",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "cache-control": "no-store",
        "content-length": body.length
      });
      return res.end(body);
    }

    if (contentType === "application/octet-stream") contentType = "video/mp4";

    const headers = {
      "content-type": contentType,
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "cache-control": "no-store"
    };
    const cl = r.headers.get("content-length");
    const cr = r.headers.get("content-range");
    const ar = r.headers.get("accept-ranges");
    if (cl) headers["content-length"] = cl;
    if (cr) headers["content-range"] = cr;
    headers["accept-ranges"] = ar || "bytes";

    res.writeHead(r.status === 206 ? 206 : 200, headers);
    if (!r.body) return res.end();

    const reader = r.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (e) {
    console.error("[PROXY ERR]", e.message);
    if (!res.headersSent) sendJson(res, 500, { error: "Proxy failed" });
    else res.end();
  }
}

// ---------------------------------------------------------------------------
// HTTP SERVER
// ---------------------------------------------------------------------------
http
  .createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host || "x"}`);
    const p = u.pathname;
    console.log(`[${req.method}] ${p}${u.search}`);

    if (p === "/debug") {
      try {
        const dr = await fetchWithTimeout("https://pornx11.com/wp-json/wp/v2/posts?per_page=1", {
          headers: { "User-Agent": UA, Accept: "application/json", Referer: `${BASE_URL}/` }
        });
        const txt = await dr.text();
        return sendJson(res, 200, { status: dr.status, ok: dr.ok, bodyPreview: txt.slice(0, 500) });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
    if (p === "/manifest.json") return sendJson(res, 200, manifest);

    if (p === "/") {
      return sendJson(res, 200, {
        name: manifest.name,
        manifest: "/manifest.json",
        install: `stremio://${req.headers.host}/manifest.json`
      });
    }

    if (p === "/proxy") return handleProxy(req, res, u);

    // -----------------------------------------------------------------------
    // CATALOG
    // -----------------------------------------------------------------------
    if (p.startsWith("/catalog/")) {
      const parts = p.split("/").filter(Boolean);
      // /catalog/{type}/{id}/{extra?}.json
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

      try {
        const metas = await fetchCatalog({ skip, search, type, genre, category });
        console.log(`[CATALOG] returned ${metas.length} items (type=${type}, genre="${genre || category || 'all'}", skip=${skip}, q="${search}")`);
        return sendJson(res, 200, { metas, cacheMaxAge: 1800 });
      } catch (e) {
        console.error("[CATALOG ERR]", e.message);
        return sendJson(res, 200, { metas: [] });
      }
    }

    // -----------------------------------------------------------------------
    // META
    // -----------------------------------------------------------------------
    if (p.startsWith("/meta/")) {
      const m = p.match(/\/meta\/(?:movie|series)\/(.+)\.json$/);
      const rawId = m ? m[1] : "";
      const pageUrl = extractPageUrl(rawId);
      const id = `${SITE_TAG}:${encodeURIComponent(pageUrl)}`;

      const cached = metaCache.get(id);
      if (cached) return sendJson(res, 200, { meta: cached.meta });

      const title = pageUrl.split("/").filter(Boolean).pop()?.replace(/-/g, " ") || "Video";
      return sendJson(res, 200, {
        meta: { id, type: p.includes("/series/") ? "series" : "movie", name: title, poster: POSTER_FALLBACK }
      });
    }

    // -----------------------------------------------------------------------
    // STREAM
    // -----------------------------------------------------------------------
    if (p.startsWith("/stream/")) {
      const m = p.match(/\/stream\/(?:movie|series)\/(.+)\.json$/);
      const rawId = m ? m[1] : "";
      const pageUrl = extractPageUrl(rawId);
      console.log(`\n[STREAM] Request for: ${pageUrl}`);

      try {
        const resolved = await resolveVideoFromPage(pageUrl);
        if (!resolved || !resolved.videoUrl) {
          console.log("[STREAM] No video URL found");
          return sendJson(res, 200, { streams: [] });
        }

        const { videoUrl, referer } = resolved;
        console.log(`[STREAM] -> ${videoUrl.slice(0, 100)}`);

        let title = "Fast HLS (Auto Quality)";
        if (videoUrl.includes(".mp4")) {
          title = "Direct MP4";
        }

        const proxyBase = getProxyBase(req);
        const proxyUrl = `${proxyBase}/proxy?url=${encodeURIComponent(videoUrl)}&referer=${encodeURIComponent(referer || pageUrl)}`;

        return sendJson(res, 200, {
          streams: [
            {
              name: "Stream",
              title,
              url: proxyUrl,
              behaviorHints: {
                notWebReady: false
              }
            }
          ]
        });
      } catch (e) {
        console.error("[STREAM ERR]", e.message);
        return sendJson(res, 200, { streams: [] });
      }
    }

    return sendJson(res, 404, { error: "Not found" });
  })
  .listen(PORT, () => {
    console.log(`\n🚀 Addon running on port ${PORT}`);
    console.log(`   Manifest: http://localhost:${PORT}/manifest.json`);
    console.log(`   Pre-warming catalog cache in background...`);
    fetchCatalog({ skip: 0, type: "movie" })
      .then((m) => console.log(`   Catalog cache warmed (${m.length} items)`))
      .catch((e) => console.log(`   Catalog warm failed: ${e.message}`));
  });
