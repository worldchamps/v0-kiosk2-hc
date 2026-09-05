FROM node:22-bookworm-slim
WORKDIR /app
COPY ops/update-server/package*.json ./
RUN npm ci --omit=dev
COPY ops/update-server ./ops/update-server
COPY electron/update-protocol.js ./electron/update-protocol.js
USER node
ENV PORT=8080
CMD ["node", "ops/update-server/server.js"]
