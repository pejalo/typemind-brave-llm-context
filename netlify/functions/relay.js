/**
 * Netlify serverless function — CORS relay for the Brave LLM Context API.
 *
 * Lives in this repo at:  netlify/functions/relay.js
 * Deployed automatically when the repo is connected to Netlify
 * (free account, no build config needed).
 *
 * What it does:
 *  - Browsers (TypingMind) cannot call api.search.brave.com cross-origin,
 *    so they call THIS function instead.
 *  - It forwards the GET (and the X-Subscription-Token + X-Loc-* headers)
 *    to https://api.search.brave.com/res/v1/llm/context and returns
 *    Brave's status code and body, with permissive CORS headers.
 *  - Security: it only ever forwards to that one Brave path — a request
 *    with any other "u" target is rejected with 403.
 *
 * The API key is never stored here. It travels:
 *   browser -> your relay (in memory, milliseconds) -> Brave.
 */

const LOC_HEADERS = [
  "x-loc-lat", "x-loc-long", "x-loc-city",
  "x-loc-state", "x-loc-state-name", "x-loc-country", "x-loc-postal-code",
];

export default async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "x-subscription-token, accept, " + LOC_HEADERS.join(", "),
    "Cache-Control": "no-store",
  };

  // Answer the browser's CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "GET") {
    return new Response("Only GET is allowed", { status: 405, headers: cors });
  }

  const query = new URL(req.url).searchParams;
  const u = query.get("u");
  if (!u) {
    return new Response('Missing "u" parameter', { status: 400, headers: cors });
  }

  // Whitelist: only the Brave LLM Context endpoint may be forwarded.
  let target;
  try { target = new URL(u); } catch (e) {
    return new Response("Bad u parameter", { status: 400, headers: cors });
  }
  if (
    target.protocol !== "https:" ||
    target.hostname !== "api.search.brave.com" ||
    !target.pathname.startsWith("/res/v1/llm/context")
  ) {
    return new Response(
      "Blocked: this relay only forwards to the Brave LLM Context API",
      { status: 403, headers: cors }
    );
  }

  // Pass through any other query params (q, count, freshness, ...).
  for (const [k, v] of query) {
    if (k !== "u") target.searchParams.append(k, v);
  }

  // Forward the auth + location headers from the browser.
  const headers = { "Accept": "application/json" };
  const token = req.headers.get("x-subscription-token");
  if (token) headers["X-Subscription-Token"] = token;
  for (const h of LOC_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }

  let res;
  try {
    res = await fetch(target.toString(), { method: "GET", headers: headers });
  } catch (e) {
    return new Response("Relay could not reach Brave: " + e.message, {
      status: 502, headers: cors,
    });
  }

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: Object.assign({}, cors, {
      "Content-Type": res.headers.get("content-type") || "application/json",
    }),
  });
};
