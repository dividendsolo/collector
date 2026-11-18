import { Dash } from "./ui";

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
