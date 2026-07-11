<div align="center">

<img src="public/logo.svg" width="76" alt="Trustux" />

# Trustux

**Cada firma, verificada. En tu máquina.**

Verificación de firma digital **100% local** para documentos firmados (PDF/PAdES). Subís un
balance, un dictamen o un escrito firmado y Trustux responde — sin que el documento salga de tu
equipo — si la firma es **íntegra** (¿se modificó después de firmar?), si el firmante es **quien
dice ser** (cadena hasta la AC Raíz Argentina, con extracción de CUIT/CUIL) y si el certificado
estaba **vigente** al firmar. Veredicto con semáforo e informe exportable.

Parte de la familia [**Escriba**](https://github.com/diegoparras/escriba). Nace como el
verificador de firma de [Selega](https://github.com/diegoparras/selega) —cierra el lazo de la
legalización: *cifras que cierran **y** firma del matriculado verificada*— y crece a app standalone.

![Local](https://img.shields.io/badge/local-100%25-0E9AAB) ![Self-hosted](https://img.shields.io/badge/self--hosted-ok-0E9AAB) ![Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-0E9AAB)

> Estado: **motor completo + app standalone.** `firma-core` verifica integridad, identidad (CUIT),
> cadena de confianza y revocación (CRL offline + OCSP) sobre los tres estándares: **PAdES** (PDF),
> **XAdES** (XML, facturas AFIP) y **CAdES** (CMS `.p7m`/`.p7s`). Hay una **UI web** para subir
> documentos (`npm start`), con **SSO opcional via Lockatus**, e integración con Selega (gateada por
> el superadmin). Tests verdes (24 casos). Ver [`docs/SPEC.md`](docs/SPEC.md).

</div>

---

## Por qué

Los validadores de firma habituales son **online**: subís un documento legal sensible a un
tercero que *promete* no guardarlo. Trustux corre **en tu máquina** — el documento nunca sale,
igual que [Anonimal](https://github.com/diegoparras/anonimal) con los datos personales. Para una
Secretaría Técnica que recibe balances firmados, eso no es comodidad: es la diferencia entre
poder usar la herramienta y no poder.

## Qué verifica

- **Integridad** — el documento no se tocó después de firmarse (detección de cambios y de
  actualizaciones incrementales post-firma).
- **Identidad** — cadena de certificados hasta una raíz de confianza (**AC Raíz República
  Argentina** precargada, editable por jurisdicción); extrae nombre, **CUIT/CUIL**, AC emisora y rol.
- **Vigencia** — revocación por **CRL** (*offline-first*) y por **OCSP** (respuestas embebidas/provistas offline, y consulta online opt-in); sello de tiempo (RFC 3161).
- **Estándares** — PAdES (PDF), XAdES (XML, facturas AFIP/ARCA) y CAdES (CMS `.p7m`/`.p7s`) funcionando.

## Integración con Selega

Entra como una **capacidad opcional, apagada por defecto**: solo el superadmin la prende
(`cap_firma`). Con la firma encendida, el veredicto alimenta el desenlace de Selega
(legaliza / observa / **certifica firma** / deniega). Con la firma apagada, Selega funciona
exactamente como hoy. Detalle en [`docs/SPEC.md`](docs/SPEC.md).

## Fixtures de prueba

El repo trae fixtures de ejemplo con su [tabla de verdad](fixtures/README.md):

- **PDFs (PAdES)** en [`fixtures/`](fixtures/): íntegro, alterado, doble firma, con sello de
  tiempo, SHA-1 y revocado.
- **Facturas XML (XAdES)** en [`fixtures/xades/`](fixtures/xades/): firmada y alterada.

Regenerables con:

```bash
pip install -r scripts/requirements.txt
python scripts/gen_fixtures.py     # PDFs PAdES + raíz de confianza + CRL de prueba
python scripts/verify_check.py     # valida los PDFs con pyHanko (verificador de referencia)
npm install
node scripts/gen_xades.mjs         # facturas XML firmadas (XAdES) + su raíz de prueba
```

## Estructura

```
trustux/
├── firma-core/           motor de verificación (JS puro, browser + Node)
│   ├── pades.js          extrae firmas del PDF (ByteRange + CMS)
│   ├── verify.js         PAdES: integridad · identidad (CUIT) · cadena · revocación · veredicto
│   ├── xades.js          XAdES: firmas XML (facturas AFIP), reusa identidad y cadena
│   ├── cades.js          CAdES: firmas CMS .p7m/.p7s, reusa todo el motor PAdES
│   ├── ocsp.js           revocación OCSP (validación de respuesta + consulta online opt-in)
│   └── cli.js            verifica fixtures/ por consola
├── server/               app standalone: sirve la UI y /api/verificar (PDF o XML)
│   ├── index.js          HTTP + estático + login Lockatus (opcional, tras flag)
│   └── verificar.js      carga el trust store y enruta al motor según el tipo
├── client/               cliente OIDC de Lockatus (vendorizado)
├── public/               UI web (drag-and-drop, veredicto con iconos)
├── trust/                raíces de confianza + CRLs (editable sin rebuild)
├── test/                 tablas de verdad: PAdES, XAdES y adaptador del standalone
├── docs/SPEC.md          spec técnica + alcance
├── fixtures/             PDFs y facturas XML firmadas de ejemplo
└── scripts/              generadores de fixtures (Python para PAdES, Node para XAdES)
```

## App standalone (UI web)

Subí documentos firmados por el navegador y obtené el veredicto, 100% local:

```bash
npm install
npm start              # http://localhost:8095  (subí un PDF o XML firmado)
```

Con Docker: `docker compose up -d --build`.

### SSO opcional con Lockatus

Por defecto Trustux es single-user (sin login). Para que los usuarios entren con el SSO de la
suite, poné `AUTH_MODE=federado` y las variables de [`.env.example`](.env.example) (registrando
la app en Lockatus). El login va por OIDC (Authorization Code + PKCE); apagado no rompe nada.

## Probar el motor

```bash
npm install
npm run verificar      # verifica los PDFs de fixtures/ y muestra el veredicto
npm test               # PAdES (8) + XAdES (3) + CAdES (3) + OCSP (4) + standalone (6) + goodunluck (15)
```

## Módulo goodunluck — recuperar archivos protegidos

Segunda herramienta de Trustux (página `/goodunluck`): recuperación **local y auditada** del acceso
a archivos **propios** de la organización que quedaron con contraseña o restricciones (p. ej. un
empleado que bloquea una planilla). Es dual-use, así que el diseño es responsable: recuperación de
archivos propios, 100% local, con motivo + declaración de propiedad obligatorios, auditoría
append-only, y una **matriz rol→capacidad que edita el superadmin** (`config/goodunluck.json`) —
nada sensible abierto por defecto.

Motor por tiers (en `unlock-core/`):
- **Tier 1 — quitar restricciones sin clave:** protección de hoja/edición de Office (edita el OOXML
  con `jszip`) y permisos/owner-password de PDF (`qpdf` en WASM).
- **Tier 2 — descifrar con clave conocida:** PDF con `qpdf`; **Office cifrado (ECMA-376 Agile)** con
  `office-agile.js` (`node:crypto` + `cfb`), port de la implementación de GoodUnLock.
- **Tier 3 — recuperar clave desconocida:** para **Office ya funciona por diccionario en JS puro**
  (`recuperarClaveAgile`, reusa el mismo verificador); PDF/ZIP/RAR por diccionario/fuerza bruta con
  John/hashcat llegan con binarios nativos opcionales. Gateado por `cracking.enabled` (superadmin).

Fixtures en `fixtures/unlock/` (`python scripts/gen_unlock_fixtures.py`).

## Licencia

Apache-2.0. Parte de la Suite Escriba.
