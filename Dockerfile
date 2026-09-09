# The server is the only thing that ships. It needs three things at run time:
# `dist/` (the built front-end it serves), `src/` (it runs the TypeScript
# directly through tsx, so there is no separate compile step to keep in step
# with the source), and the two runtime dependencies.
#
# The 4.7MB of community card data stays behind: `src/ui/card-art.ts` was
# generated from it offline and nothing reads the JSON at run time.

# Node 22 to match CI. Vite 8 wants ^20.19 || >=22.12, so `node:20-alpine`
# only works while that tag stays ahead of 20.19 — a version floor nothing
# here would notice breaking. Dev, CI and production run the same major.
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY tsconfig.json ./
COPY src ./src

# The host tells us which port to listen on; `src/server/index.ts` reads it.
EXPOSE 8787
CMD ["npm", "start"]
