FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORVOZ_HOST=0.0.0.0 \
    PORVOZ_DATABASE_PATH=/data/porvoz.db
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY server ./server
COPY electron/app-service.js electron/operation-cancellation.js electron/defaults.json ./electron/

RUN mkdir -p /data

EXPOSE 8080
VOLUME ["/data"]

CMD ["node", "server/cli.js"]
