# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the financial-modeler SPA.
# Stage 1 builds the static assets with the same Node version pinned in
# .nvmrc so local and container output match. Stage 2 serves them with a
# tiny nginx-alpine image. Final size ~50 MB.
#
# Build context: mocks/main-view/  (this directory is the Dockerfile root)
# Build:     docker build -t financial-modeler mocks/main-view
# Run:       docker run --rm -p 8080:8080 financial-modeler

# ---- Stage 1: build the SPA --------------------------------------------------
FROM node:20.20.2-alpine AS build
WORKDIR /app

# Install deps in a separate layer so Docker caches them when only source
# changes. npm ci is deterministic and fails if package-lock.json is stale.
COPY package.json package-lock.json ./
RUN npm ci

# Bring in source and build. The .dockerignore keeps node_modules, dist,
# tests, and other non-build artifacts out of the context.
COPY . .
RUN npm run build

# ---- Stage 2: serve static files --------------------------------------------
FROM nginx:1.27-alpine AS runtime

# SPA-aware config: SPA fallback, cache headers, gzip, security headers.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets only — no source, no node_modules in the runtime image.
COPY --from=build /app/dist /usr/share/nginx/html

# Cloud Run sets $PORT (default 8080); nginx config matches. For other
# hosts, expose whatever port your reverse proxy maps in front of nginx.
EXPOSE 8080

# nginx-alpine entrypoint already handles signals correctly via tini-like
# behavior; the daemon-off form keeps the container in the foreground so
# Cloud Run / Docker can manage its lifecycle.
CMD ["nginx", "-g", "daemon off;"]
