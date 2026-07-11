# Trustux — verificación de firma digital (PAdES + XAdES), UI web. 100% local.
FROM node:22-alpine
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

ENV PORT=8095
EXPOSE 8095
# Salud: /api/me responde siempre 200 (no expone datos sensibles).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8095)+'/api/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
