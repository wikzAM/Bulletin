import type { RepoInspection } from "./desktop-bridge";

export type { RepoInspection };

/** Plain sentences for `repo.inspect` (docs/SIDECAR.md). No commits means the repository tracks no files. */
export function repoInspectionLines(info: RepoInspection): string[] {
  if (!info.exists) return ["That folder was not found."];
  if (!info.is_repo) {
    if (info.root) return [`This folder sits inside a repository at ${info.root}.`];
    return ["This folder is not a git repository."];
  }
  const lines: string[] = [];
  if (info.file_count === 0) lines.push("This repository has no commits yet.");
  else if (info.branch) lines.push(`On branch ${info.branch}.`);
  else lines.push("Checked out without a branch name.");
  if (info.dirty) lines.push("There are uncommitted changes.");
  else if (info.file_count !== 0) lines.push("No uncommitted changes.");
  return lines;
}
