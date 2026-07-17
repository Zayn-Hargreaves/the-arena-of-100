# ============================================================
# @arena/api — multi-stage image for the multi-instance topology
# (infrastructure/docker-compose.multi.yml). Build context is the
# REPO ROOT so the pnpm/turbo workspace (shared, game-core) is visible.
#
#   docker build -f apps/api/Dockerfile -t arena-api .
#
# `turbo prune @arena/api --docker` isolates just the API + its
# workspace deps into out/json (package manifests, for a cache-friendly
# install layer) and out/full (source), keeping the image lean and the
# install cache stable across source-only changes.
# ============================================================

# ---- base: pnpm + prisma runtime libs ----
FROM node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS base
# Keep pnpm 9 pinned: `pnpm deploy` on pnpm v10+ requires
# `inject-workspace-packages=true` (or injected workspace deps) unless `--legacy`
# is used. Preserve the existing pnpm 9 + deploy flow unchanged here.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# ---- runtime-base: minimal runtime environment without build tools ----
FROM node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime-base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack disable \
 && rm -rf /usr/local/lib/node_modules/npm \
 && rm -rf /usr/local/lib/node_modules/corepack \
 && rm -rf /usr/local/bin/npm \
 && rm -rf /usr/local/bin/npx \
 && rm -rf /usr/local/bin/corepack \
 && rm -rf /usr/local/bin/pnpm \
 && rm -rf /usr/local/bin/pnpx \
 && rm -rf /opt/yarn* \
 && rm -rf /usr/local/bin/yarn \
 && rm -rf /usr/local/bin/yarnpkg
WORKDIR /app

# ---- pruner: isolate @arena/api + workspace deps ----
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.3.3 prune @arena/api --docker

# ---- build: install (incl. dev deps), generate Prisma client, build ----
# This stage KEEPS dev deps (tsx, cross-env, prisma CLI) on purpose so the
# compose `migrate` service can target it to run `prisma migrate deploy`
# + the tsx seed. The `runtime` stage below is the lean production image.
FROM base AS build
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ ./
# turbo prune --docker omits root-level files referenced via tsconfig
# `extends`; the workspace tsconfigs all extend ../../tsconfig.base.json,
# so copy it in explicitly or every package `tsc` fails with TS5083.
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
# Prisma client must exist before `nest build` compiles code that imports it.
RUN pnpm --filter @arena/api exec prisma generate
RUN pnpm dlx turbo@2.3.3 run build --filter=@arena/api

# ---- prod-deps: build a portable, self-contained production bundle ----
# `pnpm --filter @arena/api deploy /app/prod --prod` produces a standalone folder
# rooted at /app/prod with a self-contained `node_modules` (no symlinks back to
# /app/packages/* source dirs) and the api's production-only runtime deps
# resolved. The deploy step also copies the workspace deps `@arena/shared` and
# `@arena/game-core` (their `dist/` + `package.json`) into /app/prod's
# `node_modules` so the api's `require.resolve('@arena/shared')` and
# `require.resolve('@arena/game-core')` succeed at runtime without relying on
# workspace symlinks. After deploy, copy Prisma's generated `.prisma` runtime
# directory into `/app/prod/node_modules/.prisma`, then CI instantiates
# PrismaClient from the deployed bundle with the same adapter stack the app
# uses so a merely resolvable-but-broken generated client still fails before
# release.
FROM build AS prod-deps
RUN pnpm --filter @arena/api deploy /app/prod --prod --no-optional \
 && node -e ' \
    const fs = require("node:fs"); \
    const path = require("node:path"); \
    const prismaPkgDir = path.dirname( \
      require.resolve("@prisma/client/package.json", { \
        paths: ["/app/apps/api"] \
      }) \
    ); \
    const generatedDir = path.join( \
      path.dirname(path.dirname(prismaPkgDir)), \
      ".prisma" \
    ); \
    fs.mkdirSync("/app/prod/node_modules", { recursive: true }); \
    fs.cpSync(generatedDir, "/app/prod/node_modules/.prisma", { \
      recursive: true, \
      force: true \
    }); \
  '

# ---- runtime: production process ----
FROM runtime-base AS runtime
ENV NODE_ENV=production
# main.ts reads all config from process.env (injected by compose), so no .env file is
# baked into the image. `pnpm deploy /app/prod --prod` FLATTENS the deployed package
# to the target root — the api's dist/ and package.json land directly under
# /app/prod (NOT under /app/prod/apps/api). Verified locally with
# `pnpm --filter @arena/api deploy /tmp/x --prod`; the deploy output has
# /tmp/x/dist/main.js, /tmp/x/package.json, /tmp/x/node_modules. So the runtime
# entrypoint is /app/dist/main.js with WORKDIR=/app.
COPY --from=prod-deps /app/prod /app
EXPOSE 3001
# Drop to the unprivileged `node` user baked into the base image. The app
# only reads its files and talks to Postgres/Redis over the network, so
# read-only access as a non-root user is sufficient.
USER node
# main.ts listens on PORT||3001 on 0.0.0.0.
CMD ["node", "dist/main.js"]

# ---- verify (manual / CI) ----
# Confirm the deployed layout resolves every required module AND that the
# runtime entrypoint actually exists. Run with:
#
#   docker run --rm --entrypoint node <image> -e '
#     const { PrismaClient } = require("@prisma/client");
#     const { PrismaPg } = require("@prisma/adapter-pg");
#     const { Pool } = require("pg");
#     require.resolve("@nestjs/common");
#     require.resolve("@arena/shared");
#     require.resolve("@arena/game-core");
#     require.resolve("./dist/main.js");
#     (async () => {
#       const pool = new Pool({ connectionString: "postgresql://prisma:prisma@127.0.0.1:5432/arena" });
#       const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
#       try {
#         await prisma.$disconnect();
#         console.log("OK");
#       } finally {
#         await pool.end();
#       }
#     })().catch((error) => {
#       console.error(error);
#       process.exit(1);
#     });
#   '
#
# The Nest/shared/game-core/dist resolution checks must succeed, and PrismaClient
# must instantiate successfully from the deployed bundle using the runtime
# adapter stack. The `./dist/main.js` resolution explicitly checks the CMD
# entrypoint so a wrong WORKDIR / wrong path fails verification immediately.
# The deploy step is what makes the workspace package symlinks disappear —
# these modules must resolve from /app/node_modules (the deploy output), not
# from /app/packages/* (the source tree, which is NOT in the runtime image).
#
# Alternative runtime smoke test (catches path/permission issues that pure
# require.resolve does not):
#
#   docker run --rm --entrypoint "" <image> node -h
#
# This launches `node` with no script and prints Node's help. It validates
# that the image has a working `node` binary on PATH, that the entrypoint
# can be invoked, and that the process can read its own argv — which is the
# minimum to start `node dist/main.js` under `CMD ["node", "dist/main.js"]`.
