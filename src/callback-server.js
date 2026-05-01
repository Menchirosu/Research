import http from "node:http";
import { URL } from "node:url";

const port = 8787;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/uninstall" || url.pathname === "/delete") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      console.log(`THREADS_${url.pathname.slice(1).toUpperCase()}_CALLBACK`, body || "(empty)");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (url.pathname !== "/callback") {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (code) {
    console.log(`THREADS_AUTH_CODE=${code}`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Threads OAuth Complete</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 32px; line-height: 1.5; }
      code { background: #f3f4f6; padding: 4px 6px; border-radius: 4px; word-break: break-all; display: inline-block; }
    </style>
  </head>
  <body>
    <h1>Threads OAuth callback received</h1>
    <p>Copy this code and use it with <code>node src/cli.js auth exchange --code=...</code></p>
    <p><code>${escapeHtml(code)}</code></p>
  </body>
</html>`);
    return;
  }

  res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Threads OAuth Error</title></head>
  <body>
    <h1>Threads OAuth error</h1>
    <p>${escapeHtml(error ?? "unknown_error")}</p>
    <p>${escapeHtml(errorDescription ?? "No description provided.")}</p>
  </body>
</html>`);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Threads callback server listening on http://127.0.0.1:${port}/callback`);
});

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
