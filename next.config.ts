import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  distDir: process.env.COLLECTOR_DIST_DIR || ".next",
  typescript: process.env.COLLECTOR_DIST_DIR ? { tsconfigPath: "tsconfig.rebuild.json" } : undefined,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
