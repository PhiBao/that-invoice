/**
 * Pass a request to the Rust API and stream the answer back untouched.
 *
 * The next.config rewrite is fine for ordinary JSON, but it buffers (and compresses) streamed responses, so a
 * server-sent-events stream arrives all at once at the end. Route handlers that return the upstream body directly
 * keep it a live stream.
 */
export const API = process.env.API_URL ?? "http://127.0.0.1:8787";

export async function pipe(req: Request, path: string): Promise<Response> {
  const upstream = await fetch(`${API}${path}`, {
    method: req.method,
    headers: { accept: req.headers.get("accept") ?? "*/*", "content-type": req.headers.get("content-type") ?? "application/json" },
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
    // never buffer, never cache
    cache: "no-store",
    signal: req.signal,
  });
  const headers = new Headers();
  for (const k of ["content-type", "cache-control"]) {
    const v = upstream.headers.get(k);
    if (v) headers.set(k, v);
  }
  // Tell proxies in front of us (Fly, nginx) not to hold the stream back, and not to compress it.
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("x-accel-buffering", "no");
  return new Response(upstream.body, { status: upstream.status, headers });
}
