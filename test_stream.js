#!/usr/bin/env node
// Diagnostic CLI: shows what the addon would find for a page or embed URL.
//
//   node test_stream.js                              # newest post on the site
//   node test_stream.js https://pornx11.com/some-post/
//   node test_stream.js https://luluvido.com/e/abc123
//
// Read-only: prints candidates and probes the first playable URL with a 1 KB
// range request. No eval, no `new Function` — the packer is parsed with regex.

import { load } from "cheerio";
import { isPacked, unpackDeanEdwards } from "./packer.js";
import { isSafePublicHost } from "./allowlist.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const JINA_ENABLED = process.env.DISABLE_JINA_FALLBACK !== "1";

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,*/*",
        referer: "https://pornx11.com/",
      },
      redirect: "follow",
    });
    return { status: r.status, ok: r.ok, text: await r.text() };
  } finally {
    clearTimeout(t);
  }
}

async function html(url) {
  const direct = await get(url).catch((e) => ({ ok: false, status: 0, text: "", error: e.message }));
  if (direct.ok && !direct.text.includes("<title>Just a moment...</title>")) return direct.text;
  if (!JINA_ENABLED) throw new Error(`direct fetch failed (${direct.status || direct.error}), jina disabled`);
  console.log(`  direct fetch blocked (${direct.status || direct.error}) — trying r.jina.ai`);
  const proxied = await get(`https://r.jina.ai/${url}?_t=${Date.now()}`).catch(() => null);
  if (!proxied?.ok) throw new Error("both direct and r.jina.ai failed");
  return proxied.text;
}

function findMedia(html) {
  const out = [];
  const push = (u) => {
    const clean = u.replace(/\\\//g, "/");
    if (clean && !out.includes(clean)) out.push(clean);
  };
  const re = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|m3u8)[^\s"'<>\\]*/gi;
  let m;
  while ((m = re.exec(html))) push(m[0]);
  for (const pat of [
    /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i,
    /file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,
  ]) {
    const mm = html.match(pat);
    if (mm) push(mm[1]);
  }
  return out;
}

function unpackScripts(pageHtml) {
  const $ = load(pageHtml);
  let text = pageHtml;
  let seen = 0;
  let unpacked = 0;
  $("script").each((_, el) => {
    const body = $(el).html() || "";
    if (!isPacked(body)) return;
    seen++;
    const out = unpackDeanEdwards(body);
    if (out) {
      unpacked++;
      text += "\n" + out;
    }
  });
  return { text, seen, unpacked };
}

async function probe(url, referer) {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, referer, range: "bytes=0-1023" },
      redirect: "follow",
    });
    return `HTTP ${r.status}  type=${r.headers.get("content-type")}  range=${r.headers.get("content-range") || "-"}`;
  } catch (e) {
    return `probe failed: ${e.message}`;
  }
}

async function main() {
  const target = process.argv[2] || "https://pornx11.com/wp-json/wp/v2/posts?per_page=1&_fields=link";

  let pageUrl = target;
  if (target.includes("/wp-json/")) {
    const r = await get(target);
    const link = JSON.parse(r.text)?.[0]?.link;
    if (!link) throw new Error("could not read a post link from the API");
    pageUrl = link;
    console.log(`Latest post: ${pageUrl}`);
  }

  if (!isSafePublicHost(pageUrl)) throw new Error("refusing a non-public target host");

  console.log("Fetching page…");
  const pageHtml = await html(pageUrl);
  console.log(`  ${pageHtml.length} bytes`);

  const $ = load(pageHtml);
  const HOSTER_HINTS = [
    "lulu", "streamtape", "dood", "vidhide", "streamwish", "mixdrop", "voe",
    "filemoon", "vidoza", "mp4upload", "player4me", "streamcrypt", "streamhg",
    "emturbovid", "upstream", "streamhub", "abyssto", "cloudemb", "watchsb", "streamsb",
  ];
  const embeds = [];
  $("iframe").each((_, el) => {
    const src = ($(el).attr("src") || $(el).attr("data-src") || "").trim();
    if (src) embeds.push(src.startsWith("//") ? "https:" + src : src);
  });
  // Try real hosters before ad frames.
  embeds.sort((a, b) => {
    const score = (u) => (HOSTER_HINTS.some((h) => u.toLowerCase().includes(h)) ? 0 : 1);
    return score(a) - score(b);
  });
  console.log(`  iframes: ${embeds.length}`);
  embeds.slice(0, 10).forEach((e) => console.log(`    - ${e}`));

  const pageCandidates = findMedia(pageHtml);
  console.log(`  direct media candidates on page: ${pageCandidates.length}`);
  pageCandidates.slice(0, 5).forEach((c) => console.log(`    - ${c}`));

  let videoUrl = pageCandidates.find((u) => isSafePublicHost(u)) || null;
  let referer = pageUrl;

  if (!videoUrl && embeds.length) {
    for (const embed of embeds) {
      if (!isSafePublicHost(embed)) {
        console.log(`  skipping non-public embed: ${embed}`);
        continue;
      }
      console.log(`\nResolving embed: ${embed}`);
      const embedHtml = await html(embed);
      const { text, seen, unpacked } = unpackScripts(embedHtml);
      console.log(`  ${embedHtml.length} bytes, packed scripts: ${seen}, unpacked: ${unpacked}`);
      const found = findMedia(text);
      console.log(`  media candidates: ${found.length}`);
      found.slice(0, 5).forEach((c) => console.log(`    - ${c}`));
      const hit = found.find((u) => isSafePublicHost(u));
      if (hit) {
        videoUrl = hit;
        referer = embed;
        break;
      }
    }
  }

  if (!videoUrl) {
    console.log("\nNo playable URL found — the player markup probably changed.");
    process.exitCode = 1;
    return;
  }

  console.log(`\nPlayable URL: ${videoUrl}`);
  console.log(`Referer:      ${referer}`);
  console.log(`Probe:        ${await probe(videoUrl, referer)}`);
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}`);
  process.exitCode = 1;
});
