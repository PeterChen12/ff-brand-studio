/**
 * ff-brand-studio subpath proxy on creatorain.com.
 *
 * Routes `creatorain.com/product-image-generation/*` to the staging Amplify
 * dashboard. Keeps ff-brand-studio a fully independent microservice — no
 * code is embedded in the creatorain landing repo, no shared deps, no
 * shared deploy pipeline. Only the URL prefix is shared.
 *
 * Disposable. If we ever rip this out, creatorain.com is unaffected.
 */

const TARGET_HOST = "staging.d1a431ll6nyfk4.amplifyapp.com";
const PATH_PREFIX = "/product-image-generation";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Only handle requests under the path prefix; anything else returns 404
    // so this Worker never accidentally captures other creatorain.com routes.
    if (!url.pathname.startsWith(PATH_PREFIX)) {
      return new Response("not the proxy's path", { status: 404 });
    }

    // Strip the prefix when forwarding upstream.
    // /product-image-generation/costs.html → /costs.html
    // /product-image-generation/         → /
    const upstreamPath = url.pathname.slice(PATH_PREFIX.length) || "/";
    const upstreamUrl = `https://${TARGET_HOST}${upstreamPath}${url.search}`;

    // Forward the request, preserving method + body + most headers.
    // Strip Cloudflare-managed headers that would confuse upstream.
    const reqHeaders = new Headers(request.headers);
    reqHeaders.delete("host");
    reqHeaders.delete("cf-connecting-ip");
    reqHeaders.delete("cf-ipcountry");
    reqHeaders.delete("cf-ray");
    reqHeaders.delete("cf-visitor");
    reqHeaders.set("x-forwarded-host", url.host);
    reqHeaders.set("x-forwarded-prefix", PATH_PREFIX);

    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: reqHeaders,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    let upstreamResp: Response;
    try {
      upstreamResp = await fetch(upstreamRequest);
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "proxy upstream failed",
          target: upstreamUrl,
          detail: err instanceof Error ? err.message : String(err),
        }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    // Pass response through. Drop edge headers that would cause double-caching
    // or content-length mismatches when streamed back through Cloudflare.
    const respHeaders = new Headers(upstreamResp.headers);
    respHeaders.delete("content-length");
    respHeaders.delete("content-encoding");

    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: respHeaders,
    });
  },
};
