// index.js — Servidor del standalone de Trustux. Sirve la UI estática (public/) y expone
// /api/verificar, que recibe un PDF o XML firmado, lo verifica con firma-core y devuelve el
// veredicto. El documento NO se persiste; la única salida externa posible es el login federado
// con Lockatus (OIDC), detrás del flag AUTH_MODE (default "local" → sin login, single-user).
import http from "node:http";
import { readFile, readFileSync as readSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verificarDocumento, trustInfo } from "./verificar.js";
import { createLockatusClient } from "../client/lockatus-client.mjs";

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));
const PUBLIC = join(ROOT, "public");
const VERSION = (() => { try { return JSON.parse(readSync(join(ROOT, "package.json"), "utf8")).version || ""; } catch { return ""; } })();
const PORT = Number(process.env.PORT) || 8092;

// --- Federación opcional con Lockatus (SSO de la suite). Apagada por defecto. ---
const AUTH = process.env.AUTH_MODE === "federado" ? "federado" : "local";
const lk = AUTH === "federado" ? createLockatusClient({
  issuer: process.env.LOCKATUS_ISSUER || "http://localhost:8081",
  clientId: process.env.CLIENT_ID || "trustux",
  redirectUri: process.env.REDIRECT_URI || `http://localhost:${PORT}/callback`,
  secret: process.env.TRUSTUX_SECRET || "trustux-dev-secret-cambiar",
  postLogin: "/",
}) : null;
const usuario = (req) => (lk ? lk.getUser(req) : { local: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };

const json = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};
const readRaw = (req, maxBytes = 30e6) => new Promise((resolve, reject) => {
  const chunks = []; let total = 0, abortado = false;
  req.on("data", (c) => { total += c.length; if (total > maxBytes) { abortado = true; req.destroy(); reject(new Error("archivo demasiado grande (máx 30 MB)")); } else chunks.push(c); });
  req.on("end", () => { if (!abortado) resolve(Buffer.concat(chunks)); });
  req.on("error", reject);
});

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const m = req.method;
  try {
    // --- Login federado (solo si AUTH_MODE=federado) ---
    if (lk) {
      if (path === "/login") return lk.beginLogin(req, res);
      if (path === "/callback") return void lk.handleCallback(req, res);
      if (path === "/logout") return lk.logout(req, res);
    }

    // --- API ---
    if (path === "/api/me") {
      const u = usuario(req);
      return json(res, 200, { auth: AUTH, autenticado: !!u, usuario: u && !u.local ? { email: u.email, role: u.role } : null, raices: trustInfo().length, version: VERSION });
    }
    if (path === "/api/verificar" && m === "POST") {
      if (lk && !lk.getUser(req)) return json(res, 401, { error: "Iniciá sesión con Lockatus para verificar." });
      let buf;
      try { buf = await readRaw(req); } catch (e) { return json(res, 413, { error: e.message }); }
      if (!buf.length) return json(res, 400, { error: "Documento vacío." });
      try {
        const r = await verificarDocumento(buf);
        return json(res, 200, r);
      } catch (e) {
        return json(res, e.code === "formato" ? 415 : 422, { error: e.message });
      }
    }

    // --- Estático (solo public/) ---
    const file = normalize(join(PUBLIC, path === "/" ? "/index.html" : path));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("forbidden"); }
    readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("not found"); }
      if (path === "/" || path === "/index.html") {
        data = Buffer.from(data.toString("utf8").replace(/__TRUSTUX_VERSION__/g, VERSION).replace(/__AUTH_MODE__/g, AUTH), "utf8");
      }
      res.writeHead(200, {
        "Content-Type": MIME[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        // Defensa en profundidad: todo propio, sin framing, sin exfiltración a hosts externos.
        "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
          "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      });
      res.end(data);
    });
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("error");
  }
});

server.listen(PORT, () => {
  console.log(`Trustux ${VERSION} en http://localhost:${PORT}  ·  auth: ${AUTH}  ·  raíces de confianza: ${trustInfo().length}`);
});
