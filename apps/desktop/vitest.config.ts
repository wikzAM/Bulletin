import { defineConfig } from "vitest/config";

/** Package-local config so `pnpm --filter desktop test` finds tests when cwd is apps/desktop. */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
