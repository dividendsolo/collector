import { config } from "./config";
import { run } from "./run";
import { once } from "./store";
import { cardText } from "./text";

const cards = once(
  "cards",
  () => new Map<string, { at: number; card: { title: string; text: string; url: string } }>(),
);

/** What a running card is for, for the Card column's tooltip. The repo's owner comes from the chosen projects (or
 * any owner they use). Cached ten minutes; a failed read is tried again on the next hover. */
export async function card(repo: string, number: number) {
  const key = `${repo}#${number}`;
  const hit = cards.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.card;
  const chosen = config().projects || [];
  const exact = chosen.filter((p) => p.split("/").pop() === repo);
  const names = exact.length ? exact : [...new Set(chosen.map((p) => p.split("/")[0]))].map((o) => `${o}/${repo}`);
  for (const name of names) {
    const [data] = await run(["gh", "issue", "view", String(number), "-R", name, "--json", "title,body,url"], {
      timeout: 20,
    });
    if (data) {
      const found = { title: data.title, text: cardText(data.body || ""), url: data.url };
      cards.set(key, { at: Date.now(), card: found });
      return found;
    }
  }
  return null;
}
