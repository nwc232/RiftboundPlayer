import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    /**
     * Vitest's 5s default is tuned for unit tests. A good part of this suite
     * plays *whole games* — the playthroughs and the multiplayer soaks run
     * hundreds of them — and the driver banks its runes rather than spending
     * on the first legal thing, which is what let it afford anything above
     * cost 3 and roughly doubled the actions in a game.
     *
     * The margin has to cover the slowest machine that runs this, not the
     * fastest. A GitHub Actions runner takes 177s over a suite that takes 38s
     * here — about four and a half times — so a test at 3s locally is at 13s
     * there, and the 5s default was failing tests that had never once failed
     * on a developer machine. Setting it here rather than per-test means the
     * next soak to grow does not fail on CI first.
     *
     * Set generously on purpose. A timeout is here to catch a *hang* — an
     * engine that stopped making progress — not to police how long a soak
     * takes, and the slowest test here is 4s locally, so 60s survives a runner
     * having a bad day and still fails a genuine deadlock inside a minute.
     * The soaks that legitimately need longer still say so themselves.
     */
    testTimeout: 60_000,
  },
});
