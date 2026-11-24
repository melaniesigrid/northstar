import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The pipeline tests start many git processes, which is much slower on Windows.
    testTimeout: 30_000,
  },
});
