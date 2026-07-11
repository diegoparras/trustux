# Instalación de Trustux (deploy)

Guía para poner Trustux en producción. Dos ejes de decisión, independientes:

- **Auth**: `local` (single-user, sin login) o `federado` (multiusuario con Lockatus, roles reales).
- **Imagen**: `Dockerfile` (liviana, Tiers 1-2 de goodunluck) o `Dockerfile.full` (suma Tier 3 nativo:
  recuperación de clave con John jumbo / hashcat / bkcrack).

El escenario recomendado para una organización es **federado + full**: cada usuario entra con Lockatus,
su rol define qué puede hacer (matriz del superadmin), y el cracking queda gateado. El resto de esta
guía asume ese escenario; al final están las variantes.

---

## 1. Requisitos

- Docker (o EasyPanel). El build de la imagen full compila John jumbo y bkcrack del fuente: la primera
  vez tarda varios minutos.
- Una instancia de **Lockatus** corriendo y accesible (el SSO de la suite Escriba).
- Un dominio con TLS por delante (reverse proxy). EasyPanel te lo da; con Docker plano, poné un Caddy/
  Traefik/nginx adelante.

## 2. Lockatus: registrar la app y emitir roles

Trustux **no gestiona usuarios ni roles**: confía en Lockatus. El "quién sos" lo pone Lockatus; el
"qué podés hacer" lo aplica Trustux con `user.role`.

1. Registrá Trustux como cliente OIDC en Lockatus:
   - `client_id`: `trustux` (o el que elijas; debe coincidir con `CLIENT_ID`).
   - `redirect_uri`: `https://trustux.tu-dominio/callback`.
2. **Configurá Lockatus para incluir un claim `role` en el access token**, con uno de estos valores por
   usuario: `agente`, `auditor`, `admin`, `superadmin`. Ese claim es lo que Trustux lee para autorizar.
   - Sin el claim `role`, el usuario queda sin capacidades (no puede operar). Es a propósito: nada
     abierto por defecto.

## 3. Roles y qué puede cada uno (matriz por defecto)

La matriz vive en `config/goodunluck.json` y la edita el **superadmin** desde `/goodunluck-admin`.
Valores iniciales:

| Rol         | Tier 1 (quitar restricción) | Tier 2 (clave conocida) | Tier 3 (recuperar clave) | Formatos |
|-------------|:---:|:---:|:---:|---|
| `agente`    | sí  | –   | –   | Office, PDF |
| `auditor`   | sí  | sí  | –   | todos |
| `admin`     | sí  | sí  | sí  | todos |
| `superadmin`| sí  | sí  | sí  | todos |

Salvaguardas (exigidas por defecto): **motivo** + **declaración de propiedad** obligatorios, y
**auditoría** append-only. El **cracking (Tier 3) arranca apagado** globalmente: el superadmin lo
habilita en `/goodunluck-admin` (`cracking.enabled`), y además cada rol necesita el tier 3 en su fila.

## 4. Variables de entorno

Copiá `.env.example` a `.env` y completá:

```dotenv
AUTH_MODE=federado
LOCKATUS_ISSUER=https://lockatus.tu-dominio
CLIENT_ID=trustux
REDIRECT_URI=https://trustux.tu-dominio/callback
# Firma la cookie de sesión. OBLIGATORIO y secreto:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TRUSTUX_SECRET=<64 hex aleatorios>
```

## 5. Persistencia (crítico)

Trustux es casi stateless, pero **dos archivos deben persistir** entre redeploys, ambos en `/app/config`:

- `goodunluck.json` — la matriz de roles y salvaguardas que edita el superadmin.
- `goodunluck-audit.jsonl` — la auditoría append-only. Es la **evidencia de uso legítimo**: quién,
  qué archivo (nombre + hash, nunca el contenido), operación, resultado, motivo, timestamp.

Por eso el `docker-compose.yml` monta `./config:/app/config`. Si no montás nada ahí, cada reinicio
borra la config del superadmin y toda la auditoría. El trust store (`/app/trust`) también se monta,
para poner tus raíces reales sin rebuild.

> Nota: si usás un **volumen con nombre vacío** (típico en EasyPanel) en `/app/config`, tapa el
> `goodunluck.json` que trae la imagen. No pasa nada: Trustux arranca con la matriz por defecto y
> escribe el archivo la primera vez que el superadmin guarda. La auditoría se crea sola.

## 6. Levantar con Docker Compose

```bash
cp .env.example .env      # y completá las variables de arriba
docker compose up -d --build
docker compose logs -f    # "Trustux X.Y.Z en http://localhost:8095 · auth: federado"
```

El compose usa `Dockerfile.full` por defecto. Entrá a `https://trustux.tu-dominio` → login con
Lockatus. El primer superadmin ajusta la matriz en `/goodunluck-admin`.

## 7. Deploy en EasyPanel

EasyPanel (no usa docker-compose): creá un servicio tipo **App**.

- **Source**: este repo, Dockerfile = `Dockerfile.full`.
- **Env**: las variables de la sección 4.
- **Volumen**: montá uno en `/app/config` (persistencia de matriz + auditoría). Opcional otro en
  `/app/trust` si vas a subir raíces propias.
- **Puerto**: 8095. Dejá que EasyPanel ponga el dominio + TLS adelante.
- El `HEALTHCHECK` de la imagen pega a `/api/me`; EasyPanel lo respeta.

## 8. Tier 3 (cracking): cómo se usa y su límite actual

Con la imagen full, el superadmin habilita el cracking y un rol con tier 3 puede recuperar claves. El
flujo es **submit → poll → download**: se sube el archivo y una **wordlist**, y al terminar se descarga
el archivo abierto (no solo la clave).

- La wordlist se **sube junto con el pedido** desde la UI. Sirve para listas moderadas de candidatas.
- **Límite actual**: no hay wordlists grandes montadas en el server (tipo rockyou de millones de
  líneas) ni ataque por máscara desde la UI. Para eso, el motor nativo (`unlock-core/crack-native.js`)
  ya soporta hashcat/John con máscaras; exponerlo como opción del server es una mejora futura.
- Puertas garantizadas (no adivinan): PDF con owner-password (Tier 1, sin clave), PDF RC4 40-bit y
  Office 97-2003 (llave corta), fuga de metadatos de ZIP. Se detectan y marcan solas.

## 9. Variantes

- **Local + full** (single-user con cracking): `AUTH_MODE=local`. No necesitás Lockatus; el rol
  efectivo es `admin`. `TRUSTUX_SECRET` no se usa, pero el compose lo pide igual (poné cualquier valor).
- **Federado + liviana** (multiusuario sin Tier 3): cambiá `dockerfile: Dockerfile` en el compose. No
  compila binarios; los Tiers 1-2 son JS puro.
- **Local + liviana**: el default histórico. `AUTH_MODE=local` + `Dockerfile`.

## 10. Verificación post-deploy

```bash
curl -s https://trustux.tu-dominio/api/me      # {"auth":"federado", ...}
```

- Sin login, `/api/verificar` y `/api/goodunluck/*` responden 401.
- Un rol sin tier 3 recibe 403 al intentar `/api/goodunluck/crack`.
- Cada operación queda en `config/goodunluck-audit.jsonl`.
