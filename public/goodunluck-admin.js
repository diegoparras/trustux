// goodunluck-admin.js — Panel del superadmin: matriz rol→capacidad, salvaguardas, cracking y
// auditoría. Guarda en config/goodunluck.json vía PUT /api/goodunluck/config.
import { montarChrome, setVersion, montarUsuario, esc } from "./chrome.js";

const $ = (s) => document.querySelector(s);
const FORMATOS = ["office", "pdf", "zip", "rar"];
const F_LABEL = { office: "Office", pdf: "PDF", zip: "ZIP", rar: "RAR" };
let cfg = null;

async function init() {
  montarChrome();
  const me = await fetch("/api/me").then((r) => r.json()).catch(() => ({ auth: "local", autenticado: true }));
  setVersion(me.version); montarUsuario(me);
  cfg = await fetch("/api/goodunluck/estado").then((r) => r.json()).catch(() => null);
  if (!cfg) { $("#admin").innerHTML = `<p class="hint error">No se pudo cargar la configuración.</p>`; return; }
  render();
  cargarAuditoria();
}

function checkbox(checked, attrs = "") { return `<input type="checkbox" ${checked ? "checked" : ""} ${attrs} />`; }

function render() {
  const roles = Object.keys(cfg.roles);
  const filas = roles.map((rol) => {
    const c = cfg.roles[rol] || { tiers: [], formatos: [] };
    const t = (n) => checkbox(c.tiers?.includes(n), `data-rol="${esc(rol)}" data-tier="${n}"`);
    const todos = c.formatos?.includes("*");
    const fmts = `<label class="gu-f">${checkbox(todos, `data-rol="${esc(rol)}" data-fmt="*"`)} todos</label>` +
      FORMATOS.map((f) => `<label class="gu-f">${checkbox(!todos && c.formatos?.includes(f), `data-rol="${esc(rol)}" data-fmt="${f}"`)} ${F_LABEL[f]}</label>`).join("");
    return `<tr><th scope="row">${esc(rol)}</th>
      <td>${t(1)}</td><td>${t(2)}</td><td>${t(3)}</td><td class="gu-fmts">${fmts}</td></tr>`;
  }).join("");

  const sg = cfg.safeguards || {}, cr = cfg.cracking || {};
  $("#admin").innerHTML = `
    <section class="card gu-adm">
      <h2 class="gu-h">Matriz de acceso por rol</h2>
      <p class="dz-sub">Qué tiers y formatos puede usar cada rol. En modo local, el rol lo fija <code>GOODUNLUCK_LOCAL_ROLE</code>.</p>
      <div class="gu-tablewrap"><table class="gu-matrix">
        <thead><tr><th>Rol</th><th>Quitar restricción<br><span class="th-sub">Tier 1</span></th>
          <th>Descifrar con clave<br><span class="th-sub">Tier 2</span></th>
          <th>Recuperar clave<br><span class="th-sub">Tier 3</span></th><th>Formatos</th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>
    </section>

    <section class="card gu-adm">
      <h2 class="gu-h">Salvaguardas</h2>
      <label class="gu-sw">${checkbox(sg.requireReason, `id="sg-reason"`)} Exigir <strong>motivo</strong> de la recuperación</label>
      <label class="gu-sw">${checkbox(sg.requireOwnership, `id="sg-owner"`)} Exigir <strong>declaración de propiedad</strong> del archivo</label>
      <label class="gu-sw">${checkbox(sg.audit !== false, `id="sg-audit"`)} <strong>Auditar</strong> cada operación (append-only)</label>
    </section>

    <section class="card gu-adm">
      <h2 class="gu-h">Recuperación de claves (cracking)</h2>
      <p class="dz-sub">Apagado, nadie puede recuperar claves aunque su rol tenga Tier 3.</p>
      <label class="gu-sw">${checkbox(cr.enabled, `id="cr-enabled"`)} Permitir <strong>recuperación de claves</strong> (Tier 3)</label>
      <label class="gu-lbl">Tope por trabajo (minutos)</label>
      <input type="number" id="cr-min" value="${Number(cr.maxJobMinutes) || 120}" min="1" style="max-width:120px" />
    </section>

    <div class="gu-actions"><button id="gu-save" class="btn">Guardar cambios</button><span id="gu-save-msg" class="hint"></span></div>

    <section class="card gu-adm">
      <h2 class="gu-h">Auditoría</h2>
      <div id="gu-audit" class="gu-tablewrap"><p class="hint">Cargando…</p></div>
    </section>`;

  // "todos" y formatos individuales son mutuamente excluyentes por rol.
  $("#admin").querySelectorAll('input[data-fmt="*"]').forEach((cb) => {
    cb.onchange = () => {
      const rol = cb.dataset.rol;
      $("#admin").querySelectorAll(`input[data-rol="${CSS.escape(rol)}"][data-fmt]:not([data-fmt="*"])`).forEach((x) => { x.disabled = cb.checked; if (cb.checked) x.checked = false; });
    };
    cb.onchange();
  });
  $("#gu-save").onclick = guardar;
}

async function guardar() {
  const roles = {};
  Object.keys(cfg.roles).forEach((rol) => {
    const tiers = [1, 2, 3].filter((n) => $(`#admin input[data-rol="${CSS.escape(rol)}"][data-tier="${n}"]`)?.checked);
    const todos = $(`#admin input[data-rol="${CSS.escape(rol)}"][data-fmt="*"]`)?.checked;
    const formatos = todos ? ["*"] : FORMATOS.filter((f) => $(`#admin input[data-rol="${CSS.escape(rol)}"][data-fmt="${f}"]`)?.checked);
    roles[rol] = { tiers, formatos };
  });
  const nuevo = {
    roles,
    safeguards: { requireReason: $("#sg-reason").checked, requireOwnership: $("#sg-owner").checked, audit: $("#sg-audit").checked },
    cracking: { enabled: $("#cr-enabled").checked, maxJobMinutes: Number($("#cr-min").value) || 120 },
  };
  const msg = $("#gu-save-msg");
  msg.textContent = "Guardando…";
  try {
    const r = await fetch("/api/goodunluck/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nuevo) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Error ${r.status}`); }
    cfg = await r.json();
    msg.textContent = "Guardado.";
  } catch (e) { msg.innerHTML = `<span class="c-bad">${esc(e.message)}</span>`; }
}

async function cargarAuditoria() {
  const cont = $("#gu-audit"); if (!cont) return;
  try {
    const { audit = [] } = await fetch("/api/goodunluck/audit").then((r) => r.json());
    if (!audit.length) { cont.innerHTML = `<p class="hint">Sin operaciones registradas.</p>`; return; }
    const filas = audit.slice(0, 100).map((a) => `<tr>
      <td>${esc((a.ts || "").replace("T", " ").slice(0, 19))}</td><td>${esc(a.rol || a.usuario || "")}</td>
      <td>${esc(a.archivo || "")}</td><td>${esc(a.familia || "")}</td><td>T${esc(a.tier || "")}</td>
      <td class="${a.resultado === "ok" ? "c-ok" : "c-bad"}">${esc(a.resultado || "")}${a.motor ? " · " + esc(a.motor) : ""}</td></tr>`).join("");
    cont.innerHTML = `<table class="gu-matrix"><thead><tr><th>Fecha</th><th>Rol</th><th>Archivo</th><th>Tipo</th><th>Tier</th><th>Resultado</th></tr></thead><tbody>${filas}</tbody></table>`;
  } catch { cont.innerHTML = `<p class="hint">No se pudo cargar la auditoría (¿tu rol tiene acceso?).</p>`; }
}

init();
