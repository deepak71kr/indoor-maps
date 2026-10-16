# Deploying (free): GitHub Pages

> **In simple words:** every push to `main` that passes CI is published automatically. It costs nothing and needs no servers.

| What | Address |
| --- | --- |
| Visitor app (what QR stickers open) | https://deepak71kr.github.io/indoor-maps/ |
| Big demo campus at the main gate | https://deepak71kr.github.io/indoor-maps/?site=demo-mesra&at=MAIN-GATE |
| Demo hospital | https://deepak71kr.github.io/indoor-maps/?at=G-MAIN |
| Demo college (small campus) | https://deepak71kr.github.io/indoor-maps/?site=demo-campus&at=GATE |
| Map editor | https://deepak71kr.github.io/indoor-maps/editor/ |

## How it works

- `.github/workflows/deploy.yml` runs **after the CI workflow succeeds on `main`** and builds the exact commit CI tested. It can also be started by hand (Actions → Deploy → Run workflow).
- The visitor app is built with `BASE_PATH=/indoor-maps/` (it lives in a sub-folder on Pages). Map files, the service worker and the offline cache all follow that base path; locally it stays `/`.
- The editor is built into `/indoor-maps/editor/` with `VITE_VISITOR_URL` set, so **Print QR** makes stickers that open the public visitor app.
- Maps are the files in `samples/` (copied into the build). The editor's "Open on phone" publishing works with the local dev server only; publishing your own maps online comes with v0's publish pipeline.

## Why GitHub Pages (for now)

- Free, no new accounts, a worldwide CDN, HTTPS (needed for the camera QR scanner and the service worker).
- The app is fully static: no server code at all.
- Limits: files are served gzip-compressed (not brotli), and the cache time is fixed at 10 minutes. The service worker makes repeat visits instant and offline anyway.
- **Later:** Cloudflare Pages (also free) for brotli, custom cache headers and a custom domain such as `innermap.in`.

## One-time setup (repo owner)

GitHub → the repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**. Then push, or run the Deploy workflow by hand.
