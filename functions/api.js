const UPSTREAM_TIMEOUT_MS = 25000;

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function onRequestPost(context) {
  const upstreamUrl = String(context.env.APPS_SCRIPT_URL || "").trim();
  if (!upstreamUrl) return jsonResponse({ ok: false, code: "UPSTREAM_UNAVAILABLE", error: "The service is not configured." }, 502);

  let body;
  try {
    body = await context.request.text();
    JSON.parse(body);
  } catch {
    return jsonResponse({ ok: false, code: "VALIDATION_ERROR", error: "The request body must be valid JSON." }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return jsonResponse({ ok: false, code: "UPSTREAM_UNAVAILABLE", error: "The service is temporarily unavailable." }, 502);
    const text = await response.text();
    try {
      JSON.parse(text);
      return new Response(text, { status: 200, headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    } catch {
      return jsonResponse({ ok: false, code: "INVALID_RESPONSE", error: "The service returned an invalid response." }, 502);
    }
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return jsonResponse({ ok: false, code: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE", error: timedOut ? "The service took too long to respond." : "The service is temporarily unavailable." }, timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
}

export function onRequestGet() {
  return jsonResponse({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Method not allowed." }, 405);
}
