# syntax=docker/dockerfile:1
#
# Two stages: nothing is compiled, but the runtime image should not carry
# dev-only packages (PGlite) or the test fixtures.
#
#   docker build -t groupops .
#   docker run --rm -p 8787:8787 -e DATABASE_URL=postgres://... groupops
#
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# production deps only: `pg` is needed against a real server, PGlite is not
RUN npm ci --omit=dev || npm install --omit=dev
COPY db/pg/schema.sql db/pg/schema.sql

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY db ./db
COPY src ./src
COPY server.mjs admin-server.mjs ./
COPY demo.html admin-demo.html ./
USER node
EXPOSE 8787 8788
# One process per container; scale with a replica count, not with threads.
CMD ["node", "server.mjs"]
