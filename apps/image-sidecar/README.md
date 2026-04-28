# @ff/image-sidecar

Node + sharp companion service for the FF Brand Studio Cloudflare
Worker. The Worker calls these endpoints over HTTPS with HMAC-SHA256
of `${ts}.${sha256(body)}`. R2 keys are the only payload — the
sidecar reads/writes R2 itself via the AWS S3 SDK against R2's
S3-compatible endpoint.

## Why a sidecar?

The Worker runtime is a V8 isolate. `sharp` is a native Node module
bound to libvips and cannot load there even with `nodejs_compat`. See
`docs/adr/0003-image-pipeline-runtime.md` in the parent monorepo for
the full reasoning.

## Endpoints

| Endpoint | Op | Cost |
|---|---|---|
| `POST /derive` | Kind-aware crops: studio + 3 detail crops | CPU only |
| `POST /composite-text` | SVG-overlay infographic on a hero | CPU only |
| `POST /banner-extend` | 16:9 hero with brand-color gradient | CPU only |
| `POST /force-white` | Snap near-white pixels to #ffffff | CPU only |
| `GET /healthz` | Liveness probe (no auth) | — |

## Env

| Var | Required | Notes |
|---|---|---|
| `IMAGE_SIDECAR_SECRET` | yes | shared with Worker; HMAC key |
| `R2_ACCESS_KEY_ID` | yes | same value the Worker uses for SigV4 |
| `R2_SECRET_ACCESS_KEY` | yes | |
| `R2_ACCOUNT_ID` | no | defaults to `40595082727ca8581658c1f562d5f1ff` |
| `R2_BUCKET` | no | defaults to `ff-brand-studio-assets` |
| `PORT` | no | defaults to `8787` |

## Run locally

```
pnpm --filter @ff/image-sidecar install
pnpm --filter @ff/image-sidecar dev
```

## Deploy (Render free tier)

1. Push the monorepo. Render's Render-Web-Service yaml below works
   out of the box — point `rootDir` at `apps/image-sidecar`.
2. Add the env vars above as secrets.
3. The service exposes a public URL — set `IMAGE_SIDECAR_URL` on the
   Worker via `wrangler secret put`.

```yaml
# render.yaml (excerpt)
services:
  - type: web
    name: ff-image-sidecar
    runtime: docker
    rootDir: apps/image-sidecar
    healthCheckPath: /healthz
    plan: free
```

## Smoke

```bash
curl https://<sidecar>/healthz   # {"ok":true,...}
```
