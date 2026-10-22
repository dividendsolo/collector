/** The repo picker's list, in pure form: every chosen repo, A to Z by repo name.
 *
 * The choice is the source of truth, never the list on screen: filtering the choice by the shown (cached, searched)
 * list dropped a chosen repo the cache no longer had (2026-10-21: docket and ledgar). Client-safe on purpose, so the
 * picker never pulls in the server module that writes the file. */
export function reposToSave(chosen: Iterable<string>): string[] {
  const repoName = (repo: string) => repo.split("/").pop() ?? repo;
  return [...chosen].sort((a, b) => repoName(a).localeCompare(repoName(b), undefined, { sensitivity: "base" }));
}
