import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The engine is plain TypeScript with no Node-only dependencies in its core,
 * so it runs in a browser unchanged. Its imports carry `.js` specifiers — the
 * NodeNext convention — that point at `.ts` files on disk, and Vite does not
 * rewrite those on its own.
 *
 * Deliberately narrow: only relative specifiers, only from files inside this
 * repo, and only when the `.ts` file actually exists. Vite's own dependency
 * pre-bundle uses relative `.js` imports too, and rewriting those breaks it.
 */
const resolveTsFromJs = {
  name: "resolve-ts-from-js",
  enforce: "pre" as const,
  resolveId(source: string, importer: string | undefined) {
    if (importer === undefined) return null;
    if (!source.startsWith(".") || !source.endsWith(".js")) return null;
    if (importer.includes("node_modules")) return null;

    const candidate = resolve(dirname(importer), source.slice(0, -3) + ".ts");
    return existsSync(candidate) ? candidate : null;
  },
};

export default defineConfig({
  plugins: [resolveTsFromJs, react()],
  server: { port: 5173 },
  /**
   * Where the built app will be served from.
   *
   * `/` for the dev server and for `npm run server`, which serves the bundle
   * at the root of its own origin. GitHub Pages serves a project site under
   * `/<repo>/`, so its assets need that prefix baked in at build time — hence
   * an environment variable rather than a constant.
   */
  base: process.env.BASE_PATH ?? "/",
});
