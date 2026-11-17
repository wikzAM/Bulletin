import type { LanesConfig } from "./config";
import { matchesAny } from "./glob";
import { LANES, type Lane } from "./types";

/** The stricter of two lanes: closed beats gated beats open. */
export function stricterLane(a: Lane, b: Lane): Lane {
  return LANES.indexOf(a) >= LANES.indexOf(b) ? a : b;
}

/**
 * The lane a set of file patterns falls in under the repository's lanes configuration.
 * A unit is as strict as its strictest file. Unit `files` are globs themselves, so a
 * pattern counts as a hit when it equals a lane pattern or matches one as a path.
 */
export function computeLane(files: readonly string[], lanes: LanesConfig): Lane {
  const hits = (patterns: readonly string[]) =>
    files.some((f) => patterns.includes(f) || matchesAny(f, patterns));
  if (hits(lanes.closed)) return "closed";
  if (hits(lanes.gated)) return "gated";
  return "open";
}

/** Rule 6: take the stricter of the server's lane and the General's. The General can never lower a lane. */
export function resolveLane(files: readonly string[], requested: Lane, lanes: LanesConfig): Lane {
  return stricterLane(computeLane(files, lanes), requested);
}
