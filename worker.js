const ALLOWED_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request) {
    const cors = corsHeaders();
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    const incoming = new URL(request.url);
    if (incoming.pathname !== "/proxy") {
      return new Response("Use /proxy?url=<QUA release URL>", { status: 404, headers: cors });
    }

    const targetValue = incoming.searchParams.get("url");
    if (!targetValue) {
      return new Response("Missing url parameter", { status: 400, headers: cors });
    }

    let target;
    try {
      target = new URL(targetValue);
    } catch {
      return new Response("Invalid URL", { status: 400, headers: cors });
    }

    if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
      return new Response("Upstream host is not allowed", { status: 403, headers: cors });
    }

    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers: request.headers,
      redirect: "follow",
    });

    const headers = new Headers(cors);
    for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Cache-Control", "public, max-age=300");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
