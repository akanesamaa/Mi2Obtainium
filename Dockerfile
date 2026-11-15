FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts

ENV PORT=8787
EXPOSE 8787
VOLUME ["/app/data"]

CMD ["node", "server.js"]
