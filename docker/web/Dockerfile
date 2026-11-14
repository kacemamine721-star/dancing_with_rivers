# Web app (static SPA) — build with pnpm from the committed lockfile, serve with nginx.
# Build context: apps/web (see docker-compose.yml).  docker compose up --build web  →  http://localhost:5173
FROM node:22-alpine AS builder
ARG NPM_REGISTRY=https://registry.yarnpkg.com
WORKDIR /app
RUN npm install -g pnpm@9.15.9 --registry=${NPM_REGISTRY}
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --registry=${NPM_REGISTRY}
COPY . .
# contracts/ lives outside this context: the generated schemas are committed, so only vite build runs here
RUN pnpm exec vite build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\n listen 80;\n root /usr/share/nginx/html;\n gzip on;\n gzip_types text/css application/javascript application/json image/svg+xml;\n location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }\n location /data/ { add_header Cache-Control "public, max-age=3600"; try_files $uri =404; }\n location / { try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
