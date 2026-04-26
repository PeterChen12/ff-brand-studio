# ff-brand-studio-proxy

Tiny Cloudflare Worker that routes `creatorain.com/product-image-generation/*` to the staging dashboard at `https://staging.d1a431ll6nyfk4.amplifyapp.com/`.

## Why

ff-brand-studio is a fully independent microservice. The only thing it shares with creatorain is a URL prefix — no shared code, no shared database, no shared deploy. This proxy is the entire integration: ~50 lines of Worker code that's disposable. Rip it out and creatorain.com is unaffected.

## Architecture

```
client → creatorain.com/product-image-generation/foo
       → CF Worker `ff-brand-studio-proxy`
       → strips /product-image-generation prefix
       → fetches https://staging.d1a431ll6nyfk4.amplifyapp.com/foo
       → returns response
```

## Deploy

```bash
cd apps/proxy-worker
export CLOUDFLARE_EMAIL=...
export CLOUDFLARE_API_KEY=...
npx wrangler deploy
```

The route binding in `wrangler.toml` requires creatorain.com to be on Cloudflare DNS. If it isn't, `wrangler deploy` will fail with a zone-not-found error and the integration must use a different mechanism (CloudFront or Amplify rewrite — see V2_OPTIMIZATION_PLAN.md §Phase D D3).

## What this proxy does NOT do

- Auth (anyone with the URL hits the dashboard)
- Caching (relies on Amplify's edge caching upstream)
- Rate limiting
- Path rewriting beyond the prefix strip
- Cookies/sessions (passed through)

If any of these become required, add them as separate logic — keep this file tiny so the boundary stays visible.
