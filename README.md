# PornX11 Stremio/Nuvio Addon

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/tarcispera1074/pornx11-addon)

A self-hosted addon that pulls the catalog from `pornx11.com` via its WordPress
REST API and resolves each video to a directly playable stream by scraping the
article page and any embedded hosters (luluvido etc.), then relays it with the
`Referer` the CDN expects.

## Requirements

- Node.js **20.18.1 or newer** (the locked `cheerio` release requires it)
- A machine that can reach `pornx11.com` (any VPS, home server, or your laptop)

## Install & run

```bash
npm install
npm start
```

You'll see:

```
🚀 Addon running on port 7000
   Manifest: http://localhost:7000/manifest.json
   Health:   http://localhost:7000/healthz
```

## Install in Nuvio / Stremio

1. Open Nuvio (or Stremio).
2. Go to **Addons → Install from URL**.
3. Paste: `http://<your-machine-ip>:7000/manifest.json`
   - Same machine: `http://localhost:7000/manifest.json`
   - Phone over LAN: `http://192.168.1.42:7000/manifest.json`
   - Behind a reverse proxy: `https://your-domain/manifest.json`
4. The **PornX11 → Latest** catalog appears on Discover/Board.

## Endpoints

| Path | Purpose |
|------|---------|
| `/manifest.json` | Addon manifest (version is read from `package.json`) |
| `/healthz` | Uptime, cache sizes, proxy mode |
| `/catalog/movie/pornx11_latest.json` | Latest videos |
| `/catalog/movie/pornx11_latest/search=foo.json` | Search |
| `/catalog/movie/pornx11_latest/genre=Ullu%20app.json` | Filter by studio |
| `/catalog/movie/pornx11_latest/skip=25.json` | Pagination |
| `/meta/movie/pornx11:<url>.json` | Metadata |
| `/stream/movie/pornx11:<url>.json` | Stream list |
| `/proxy?url=…&referer=…` | Header-injecting proxy with m3u8 rewriting |
| `/debug` | Upstream API probe (token-gated if `DEBUG_TOKEN` is set) |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `7000` | HTTP port |
| `CF_WORKER_URL` | – | Serve playback through the Cloudflare Worker instead of `/proxy` |
| `ALLOWED_EXTRA_HOSTS` | – | Comma-separated extra media hosts the proxy may fetch |
| `PROXY_ALLOW_ANY` | `0` | `1` removes the host allowlist (**trusted/private use only**) |
| `DISABLE_JINA_FALLBACK` | `0` | `1` never sends URLs to `r.jina.ai` |
| `DEBUG_TOKEN` | – | When set, `/debug` requires `?token=…` |
| `CATALOG_TTL_MINUTES` | `5` | Catalog cache lifetime |
| `SITE_TIMEOUT_MS` | `15000` | Upstream request timeout |

## How it works

1. **Catalog** — hits the WordPress REST API at
   `pornx11.com/wp-json/wp/v2/posts?_embed=1` and reads the featured image.
2. **Stream** — fetches the article page, extracts candidates (JS
   `sources: [{file:...}]`, `<video><source>`, hoster iframes), then follows the
   hoster iframe to the final `.mp4` / `.m3u8`. Packed JavaScript is unpacked
   with a parser in `packer.js` — nothing from the page is ever executed.
3. **Proxy** — streams the media back with the correct `Referer`. HLS playlists
   have every segment/key URI rewritten through the proxy. If the CDN rejects an
   expired token, the embed is re-resolved once and the request retried, so
   resuming a long-paused video works.

## Security model

The proxy is **not an open relay**. Requests are refused unless the host passes
`allowlist.js`:

- loopback, private, link-local (including `169.254.169.254`), CGNAT and every
  IPv6 literal are rejected outright — so `http://[::1]/…` and
  `http://127.0.0.1/…` both fail;
- otherwise the host must be a known media host, a host from
  `ALLOWED_EXTRA_HOSTS`, or one the addon has itself seen in a resolved
  playlist.

Article URLs are also pinned to `pornx11.com`, so a crafted stream id cannot
make the server scrape arbitrary addresses.

## Troubleshooting

Run the diagnostic first — it walks the exact same path the addon does:

```bash
npm run diagnose
npm run diagnose -- https://pornx11.com/some-post/
```

- **Catalog is empty** → check `/healthz` and `/debug` (add `?token=` if
  configured). The server log prints a reason code such as
  `direct_http_403`, `jina_http_429`, or `unexpected_payload`.
- **Streams list is empty** → the log says which step failed:
  `no candidates` (player markup changed), `candidates found but none resolved`,
  or `packed script found but not unpacked`.
- **403 with `reason: host_not_allowed`** → the CDN is new. Add it:
  `ALLOWED_EXTRA_HOSTS="cdn.example.com"`. The blocked host is in the log line.
- **Video plays but stalls** → the m3u8 references a host outside the allowlist;
  same fix as above.
- **Everything empty after a site update** → extend `extractEmbedCandidates()`.

## Legal

You are responsible for how you use this. Only stream content you have the right
to access in your jurisdiction.
