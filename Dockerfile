# QWX POKER — сервер клуба (игра + онлайн) в одном контейнере
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# данные игроков (балансы, рефералы, переводы) — в постоянной папке /data
ENV NODE_ENV=production PORT=80 DATA_DIR=/data
EXPOSE 80
CMD ["npx", "tsx", "src/server/index.ts"]
