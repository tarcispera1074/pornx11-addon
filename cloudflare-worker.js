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
  } catch {}
  return null;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    // -------------------------------------------------------------
    // 1. STREAM RESOLVER ENDPOINT: /stream.m3u8?embed=https://...
    // Resolves fresh embed on the worker so token IP matches worker IP!
    // -------------------------------------------------------------
    if (url.pathname.startsWith("/stream") || url.pathname.includes("master.m3u8")) {
      const embedUrl = url.searchParams.get("embed") || url.searchParams.get("referer");
      const directTarget = url.searchParams.get("url");

      let masterUrl = directTarget;
      let dbgHtmlLen = 0;
      let dbgUnpackedLen = 0;

      if (embedUrl) {
        try {
          const er = await fetch(embedUrl, {
            headers: { "User-Agent": UA, "Referer": "https://pornx11.com/", "Accept": "text/html,*/*" }
          });
          const html = await er.text();
          dbgHtmlLen = html.length;
          const unpacked = unpackDeanEdwards(html);
          dbgUnpackedLen = unpacked ? unpacked.length : 0;
          const full = html + "\n" + (unpacked || "");

          const m = full.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i) ||
                    full.match(/file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);

          if (m) {
            masterUrl = m[1].replace(/\\\//g, "/");
          }
        } catch (err) {}
      }

      if (!masterUrl) {
        return new Response(JSON.stringify({ error: "No video found", embedUrl, htmlLength: dbgHtmlLen, unpackedLength: dbgUnpackedLen }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      try {
        const mr = await fetch(masterUrl, {
          headers: { "User-Agent": UA, "Referer": embedUrl || "https://luluvido.com/", "Accept": "*/*" }
        });
        const masterText = await mr.text();

        const workerOrigin = url.origin;
        const rewritten = masterText.replace(/^(?!#)(\S+)/gm, (line) => {
          let abs;
          try { abs = new URL(line, masterUrl).href; } catch { return line; }
          return `${workerOrigin}/hls.m3u8?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(embedUrl || "")}`;
        });

        return new Response(rewritten, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store"
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
        });
      }
    }

    // -------------------------------------------------------------
    // 2. SEGMENT & PLAYLIST PROXY: /hls.m3u8, /hls.ts, /hls.key
    // -------------------------------------------------------------
    const targetUrl = url.searchParams.get("url");
    const referer = url.searchParams.get("referer") || "https://luluvido.com/";

    if (!targetUrl) {
      return new Response("Missing target url", { status: 400 });
    }

    const upstreamHeaders = new Headers();
    upstreamHeaders.set("User-Agent", UA);
    upstreamHeaders.set("Referer", referer);
    upstreamHeaders.set("Accept", "*/*");

    const range = request.headers.get("Range");
    if (range) upstreamHeaders.set("Range", range);

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: upstreamHeaders,
        redirect: "follow"
      });

      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "*");

      const isM3u8 = targetUrl.includes(".m3u8") || (response.headers.get("content-type") || "").includes("mpegurl");

      if (isM3u8) {
        const text = await response.text();
        const workerOrigin = url.origin;

        const rewritten = text
          .replace(/^(?!#)(\S+)/gm, (line) => {
            let abs;
            try { abs = new URL(line, targetUrl).href; } catch { return line; }
            let ext = ".ts";
            if (abs.includes(".m3u8")) ext = ".m3u8";
            else if (abs.includes(".key")) ext = ".key";
            return `${workerOrigin}/hls${ext}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}`;
          })
          .replace(/URI="([^"]+)"/g, (_, p1) => {
            let abs;
            try { abs = new URL(p1, targetUrl).href; } catch { return `URI="${p1}"`; }
            return `URI="${workerOrigin}/hls.key?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}"`;
          });

        responseHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
        responseHeaders.set("Cache-Control", "no-store");
        return new Response(rewritten, {
          status: 200,
          headers: responseHeaders
        });
      }

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
      });
    }
  }
};
