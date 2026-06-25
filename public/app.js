// app.js — UI del standalone de Trustux. Sube el documento a /api/verificar y pinta el
// veredicto con iconos SVG (sin emojis). La verificación pasa en el servidor local (firma-core).
const $ = (s) => document.querySelector(s);

// Iconos SVG inline. Heredan color por currentColor desde la clase de estado.
const ICO = {
  check: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  alert: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3z"/><path d="M12 9v4.5"/><path d="M12 17h.01"/></svg>',
  dot: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="3"/></svg>',
  shield: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4 3 7 7 8 4-1 7-4 7-8V6l-7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
};
const SEM = {
  valida:      { ico: ICO.shield, cls: "c-ok", txt: "Firma válida" },
  observada:   { ico: ICO.alert, cls: "c-warn", txt: "Firma con observaciones" },
  invalida:    { ico: ICO.x, cls: "c-bad", txt: "Firma inválida" },
  "sin-firma": { ico: ICO.dot, cls: "c-mut", txt: "El documento no tiene firma digital" },
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Versión: del /api/me o, como respaldo, del <meta trustux-version>. Va al "Acerca de".
function setVersion(v) {
  const meta = document.querySelector('meta[name="trustux-version"]')?.content || "";
  const raw = v || (/^\d/.test(meta) ? meta : "");
  $("#ver").textContent = raw ? "v" + raw : "—";
}

// Menú kebab del header: tema, "Acerca de" y (si hay sesión) cerrar sesión. Todo el
// chrome vive acá adentro. Click afuera o Escape lo cierra.
function montarChrome() {
  const menu = $("#hdr-menu"), btn = $("#btn-menu");
  btn.onclick = (e) => { e.stopPropagation(); const open = menu.classList.toggle("hidden") === false; btn.setAttribute("aria-expanded", String(open)); };
  menu.addEventListener("click", (e) => { if (e.target.closest(".menu-item")) menu.classList.add("hidden"); });
  document.addEventListener("click", (e) => { if (!menu.classList.contains("hidden") && !menu.contains(e.target) && !btn.contains(e.target)) menu.classList.add("hidden"); });

  $("#btn-theme").onclick = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    if (dark) { delete document.documentElement.dataset.theme; localStorage.setItem("trustux.theme", "light"); }
    else { document.documentElement.dataset.theme = "dark"; localStorage.setItem("trustux.theme", "dark"); }
  };

  // "Acerca de" → modal canónico (.modal-back / .modal-card).
  const modal = $("#about-modal");
  const cerrar = () => modal.classList.add("hidden");
  $("#btn-acerca").onclick = () => modal.classList.remove("hidden");
  $("#about-x").onclick = cerrar;
  modal.addEventListener("click", (e) => { if (e.target === modal) cerrar(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") { cerrar(); menu.classList.add("hidden"); } });
}

async function init() {
  montarChrome();
  const me = await fetch("/api/me").then((r) => r.json()).catch(() => ({ auth: "local", autenticado: true }));
  setVersion(me.version);
  // Federado y sin sesión → mostrar login, ocultar la zona de subida.
  if (me.auth === "federado" && !me.autenticado) {
    $("#gate-login").classList.remove("hidden");
    $("#zona").classList.add("hidden");
    return;
  }
  // Hay sesión federada: el usuario y "Cerrar sesión" van al menú (.menu-user).
  if (me.usuario) {
    const mu = $("#menu-user");
    mu.innerHTML = `${esc(me.usuario.email)} · <span class="rol">${esc(me.usuario.role || "")}</span>`;
    mu.hidden = false;
    $("#btn-logout").hidden = false;
    $("#menu-sep-logout").hidden = false;
    $("#btn-logout").onclick = () => { location.href = "/logout"; };
  }
  montarDropzone();
}

function montarDropzone() {
  const dz = $("#dropzone"), input = $("#file-input");
  dz.onclick = () => input.click();
  dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
  input.onchange = () => { if (input.files[0]) verificar(input.files[0]); };
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("hover"); };
  dz.ondragleave = () => dz.classList.remove("hover");
  dz.ondrop = (e) => {
    e.preventDefault(); dz.classList.remove("hover");
    const f = [...(e.dataTransfer?.files || [])][0];
    if (f) verificar(f);
  };
}

async function verificar(file) {
  const out = $("#resultado");
  out.innerHTML = `<p class="hint">Verificando ${esc(file.name)}…</p>`;
  try {
    const buf = await file.arrayBuffer();
    const r = await fetch("/api/verificar", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: buf });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    out.innerHTML = render(file.name, data);
  } catch (e) {
    out.innerHTML = `<p class="hint error">${esc(e.message)}</p>`;
  }
}

function linea(ok, okTxt, malTxt) {
  return ok
    ? `<li class="c-ok">${ICO.check}<span>${esc(okTxt)}</span></li>`
    : `<li class="c-bad">${ICO.x}<span>${esc(malTxt)}</span></li>`;
}
function nota(txt) { return `<li class="c-mut">${ICO.dot}<span>${esc(txt)}</span></li>`; }

function render(nombre, { firmas = [], global, tipo }) {
  const g = SEM[global] || SEM["sin-firma"];
  const cab = `<div class="vered ${g.cls}">${g.ico}<div><strong>${esc(g.txt)}</strong>
    <div class="vered-meta">${esc(nombre)} · ${esc(tipo || "")}</div></div></div>`;
  if (!firmas.length) return cab;

  const cards = firmas.map((f) => {
    const s = SEM[f.estado] || SEM.observada;
    const fr = f.firmante || {};
    const ident = [fr.nombre || "Firmante desconocido", fr.cuit ? `CUIT ${fr.cuit}` : null, fr.rol || null].filter(Boolean).join(" · ");
    const rev = f.revocacion || {};
    const revLinea = rev.revocado
      ? `<li class="c-bad">${ICO.x}<span>certificado revocado</span></li>`
      : (rev.metodo === "no-verificada" ? nota("revocación no verificada (offline)")
        : `<li class="c-ok">${ICO.check}<span>certificado vigente</span></li>`);
    const extra = `algoritmo ${f.algoritmo || "—"}`
      + (f.selloTiempo?.presente ? " · con sello de tiempo" : "")
      + (f.firmadoEl ? " · firmado " + f.firmadoEl.slice(0, 10) : "");
    const obs = (f.observaciones || []).filter(Boolean).map((o) => `<li>${esc(o)}</li>`).join("");
    return `<div class="card firma">
      <div class="firma-top ${s.cls}">${s.ico}<strong>${esc(s.txt)}</strong></div>
      <div class="firma-ident">${esc(ident)}</div>
      <ul class="detalle">
        ${linea(!!f.integridad?.ok, "no se modificó tras firmar", "modificado tras firmar")}
        ${linea(!!f.cadena?.confiable, f.cadena?.raiz || "cadena hasta una raíz confiable", "no llega a una raíz confiable")}
        ${revLinea}
        ${nota(extra)}
      </ul>
      ${obs ? `<ul class="obs">${obs}</ul>` : ""}
    </div>`;
  }).join("");
  return cab + cards;
}

init();
