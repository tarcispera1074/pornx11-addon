# PornX11 Stremio/Nuvio Addon

A self-hosted addon that pulls the catalog from `pornx11.com` via its
WordPress REST API and resolves each video to a directly playable stream
by scraping the article page and any embedded hosters (lulustream etc.).

## Requirements

- Node.js **18 or newer**
- A machine that can reach `pornx11.com` (any VPS, home server, or your laptop)

## Install & run

```bash
mkdir pornx11-addon && cd pornx11-addon
# put package.json, server.js, README.md here
npm install
npm start
```

You'll see:

```
🚀 PornX11 addon running
   Manifest: http://localhost:7000/manifest.json
```

## Install in Nuvio / Stremio

1. Open Nuvio (or Stremio).
2. Go to **Addons → Install from URL**.
3. Paste: `http://<your-machine-ip>:7000/manifest.json`
   - On the same machine: `http://localhost:7000/manifest.json`
   - On your phone over LAN: `http://192.168.1.42:7000/manifest.json`
   - Behind a reverse proxy: `https://your-domain/manifest.json`
4. The **PornX11 — Latest** catalog will appear on the Discover/Board page.

## Endpoints

| Path | Purpose |
|------|---------|
| `/manifest.json` | Addon manifest |
| `/catalog/movie/pornx11_latest.json` | Latest videos |
| `/catalog/movie/pornx11_latest/search=foo.json` | Search |
| `/catalog/movie/pornx11_latest/skip=100.json` | Pagination |
| `/meta/movie/pornx11:<url>.json` | Metadata |
| `/stream/movie/pornx11:<url>.json` | Stream list |
| `/proxy?url=…&referer=…` | Header-injecting proxy with m3u8 rewriting |

## How it works

1. **Catalog** — hits the WordPress REST API at
   `pornx11.com/wp-json/wp/v2/posts?_embed=1` and reads the featured image.
2. **Stream** — fetches the video's article page, extracts candidates
   (JS `sources: [{file:...}]`, `<video><source>`, hoster iframes),
   then follows any hoster iframe to resolve the final `.mp4` / `.m3u8`.
3. **Proxy** — streams the media back with the correct `Referer` header.
   For HLS playlists (`.m3u8`) it rewrites segment and key URLs so they
   also route through the proxy.

## Notes on "Torrentio caching"

Torrentio only works with **torrents**. You cannot "cache" an HTTP video
from a site like PornX11 through it. What you actually want — and what
this addon does — is to resolve the **direct HTTP video URL** and hand it
to Stremio/Nuvio, which plays it natively far faster than the site's own
ad-laden player.

## Troubleshooting

- **Catalog is empty** → the WP REST API may be disabled or blocked.
  Check `http://<host>/wp-json/wp/v2/posts?per_page=1` in a browser.
- **Streams list is empty** → the site changed its player, or the hoster
  added obfuscation. Open the article page, view source, and look for
  `.mp4` / `.m3u8` — then extend `extractEmbedCandidates()`.
- **Video plays but stalls / no picture** → the segment URLs in the m3u8
  are probably absolute on a different host. Add that host to
  `ALLOWED_EXTRA_HOSTS` and re-run.
- **403 from proxy** → the requested host isn't in the allowlist.
  Add it to `ALLOWED_EXTRA_HOSTS`.

## Legal

You are responsible for how you use this. Only stream content you have
the right to access in your jurisdiction.