export function reposToSave(chosen: Iterable<string>): string[] {
  const repoName = (repo: string) => repo.split("/").pop() ?? repo;
  return [...chosen].sort((a, b) => repoName(a).localeCompare(repoName(b), undefined, { sensitivity: "base" }));
}
