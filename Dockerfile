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

# The browser administration site is served from the same HTTP server and port.
# Only the files the site's allowlist names are copied; desktop overlay assets
# and recording cue audio stay out of the image.
COPY public/index.html public/logs.html public/settings.html public/login.html ./public/
COPY public/styles.css ./public/
COPY public/app-bridge.js public/app-version.js public/app.js public/capture-policy.js \
     public/environment-chrome.js public/icons.js public/login.js public/logs.js \
     public/media-support.js public/prefix-transfer.js public/runtime-config.js \
     public/settings-navigation.js public/settings.js public/setup-warning.js \
     public/web-client.js ./public/
COPY public/assets/icon.svg ./public/assets/

RUN mkdir -p /data

EXPOSE 8080
VOLUME ["/data"]

CMD ["node", "server/cli.js"]
