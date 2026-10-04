FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/
COPY public/ ./public/

WORKDIR /app/server

EXPOSE 8080

CMD ["node", "server.js"]
