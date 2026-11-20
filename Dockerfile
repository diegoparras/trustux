# Trustux — verificación de firma digital (PAdES + XAdES), UI web. 100% local.
# Imagen base fijada por digest (node:24-alpine, LTS) para builds reproducibles.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app

# Deps de producción (sin las devDependencies del generador de fixtures).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Código del motor + servidor + UI + trust store + módulo goodunluck.
COPY firma-core ./firma-core
COPY unlock-core ./unlock-core
COPY server ./server
COPY client ./client
COPY public ./public
COPY trust ./trust
COPY config ./config
# Novedades por version: el cartel de arranque y la UI las leen de aca.
COPY CHANGELOG.md ./CHANGELOG.md

ENV PORT=8095
EXPOSE 8095
# Salud: /api/me responde siempre 200 (no expone datos sensibles).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8095)+'/api/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
