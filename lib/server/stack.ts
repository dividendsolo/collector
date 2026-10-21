/** Tech stack: [category, chip, test]. A test is a package name in package.json, a gem in a Gemfile ("gem:..."), or a
 * file name anywhere in the repo ("file:..."); a trailing * matches a package scope ("@radix-ui/*"). Order inside a
 * category is the order the chips show. */
export const STACK: [string, string, string][] = [
  ["Language", "TypeScript", "file:tsconfig.json"],
  ["Language", "Ruby", "file:Gemfile"],
  ["Language", "Python", "file:pyproject.toml"],
  ["Language", "Python", "file:requirements.txt"],
  ["Language", "Go", "file:go.mod"],
  ["Runtime", "Bun", "file:bun.lock"],
  ["Runtime", "Bun", "file:bun.lockb"],
  ["Runtime", "pnpm", "file:pnpm-lock.yaml"],
  ["Runtime", "npm", "file:package-lock.json"],
  ["Framework", "Next.js", "next"],
  ["Framework", "Rails", "gem:rails"],
  ["Framework", "React", "react"],
  ["Framework", "Vite", "vite"],
  ["Framework", "Astro", "astro"],
  ["Framework", "SvelteKit", "@sveltejs/kit"],
  ["Framework", "Remix", "@remix-run/react"],
  ["Framework", "Expo", "expo"],
  ["Framework", "Hono", "hono"],
  ["Framework", "Hotwire", "gem:turbo-rails"],
  ["Framework", "Stimulus", "gem:stimulus-rails"],
  ["Database", "Supabase", "@supabase/supabase-js"],
  ["Database", "Supabase", "@supabase/ssr"],
  ["Database", "Postgres", "postgres"],
  ["Database", "Postgres", "pg"],
  ["Database", "Postgres", "gem:pg"],
  ["Database", "Neon", "@neondatabase/serverless"],
  ["Database", "SQLite", "better-sqlite3"],
  ["Database", "SQLite", "gem:sqlite3"],
  ["Database", "Turso", "@libsql/client"],
  ["Database", "MongoDB", "mongodb"],
  ["Database", "Redis", "@upstash/redis"],
  ["Database", "Redis", "ioredis"],
  ["Database", "Redis", "gem:redis"],
  ["ORM", "Drizzle", "drizzle-orm"],
  ["ORM", "Mongoose", "mongoose"],
  ["ORM", "Prisma", "@prisma/client"],
  ["ORM", "Kysely", "kysely"],
  ["Jobs", "Solid Queue", "gem:solid_queue"],
  ["Jobs", "Sidekiq", "gem:sidekiq"],
  ["Jobs", "Inngest", "inngest"],
  ["Auth", "Clerk", "@clerk/nextjs"],
  ["Auth", "Auth.js", "next-auth"],
  ["Auth", "Auth.js", "@auth/core"],
  ["Auth", "Better Auth", "better-auth"],
  ["UI", "Tailwind", "tailwindcss"],
  ["UI", "Tailwind", "gem:tailwindcss-rails"],
  ["UI", "shadcn/ui", "file:components.json"],
  ["UI", "Radix", "radix-ui"],
  ["UI", "Radix", "@radix-ui/*"],
  ["UI", "Recharts", "recharts"],
  ["UI", "Motion", "motion"],
  ["UI", "Motion", "framer-motion"],
  ["UI", "MapLibre", "maplibre-gl"],
  ["UI", "D3", "d3"],
  ["UI", "Importmap", "gem:importmap-rails"],
  ["Payments", "Stripe", "stripe"],
  ["Payments", "Stripe", "gem:stripe"],
  ["Payments", "Polar", "@polar-sh/sdk"],
  ["Email", "Resend", "resend"],
  ["Email", "React Email", "@react-email/components"],
  ["AI", "Anthropic SDK", "@anthropic-ai/sdk"],
  ["AI", "OpenAI SDK", "openai"],
  ["AI", "AI SDK", "ai"],
  ["Analytics", "Vercel Analytics", "@vercel/analytics"],
  ["Analytics", "PostHog", "posthog-js"],
  ["Analytics", "DataFast", "@datafast/*"],
  ["Monitoring", "Sentry", "@sentry/nextjs"],
  ["Security", "Arcjet", "@arcjet/next"],
  ["Testing", "Vitest", "vitest"],
  ["Testing", "Playwright", "@playwright/test"],
  ["Testing", "Jest", "jest"],
  ["Testing", "Capybara", "gem:capybara"],
  ["Tooling", "Biome", "@biomejs/biome"],
  ["Tooling", "ESLint", "eslint"],
  ["Tooling", "RuboCop", "gem:rubocop"],
  ["Tooling", "RuboCop", "gem:rubocop-rails-omakase"],
];

export interface StackGroup {
  category: string;
  items: string[];
}

/** Chips grouped by category from the repo's file names, package.json deps, and Gemfile gems. */
export function stackChips(
  paths: Iterable<string>,
  deps: Set<string>,
  gems: Set<string>,
  hosting: string | null,
): StackGroup[] {
  const all = [...paths];
  const names = new Set(all.map((p) => p.split("/").pop() as string));
  if (all.some((p) => p.endsWith(".py"))) names.add("pyproject.toml");
  const found = new Map<string, string[]>();
  for (const [category, chip, test] of STACK) {
    const i = test.lastIndexOf(":");
    const kind = i < 0 ? "" : test.slice(0, i);
    const name = test.slice(i + 1);
    const hit = name.endsWith("*")
      ? [...deps].some((d) => d.startsWith(name.slice(0, -1)))
      : kind === "file"
        ? names.has(name)
        : kind === "gem"
          ? gems.has(name)
          : deps.has(name);
    if (!found.has(category)) found.set(category, []);
    const list = found.get(category) as string[];
    if (hit && !list.includes(chip)) list.push(chip);
  }
  if (hosting) found.set("Hosting", [hosting]);
  return [...found].filter(([, items]) => items.length).map(([category, items]) => ({ category, items }));
}

/** Gem names in a Gemfile. */
export const gemsOf = (text: string) => new Set([...text.matchAll(/^\s*gem\s+['"]([\w-]+)['"]/gm)].map((m) => m[1]));

/** The paths of package.json (or Gemfile) at the root or one folder down, outside node_modules. */
export const near = (paths: string[], file: string) =>
  paths.filter(
    (p) => p === file || (p.split("/").length === 2 && p.endsWith(`/${file}`) && !p.includes("node_modules")),
  );
