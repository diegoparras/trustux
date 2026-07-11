// chrome.js — Cromo compartido de las páginas de Trustux (design system Escriba): menú kebab,
// toggle de tema, modal "Acerca de", versión y bloque de usuario federado. Reutilizable entre
// index (verificación) y goodunluck (recuperación) para no duplicar el wiring.
const $ = (s) => document.querySelector(s);

export function setVersion(v) {
  const meta = document.querySelector('meta[name="trustux-version"]')?.content || "";
  const raw = v || (/^\d/.test(meta) ? meta : "");
  const el = $("#ver"); if (el) el.textContent = raw ? "v" + raw : "—";
}

export function montarChrome() {
  const menu = $("#hdr-menu"), btn = $("#btn-menu");
  if (!menu || !btn) return;
  btn.onclick = (e) => { e.stopPropagation(); const open = menu.classList.toggle("hidden") === false; btn.setAttribute("aria-expanded", String(open)); };
  menu.addEventListener("click", (e) => { if (e.target.closest(".menu-item")) menu.classList.add("hidden"); });
  document.addEventListener("click", (e) => { if (!menu.classList.contains("hidden") && !menu.contains(e.target) && !btn.contains(e.target)) menu.classList.add("hidden"); });

  $("#btn-theme").onclick = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    if (dark) { delete document.documentElement.dataset.theme; localStorage.setItem("trustux.theme", "light"); }
    else { document.documentElement.dataset.theme = "dark"; localStorage.setItem("trustux.theme", "dark"); }
  };

  const modal = $("#about-modal");
  if (modal) {
    const cerrar = () => modal.classList.add("hidden");
    $("#btn-acerca").onclick = () => modal.classList.remove("hidden");
    $("#about-x").onclick = cerrar;
    modal.addEventListener("click", (e) => { if (e.target === modal) cerrar(); });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") { cerrar(); menu.classList.add("hidden"); } });
  }
}

// Bloque de usuario + "Cerrar sesión" (solo en modo federado con sesión).
export function montarUsuario(me) {
  if (!me?.usuario) return;
  const mu = $("#menu-user");
  if (mu) { mu.innerHTML = `${esc(me.usuario.email)} · <span class="rol">${esc(me.usuario.role || "")}</span>`; mu.hidden = false; }
  const logout = $("#btn-logout"), sep = $("#menu-sep-logout");
  if (logout) { logout.hidden = false; logout.onclick = () => { location.href = "/logout"; }; }
  if (sep) sep.hidden = false;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
