import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // These tests mutate process.env.LYCEUM_ADMIN_KEYS to exercise the admin
    // gate. Running files in parallel threads would let one file's env change
    // race another file's assertion, so they share a single process.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
});
