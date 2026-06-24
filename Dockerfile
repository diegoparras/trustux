# Trustux — verificación de firma digital (PAdES + XAdES), UI web. 100% local.
FROM node:22-alpine
WORKDIR /app

# Deps de producción (sin las devDependencies del generador de fixtures).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Código del motor + servidor + UI + trust store.
COPY firma-core ./firma-core
COPY server ./server
COPY client ./client
COPY public ./public
COPY trust ./trust

ENV PORT=8095
EXPOSE 8095
CMD ["node", "server/index.js"]
