import { Dash } from "./ui";

/**
 * A card number, wherever Collector shows one (collector#146). It opens the card's journey in Collector — the page
 * that replays the card's whole history on the flow — and the journey page carries the link to GitHub, so one
 * number means one thing on every page. The hover tooltip is the card tip, exactly as it was.
 *
 * A run whose repo is unknown shows its number as plain text: there is no journey to open without a repo.
 */
export function CardRef({ repo, number, label }: { repo?: string | null; number?: number | null; label?: string }) {
  if (number == null) return <Dash />;
  const text = label ?? `#${number}`;
  if (!repo)
    return (
      <span className="plain mono card-tip" tabIndex={0} data-card={number}>
        {text}
      </span>
    );
  return (
    <a className="plain mono card-tip" href={`#/card/${repo}/${number}`} data-repo={repo} data-card={number}>
      {text}
    </a>
  );
}
