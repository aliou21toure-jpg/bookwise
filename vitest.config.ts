import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(__dirname, "src"),
  // `server-only` throws outside Next's react-server environment; in tests it is a no-op.
  "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/support/integration-setup.ts"],
          // Tests share one database; run files sequentially for deterministic state.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
