import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The live Collector's rebuild job (card #29) builds into a folder of its own and swaps it in only once the build
  // succeeded: `next build` empties its distDir before it compiles, so a build into the served `.next` would take
  // the page down for the whole build, and for good when it fails. `next start` and `next dev` never set this.
  distDir: process.env.COLLECTOR_DIST_DIR || ".next",
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
