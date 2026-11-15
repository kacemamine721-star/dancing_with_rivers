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
# Same security headers as apps/web/public/_headers (Cloudflare) so local runs show CSP violations.
COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
 listen 80;
 root /usr/share/nginx/html;
 gzip on;
 gzip_types text/css application/javascript application/json image/svg+xml;
 add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
 add_header X-Content-Type-Options nosniff always;
 location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always; }
 location /data/ { add_header Cache-Control "public, max-age=3600"; add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always; try_files $uri =404; }
 location / { try_files $uri $uri/ /index.html; }
}
NGINX
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
