// goodunluck.js — UI del módulo de recuperación. Analiza el archivo, exige motivo + declaración de
// propiedad, y según el rol ejecuta la acción; devuelve el archivo desbloqueado como descarga.
// Todo local (mismo origen). Sin emojis: iconos SVG.
import { montarChrome, setVersion, montarUsuario, esc } from "./chrome.js";

const $ = (s) => document.querySelector(s);
let archivo = null;        // File actual
let bytes = null;          // ArrayBuffer del archivo
let ultimo = null;         // último análisis

const ICO = {
  lock: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  open: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7-2.6"/></svg>',
  alert: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3z"/><path d="M12 9v4.5"/><path d="M12 17h.01"/></svg>',
};
const ICO_EYE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const FAMILIA = { office: "Documento Office", pdf: "PDF", zip: "Archivo ZIP", rar: "Archivo RAR" };
const PROT_LABEL = {
  sheetProtection: "protección de hoja", workbookProtection: "protección de estructura",
  documentProtection: "restricción de edición", writeProtection: "solo lectura",
  modifyVerifier: "protección de modificación", vbaProject: "contraseña de macros VBA",
};
const fmtBytes = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : n >= 1e3 ? Math.round(n / 1e3) + " KB" : (n || 0) + " B";

// Resumen legible de lo detectado, por familia.
function resumen(a) {
  if (a.familia === "office") {
    if (a.cifrado) return "Está cifrado con contraseña (hace falta la clave o recuperarla).";
    const p = (a.protecciones || []).map((x) => PROT_LABEL[x.tag] || x.tag);
    return p.length ? "Tiene: " + [...new Set(p)].join(", ") + "." : "No tiene restricciones.";
  }
  if (a.familia === "pdf") return a.cifrado
    ? (a.rc4_40 ? "Cifrado RC4 de 40 bits (llave corta)." : "Cifrado o con permisos bloqueados.")
    : "No tiene protección.";
  if (a.familia === "zip") return `Archivo ZIP con ${a.total || 0} elemento(s)${a.cifrado ? ", cifrado" : ""}.`;
  return "Archivo comprimido.";
}

// Listado del contenido del ZIP (visible sin la clave = fuga de metadatos).
function listadoZip(a) {
  const filas = (a.entradas || []).filter((e) => !e.dir).slice(0, 60)
    .map((e) => `<tr><td>${esc(e.nombre)}</td><td>${fmtBytes(e.tamano)}</td><td>${e.cifrado ? "cifrado" : "abierto"}</td></tr>`).join("");
  if (!filas) return "";
  return `<div class="gu-ziplist"><div class="dz-sub">Contenido visible sin la clave:</div>
    <div class="gu-tablewrap"><table class="gu-matrix"><thead><tr><th>Nombre</th><th>Tamaño</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></div></div>`;
}

async function init() {
  montarChrome();
  const me = await fetch("/api/me").then((r) => r.json()).catch(() => ({ auth: "local", autenticado: true }));
  setVersion(me.version);
  if (me.auth === "federado" && !me.autenticado) { $("#gate-login").classList.remove("hidden"); $("#zona").classList.add("hidden"); return; }
  montarUsuario(me);
  montarDropzone();
}

function montarDropzone() {
  const dz = $("#dropzone"), input = $("#file-input");
  dz.onclick = () => input.click();
  dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
  input.onchange = () => { if (input.files[0]) elegir(input.files[0]); };
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("hover"); };
  dz.ondragleave = () => dz.classList.remove("hover");
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("hover"); const f = [...(e.dataTransfer?.files || [])][0]; if (f) elegir(f); };
}

async function elegir(file) {
  archivo = file; bytes = await file.arrayBuffer();
  const panel = $("#panel");
  panel.innerHTML = `<p class="hint">Analizando ${esc(file.name)}…</p>`;
  try {
    const r = await fetch("/api/goodunluck/analizar", { method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name) }, body: bytes });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    ultimo = data;
    panel.innerHTML = renderPanel(data);
    cablearAcciones();
  } catch (e) { panel.innerHTML = `<p class="hint error">${esc(e.message)}</p>`; }
}

function renderPanel(a) {
  const desc = resumen(a);
  const lista = listadoZip(a);
  const puedeT1 = a.acciones.includes("quitar-restriccion");
  const puedeT2 = a.acciones.includes("descifrar-con-clave");
  const puedeT3 = a.acciones.includes("recuperar-clave");
  const nat = a.naturaleza || {};
  const badge = (n) => n ? `<span class="gu-badge ${n.tipo === "garantizada" || n.tipo === "instantanea" ? "b-ok" : n.tipo === "diccionario" ? "b-warn" : "b-mut"}">${esc(n.txt)}</span>` : "";
  if (!puedeT1 && !puedeT2 && !puedeT3) {
    return `<div class="gu-card"><div class="gu-top">${ICO.open}<strong>${esc(FAMILIA[a.familia] || a.familia)}</strong></div>
      <p class="gu-desc">${esc(desc)}</p>${lista}
      <p class="hint">Tu rol (${esc(a.rol)}) no tiene una acción disponible para este archivo${a.familia === "office" && a.cifrado ? " (requiere descifrar con clave, no habilitado para tu rol)" : ""}.</p></div>`;
  }
  return `<div class="gu-card">
    <div class="gu-top">${ICO.lock}<strong>${esc(FAMILIA[a.familia] || a.familia)}</strong></div>
    <p class="gu-desc">${esc(desc)}</p>${lista}
    <div class="gu-form">
      <label class="gu-lbl">Motivo de la recuperación</label>
      <textarea id="gu-motivo" rows="2" placeholder="Ej.: recuperar el balance que dejó bloqueado un empleado"></textarea>
      <label class="gu-check"><input type="checkbox" id="gu-propiedad" /> Declaro que la organización es dueña de este archivo o está autorizada a recuperarlo.</label>
      ${puedeT2 ? `<label class="gu-lbl">Contraseña (si la conocés)</label>
        <div class="pass-wrap"><input type="password" id="gu-pass" placeholder="clave de apertura" />
        <button type="button" class="pass-toggle" id="gu-pass-eye" aria-label="Mostrar/ocultar">${ICO_EYE}</button></div>` : ""}
      ${(puedeT1 || puedeT2) ? `<div class="gu-actions">
        ${puedeT1 ? `<span class="gu-act">${badge(nat["quitar-restriccion"])}<button id="gu-t1" class="btn">Quitar restricción</button></span>` : ""}
        ${puedeT2 ? `<span class="gu-act">${badge(nat["descifrar-con-clave"])}<button id="gu-t2" class="btn ${puedeT1 ? "ghost" : ""}">Descifrar con clave</button></span>` : ""}
      </div>` : ""}
      ${puedeT3 ? `<div class="gu-t3">
        <label class="gu-lbl">Recuperar la clave ${badge(nat["recuperar-clave"])}</label>
        <span class="dz-sub">Pegá una lista de candidatas (una por línea) o subí un archivo.</span>
        <textarea id="gu-wordlist" rows="3" placeholder="palabra1&#10;palabra2&#10;..."></textarea>
        <div class="gu-wl-row">
          <button type="button" id="gu-wl-file" class="btn ghost small">Subir wordlist…</button>
          <input type="file" id="gu-wl-input" accept=".txt,.lst,.dic,text/plain" hidden />
          <span id="gu-wl-info" class="hint"></span>
        </div>
        <button id="gu-t3-btn" class="btn ghost">Recuperar clave</button>
        <div id="gu-t3-prog" class="hint"></div>
      </div>` : ""}
      <div id="gu-out" class="gu-out"></div>
    </div></div>`;
}

function cablearAcciones() {
  const eye = $("#gu-pass-eye");
  if (eye) eye.onclick = () => { const i = $("#gu-pass"); i.type = i.type === "password" ? "text" : "password"; };
  const t1 = $("#gu-t1"), t2 = $("#gu-t2"), t3 = $("#gu-t3-btn");
  if (t1) t1.onclick = () => desbloquear(1);
  if (t2) t2.onclick = () => desbloquear(2);
  if (t3) t3.onclick = () => recuperar();
  // Subir una wordlist desde archivo → la carga en el textarea.
  const wlBtn = $("#gu-wl-file"), wlInput = $("#gu-wl-input");
  if (wlBtn && wlInput) {
    wlBtn.onclick = () => wlInput.click();
    wlInput.onchange = async () => {
      const f = wlInput.files[0]; if (!f) return;
      const txt = await f.text();
      $("#gu-wordlist").value = txt;
      const n = txt.split(/\r?\n/).filter((l) => l.trim()).length;
      $("#gu-wl-info").textContent = `${esc(f.name)} · ${n.toLocaleString("es")} palabras`;
    };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recuperar() {
  const out = $("#gu-out"), prog = $("#gu-t3-prog");
  const wordlist = ($("#gu-wordlist")?.value || "").trim();
  if (!wordlist) { out.innerHTML = `<p class="hint error">Pegá una lista de candidatas.</p>`; return; }
  const motivo = $("#gu-motivo")?.value || "", propiedad = $("#gu-propiedad")?.checked;
  out.innerHTML = ""; prog.textContent = "Enviando…";
  try {
    const r = await fetch("/api/goodunluck/crack", { method: "POST", body: bytes, headers: {
      "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(archivo.name),
      "X-Wordlist": encodeURIComponent(wordlist), "X-Motivo": encodeURIComponent(motivo), "X-Propiedad": propiedad ? "1" : "0" } });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    await poll(data.jobId, prog, out);
  } catch (e) { prog.textContent = ""; out.innerHTML = `<p class="hint error">${esc(e.message)}</p>`; }
}

async function poll(id, prog, out) {
  for (let i = 0; i < 100000; i++) {
    const est = await fetch(`/api/goodunluck/job/${id}`).then((r) => r.json()).catch(() => null);
    if (!est) { prog.textContent = ""; out.innerHTML = `<p class="hint error">Se perdió el job.</p>`; return; }
    if (est.estado === "corriendo") { prog.textContent = `Probando ${est.progreso}/${est.total}…`; await sleep(400); continue; }
    prog.textContent = "";
    if (est.estado === "ok") {
      const motor = est.motor === "john" ? "John" : est.motor === "js" ? "diccionario" : "";
      let msg = `Clave recuperada: <strong>${esc(est.password)}</strong>${motor ? ` <span class="c-mut">(${motor})</span>` : ""}.`;
      if (est.nombreSalida) {
        const blob = await fetch(`/api/goodunluck/job/${id}/archivo`).then((r) => r.blob());
        descargar(blob, est.nombreSalida);
        msg += ` Se descargó <strong>${esc(est.nombreSalida)}</strong>.`;
      }
      out.innerHTML = `<p class="ok-line">${ICO.open}<span>${msg}</span></p>`;
    } else {
      out.innerHTML = `<p class="hint error">${esc(est.error || "No se recuperó la clave con esa lista.")}</p>`;
    }
    return;
  }
}

async function desbloquear(tier) {
  const out = $("#gu-out");
  const motivo = $("#gu-motivo")?.value || "";
  const propiedad = $("#gu-propiedad")?.checked;
  const password = $("#gu-pass")?.value || "";
  out.innerHTML = `<p class="hint">Procesando…</p>`;
  try {
    const r = await fetch("/api/goodunluck/desbloquear", { method: "POST", body: bytes, headers: {
      "Content-Type": "application/octet-stream",
      "X-Filename": encodeURIComponent(archivo.name), "X-Tier": String(tier),
      "X-Motivo": encodeURIComponent(motivo), "X-Propiedad": propiedad ? "1" : "0",
      "X-Password": encodeURIComponent(password),
    } });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Error ${r.status}`); }
    const blob = await r.blob();
    const nombre = decodeURIComponent(r.headers.get("X-Filename") || "archivo-desbloqueado");
    descargar(blob, nombre);
    out.innerHTML = `<p class="ok-line">${ICO.open}<span>Listo. Se descargó <strong>${esc(nombre)}</strong>.</span></p>`;
  } catch (e) { out.innerHTML = `<p class="hint error">${esc(e.message)}</p>`; }
}

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

init();
