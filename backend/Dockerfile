# syntax=docker/dockerfile:1
# TAKE-TUK API image. Build from the REPOSITORY ROOT (the image includes supabase/migrations so the
# operator CLI can migrate plain PostgreSQL databases):
#   docker build -f backend/Dockerfile -t taketuk-api .
# NOTE: not yet built or run in CI; see docs/IMPLEMENTATION_REPORT.md.

FROM node:24-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY supabase/migrations /app/supabase/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/src/main.js"]
