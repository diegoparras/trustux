# Trustux — Verificación de firma digital para la Suite Escriba

**Spec técnica + MVP · 2026-06-23**
**Enfoque: integración con Selega primero; app standalone después.**

> *"Cada firma, verificada. En tu máquina."*

---

## 0. Resumen ejecutivo

Selega recibe Estados Contables firmados digitalmente por el contador matriculado y hoy
**no verifica esa firma**: la Secretaría Técnica la da por buena visualmente o la sube a un
validador online (subiendo un documento legal sensible a un tercero — justo lo que la suite
predica no hacer). Selega ya contempla `"certifica firma"` como uno de sus desenlaces posibles;
esta spec lo implementa.

**Trustux** es el motor de verificación de firma digital de la suite. Recibe un documento
firmado y responde, **100% local**, tres preguntas:

1. **Integridad** — ¿el documento se modificó después de firmarse?
2. **Identidad** — ¿el firmante es quien dice? (cadena hasta AC Raíz Argentina; extracción de CUIT/CUIL)
3. **Vigencia** — ¿el certificado estaba válido al firmar? (revocación + sello de tiempo)

Entrega un **veredicto con semáforo** (🟢 válida / 🟡 con observaciones / 🔴 inválida), idéntico
al lenguaje visual de Selega, más un **informe de verificación exportable**.

**Estrategia de entrega:** se construye como un **módulo de Selega** (`firma-core/` sin
dependencias de Selega + panel cliente + endpoints), con una costura limpia para extraerlo
luego como app standalone **Trustux** (mismo stack: Node ESM + vanilla HTTP, como Selega/Fulgoria).

---

## 1. Estándares y alcance

| Estándar | Contenedor | Caso de uso en el ecosistema | Fase |
|----------|-----------|------------------------------|------|
| **PAdES** | PDF | Balances, dictámenes, escritos firmados (el 90% de Selega) | **MVP** |
| **XAdES** | XML | Facturas electrónicas AFIP/ARCA, comprobantes | 2 |
| **CAdES** | `.p7s` / `.p7m` | Firmas desprendidas, adjuntos firmados | 2 |

Niveles de firma reconocidos (perfil baseline ETSI): **-B** (básica), **-T** (con sello de
tiempo), **-LT** (long-term, revocación embebida → **valida 100% offline**), **-LTA** (con
sello de archivo). Trustux detecta y reporta el nivel; los `-LT/-LTA` son los que validan sin red.

---

## 2. Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  Cliente (browser, dentro de Selega o standalone)            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ firma-core/  (JS puro, vendorizado en public/vendor/)  │ │
│  │   pkijs · asn1js · xadesjs · pvutils   (MIT)           │ │
│  │   • parse PAdES ByteRange + CMS SignedData             │ │
│  │   • verificación criptográfica de integridad          │ │
│  │   • construcción y validación de cadena               │ │
│  │   • parse de identidad (DN, CUIT vía OID serialNumber) │ │
│  │   • detección de cambios post-firma (incrementales)   │ │
│  └────────────────────────────────────────────────────────┘ │
│         │ (offline: todo acá)        │ (online: gateado)      │
└─────────┼────────────────────────────┼────────────────────────┘
          │                            │
          ▼ veredicto                  ▼ POST /api/firma/revoke
   se guarda en trabajos.firma   (proxy server-side, como el
   + entrada en auditoria         proxy LLM: única salida externa)
```

**Por qué el core en el browser:** el documento firmado **nunca sube al servidor** para
validarse — coherente con Anonimal/Fulgoria. El único caso que requiere red (revocación OCSP/CRL
*online*) pasa por un proxy server-side gateado, porque la CSP de Selega es `connect-src 'self'`
y el browser no puede llamar a un responder OCSP externo. La revocación **offline** (CRL cacheada
o data embebida en firmas -LT/-LTA) no necesita red y es el camino por defecto.

### 2.1 Stack

- **Cripto:** `pkijs` + `asn1js` + `pvutils` (PeculiarVentures, MIT, browser+Node) para CMS/PKCS#7,
  cadenas X.509, OCSP, CRL, TSP (sello de tiempo RFC 3161). `xadesjs` para XAdES (Fase 2).
- **PDF:** parser propio del diccionario de firma + `ByteRange` (no hace falta lib pesada;
  pdf.js ya está vendorizado en Selega si se necesita render).
- **Server (solo proxy revocación + admin trust store):** el `server/` Node ESM existente de Selega;
  en standalone, un `server/index.js` clónico del de Selega.
- **Persistencia:** PostgreSQL existente de Selega (sin tablas nuevas en MVP, ver §4).

---

## 3. Modelo de veredicto

Cada **firma** del documento (puede haber varias) produce:

```jsonc
{
  "estado": "valida" | "observada" | "invalida",     // semáforo verde/ámbar/rojo
  "integridad": { "ok": true, "cubreTodo": true, "modificadoPostFirma": false },
  "firmante": {
    "nombre": "PEREZ, Juan Carlos",
    "cuit": "20-12345678-9",                           // OID 2.5.4.5 serialNumber → CUIT/CUIL
    "email": "jperez@consejo.org.ar",
    "rol": "Contador Público",                         // de la policy / OU del cert
    "acEmisora": "AC Modernización-PFDR"
  },
  "cadena": { "ok": true, "raiz": "AC Raíz República Argentina", "confiable": true },
  "revocacion": { "metodo": "embebida" | "crl-cache" | "ocsp-online" | "no-verificada",
                  "revocado": false, "verificadaA": "2026-06-22T10:00:00Z" },
  "selloTiempo": { "presente": true, "tsa": "AC TSA AFIP", "fecha": "2026-06-20T14:33:00Z" },
  "nivel": "PAdES-LT",
  "observaciones": [ "Revocación verificada contra CRL cacheada (no online)" ],
  "provenance": { "byteRange": [0, 2841, 9216, 1187], "campoFirma": "Signature1" }
}
```

**Reglas de semáforo (alineadas con Selega):**

- 🔴 **inválida** — falla integridad, cadena no llega a raíz confiable, certificado revocado,
  o algoritmo prohibido (MD5/SHA-1 en la firma).
- 🟡 **observada** — íntegra y de firmante confiable, pero con caveat: sin sello de tiempo,
  revocación no verificable offline y sin LTV, o cadena válida contra raíz **no precargada**
  (root custom agregado por el admin).
- 🟢 **válida** — integridad ✓ + cadena a raíz confiable ✓ + revocación ✓ + (idealmente) sello ✓.

**Veredicto global** del documento = la peor firma + reglas de la jurisdicción.

### 3.1 Mapeo al desenlace de Selega

El veredicto de Trustux alimenta el campo `desenlace` existente de Selega:

| Firma (Trustux) | Cruces EECC (Selega) | Desenlace sugerido |
|-----------------|----------------------|--------------------|
| 🟢 válida | 14/14 cierran | **legaliza** |
| 🟢 válida | algún cruce ámbar | **observa** |
| 🟡 observada | cierran | **certifica firma** (con caveat) |
| 🔴 inválida | — | **deniega** |

Esto convierte a Selega de "control visual de cifras" a **legalización con respaldo
criptográfico**: cifra correcta **y** firma del matriculado verificada.

---

## 4. Integración con Selega (cambios concretos)

Todo sigue los patrones que ya usa Selega — sin framework, sin reescrituras.

### 4.0 Gating: el superadmin decide si existe (apagado por defecto)

La verificación de firma es una **capacidad opcional**, igual que el OCR o el VLM local. Entra
como un cap más en `CAP_DEFAULTS` (`server/api.js`), **`"0"` por defecto**:

```js
const CAP_DEFAULTS = { cap_ocr: "1", cap_vlm_local: "0",
  cap_firma: "0",            // ← verificación de firma digital: APAGADA por defecto
  /* …resto igual… */ };
```

Solo el **superadmin** lo prende desde Admin (mismo flujo que `cap_ocr`/`cap_vlm_local`). Cuando
`cap_firma === "0"`:

- La pestaña **"Firma"** no se renderiza en la vista del trabajo.
- Los endpoints `/api/firma/*` responden `403` (gate server-side — no alcanza con ocultar la UI).
- El mapeo a `desenlace` ignora la firma; Selega funciona exactamente como hoy.

Así un Consejo que aún no usa firma digital no ve nada nuevo, y el que la adopta la enciende con
un switch — sin tocar código, sin migración, sin romper trabajos existentes. La revocación online
(`/api/firma/revoke`) es un **segundo flag** independiente, también apagado, anidado bajo este.

### 4.1 Base de datos (`server/db.js`)
Una sola columna nueva, con el mismo idioma de migración idempotente que ya usan:

```js
// dentro del CREATE TABLE … de initDb(), junto a las otras ALTER:
ALTER TABLE trabajos ADD COLUMN IF NOT EXISTS firma TEXT DEFAULT '{}';
// 'firma' guarda el JSON de §3 (veredicto completo + provenance). Append-only en auditoria.
```
Cross-check identidad: `firma.firmante.cuit` se compara contra `trabajos.cuit` (ya existe) →
observación automática si el CUIT del firmante ≠ CUIT del comitente.

### 4.2 API (`server/api.js`) — endpoints nuevos
Siguiendo `json()`, `readRaw()` (cap 30 MB ya definido) y el gating por rol existente.
**Todos chequean `cap_firma === "1"` primero** → si está apagado, `403`:

- `POST /api/firma/verificar` — recibe el PDF (raw), corre `firma-core` server-side **o**
  recibe el veredicto ya calculado en cliente y lo persiste en `trabajos.firma` + `auditoria`.
- `POST /api/firma/revoke` — **proxy de revocación online** (OCSP/CRL), gateado igual que
  `/api/llm`: única salida externa, server-side, auditada. Apagado por defecto (offline-first).
- `GET  /api/firma/trust` — lista de raíces de confianza activas (precargadas + custom de la jurisdicción).
- `POST /api/firma/trust` — admin/superadmin agrega/quita raíces custom (se guardan en `config`/`packs`,
  editables por jurisdicción como las reglas de cruces).

### 4.3 Trust store
- **Precargado:** PEMs de **AC Raíz República Argentina** + ACs licenciadas (IFDRA), vendorizados
  como asset inmutable (`public/vendor/trust/ar/`).
- **Editable por jurisdicción** desde Admin (mismo patrón que `packs`/`rules` de Selega): un Consejo
  puede sumar su propia AC o la de su token.
- **Opcional eIDAS** (EUTL) detrás de flag, para documentos europeos.

### 4.4 Cliente
Una pestaña **"Firma"** en la vista del trabajo, junto a Cifras/Cruces/Checklist:
- Tarjeta de firmante (nombre · CUIT · AC · rol · nivel PAdES · fecha de sello).
- Semáforo por firma + global.
- **"¿Qué cambió después de firmar?"** — lista de revisiones/actualizaciones incrementales del PDF.
- Botón **Exportar informe** (PDF read-only con provenance, como el expediente de Selega).

---

## 5. Seguridad (no negociable en firma)

Los ataques clásicos a firma PAdES se mitigan explícitamente:

- **ByteRange spoofing / shadow attacks** — verificar que el `ByteRange` cubre **todo** el archivo
  salvo el hueco de la firma; rechazar contenido después de la última firma; detectar
  **actualizaciones incrementales** post-firma y reportarlas (no silenciarlas).
- **Algoritmos débiles** — allowlist: SHA-256/384/512 + RSA-2048+/ECDSA-P256+. MD5 y SHA-1 en el
  digest de firma → 🔴 inválida.
- **Confusión de identidad** — el "nombre" mostrado sale **del certificado**, nunca de metadata del
  PDF; CUIT desde el OID `serialNumber`, no de texto libre.
- **DoS** — reusar el cap de 30 MB de Selega; límites de profundidad de cadena y de nº de firmas.
- **Sin telemetría** — el documento no sale del browser salvo el proxy de revocación gateado y auditado.

---

## 6. Alcance del MVP (Fase 1)

**Incluye:**
- [ ] **Flag `cap_firma` (off por defecto)** en `CAP_DEFAULTS` + toggle en Admin (solo superadmin) + gate `403` en `/api/firma/*`.
- [ ] `firma-core` (JS puro): PAdES sobre PDF — integridad + cadena + identidad + sello de tiempo, **offline**.
- [ ] Trust store AC Raíz Argentina precargado + editable por jurisdicción.
- [ ] Revocación offline: data embebida (-LT/-LTA) y CRL cacheada; OCSP-online detrás de flag (proxy).
- [ ] Veredicto §3 + semáforo + cross-check CUIT firmante vs comitente.
- [ ] Persistencia en `trabajos.firma` + `auditoria`; mapeo a `desenlace`.
- [ ] Pestaña "Firma" en el trabajo + informe exportable.

**Difiere a Fase 2+:**
- XAdES (facturas AFIP/ARCA) y CAdES (`.p7s`).
- Validación por lote (carpeta → informe único).
- Extracción a app standalone **Trustux** (mismo stack que Selega).
- **Firmar** (no solo validar): `.pfx` PKCS#12 y tokens USB PKCS#11 — lo más OS-dependiente, va al final.

---

## 7. Costura para el standalone

`firma-core/` no importa **nada** de Selega (ni db, ni auth, ni config). Su contrato:
`verificar(bytes, opts) -> veredicto`. Selega lo consume desde su cliente/servidor; la futura
app **Trustux** lo monta sobre un `server/index.js` clónico (vanilla HTTP + el mismo CSP estricto)
y agrega: drag-and-drop multi-archivo, validación por lote, los tres estándares, y firma con token.
Cero reescritura del core.

---

## 8. Riesgos y decisiones abiertas

| Tema | Decisión propuesta |
|------|--------------------|
| ¿Core en browser o server? | **Browser** por privacidad; server solo para proxy de revocación. |
| ¿OCSP online rompe `connect-src 'self'`? | Sí → **proxy server-side gateado** (patrón del proxy LLM). Offline por defecto. |
| Trust store: ¿hardcode o editable? | **Editable por jurisdicción** (patrón `packs`/`rules`). |
| Nombre del producto | **Trustux** (decidido). |
| ¿Empezar embebido en Selega o standalone? | **Embebido** (esta spec); standalone reusa `firma-core`. |
| ¿Quién decide si Selega usa firma? | **Superadmin**, vía cap `cap_firma` — **apagado por defecto**. Off = Selega idéntico a hoy. |

---

## 9. Próximo paso sugerido

Prototipo de `firma-core`: tomar **un PDF firmado real** (un balance o una factura con firma
digital AR) y emitir el veredicto §3 por consola — integridad + cadena + identidad, offline,
contra el trust store de AC Raíz Argentina. Con eso validamos el corazón antes de cablear UI y DB.
