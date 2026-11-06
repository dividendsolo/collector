import path from "node:path";
import { defineConfig } from "vitest/config";
import NoSkipReporter from "./vitest.no-skip";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { reporters: ["default", new NoSkipReporter()], include: ["tests/**/*.test.ts"], environment: "node" },
});
