# Deploying v1 (Cloudflare Pages)

v1 is a static site: the Vite build of `apps/web` plus the versioned data bundle in
`apps/web/public/data/<version>/`. No server, no API keys. Only `main` is deployed; the `v2`
branch is development only and must not be deployed.

## One-time setup (Git integration, recommended)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the GitHub
   repository.
2. Build settings:
   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Framework preset | None (Vite) |
   | Root directory | `apps/web` |
   | Build command | `pnpm build` |
   | Build output directory | `dist` |
   | Environment variables | `NODE_VERSION=22`, `PNPM_VERSION=9.15.9` |
3. **Settings → Builds → Branch control:** production branch `main`; preview deployments
   **None** (so pushes to `v2` are never deployed).
4. Every push to `main` deploys. The URL is `https://<project>.pages.dev`.

## What makes it work

- **SPA routes** (`/story/3`, `/watch`…): there is no top-level `404.html`, so Pages serves
  `index.html` for unknown paths.
- **Headers**: `apps/web/public/_headers` sets a strict CSP (`script-src 'self'`, no inline
  scripts, no eval), `nosniff`, and caching (immutable `/assets/*`, 1 h for `/data/*`). The local
  nginx image (`docker/web/Dockerfile`) sends the same CSP, so violations show up locally first.
- **Limits**: Pages allows 20,000 files and 25 MiB per file. The bundle is ~12 MB in ~190 files.

## Direct upload (alternative, no Git)

```bash
cd apps/web && pnpm build
npx --registry=https://registry.yarnpkg.com wrangler pages deploy   # reads wrangler.toml
```
`wrangler login` opens a browser once. (`registry.npmjs.org` times out on the team network; the
yarn mirror works.)

## Before the submission click

- Open the production URL in a private window: intro → dive → `/story/1` … `/story/9`, `/watch`,
  `/methods`, `/sources`; no console errors.
- Check a deep link (`/story/7`) loads directly.
