// theme-init.js — Aplica el tema guardado ANTES de pintar, para evitar el flash de
// claro→oscuro. Externo (no inline) porque la CSP de Trustux es script-src 'self'.
if (localStorage.getItem("trustux.theme") === "dark") document.documentElement.dataset.theme = "dark";
