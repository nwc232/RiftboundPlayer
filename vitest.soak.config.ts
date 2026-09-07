import { defineConfig } from "vitest/config";

/**
 * The long soak only. `tests/soak.long.ts` is named to fall outside the main
 * config's `tests/**\/*.test.ts`, so it never runs as part of `npm test`; this
 * is the config that picks it up. `npm run soak`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/soak.long.ts"],
    testTimeout: 1_800_000,
  },
});
