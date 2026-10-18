# The production image for the API, built in two stages. Each stage starts from a
# fresh base image; the final image only keeps what it copies in explicitly.

# ---- Stage 1: install the runtime dependencies --------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
# Copy only the package files first. Docker caches each step, so as long as these
# two files don't change, rebuilding after a code change skips the slow npm ci.
COPY package.json package-lock.json ./
# ci installs exactly what the lockfile says. --omit=dev leaves out tsx, vitest,
# drizzle-kit, typescript...: none of them are needed to run the app.
RUN npm ci --omit=dev && npm cache clean --force

# ---- Stage 2: the image that actually runs --------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only what's needed at runtime: dependencies, source code and migrations.
# No tests, no .env, no git history, no npm cache.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY drizzle ./drizzle

# Don't run as root: if someone ever breaks into the process, they can't
# modify the image's files. The node image ships with a "node" user.
USER node

# Documentation only: the platform still decides which port to publish. Most
# hosts set PORT themselves, and src/config/env.ts reads it.
EXPOSE 3000

# Node 24 runs TypeScript directly by removing the types ("type stripping"),
# which is why tsconfig has erasableSyntaxOnly. So there's no build step.
# First apply any new migrations, then start the server. `exec` replaces the shell
# with Node, so Node receives Docker's SIGTERM and shuts down gracefully (server.ts).
CMD ["sh", "-c", "node src/db/migrate.ts && exec node src/server.ts"]
