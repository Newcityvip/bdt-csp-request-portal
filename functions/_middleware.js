const BACKEND_URL =
  "https://script.google.com/macros/s/AKfycbyanyavF31y_Z-q0PIjZkYJJCVZPmWXQgtJiuJh2KboaeHi4PSQwFpNqw8c7Lqn91vn/exec";

const BLOCKED_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Restricted | Ops Request Hub</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f4f7fb; color: #172033; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { width: min(480px, 100%); padding: 40px; background: #fff; border: 1px solid #e3e8ef; border-radius: 16px; box-shadow: 0 14px 40px rgba(16, 35, 61, 0.09); text-align: center; }
    .mark { display: grid; place-items: center; width: 48px; height: 48px; margin: 0 auto 20px; border-radius: 12px; background: #0b1b32; color: #fff; font-weight: 800; }
    .brand { margin: 0 0 24px; color: #526174; font-size: 14px; font-weight: 700; }
    h1 { margin: 0 0 14px; font-size: 28px; }
    p { margin: 0 0 10px; color: #697386; font-size: 15px; line-height: 1.6; }
    .contact { margin-top: 22px; padding-top: 20px; border-top: 1px solid #e3e8ef; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">OR</div>
    <p class="brand">Ops Request Hub</p>
    <h1>Access Restricted</h1>
    <p>This portal is available only from authorized networks.</p>
    <p>Your current network is not approved to access this service.</p>
    <p class="contact">Please contact an administrator if you believe access should be granted.</p>
  </main>
</body>
</html>`;

function blockedResponse() {
  return new Response(BLOCKED_PAGE, {
    status: 403,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function onRequest(context) {
  const visitorIp = context.request.headers.get("CF-Connecting-IP");

  if (!visitorIp) {
    return blockedResponse();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `${BACKEND_URL}?action=checkIp&ip=${encodeURIComponent(visitorIp)}`;
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return blockedResponse();
    }

    const data = await response.json();

    if (data?.ok === true && data?.allowed === true) {
      return context.next();
    }
  } catch {
    return blockedResponse();
  } finally {
    clearTimeout(timeout);
  }

  return blockedResponse();
}
