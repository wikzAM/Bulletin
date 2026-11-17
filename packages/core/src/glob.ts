import picomatch from "picomatch";

/** Normalise a repo-relative path: forward slashes, no leading "./". */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** True when `path` matches any of the glob `patterns` (dotfiles included). */
export function matchesAny(path: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;
  return picomatch([...patterns], { dot: true })(normalizePath(path));
}
