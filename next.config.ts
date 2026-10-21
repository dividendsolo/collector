import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The readers shell out (ssh, gh, security, whois) and keep caches in memory: Node runtime only.
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
