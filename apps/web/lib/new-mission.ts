import { copy } from "./copy";

export const GOAL_MIN_LENGTH = 10;
export const GOAL_MAX_LENGTH = 2000;

const GITHUB_REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export interface NewMissionInput {
  goal: string;
  repo: string;
}

export type NewMissionCheck =
  | { ok: true; value: NewMissionInput }
  | { ok: false; errors: Partial<Record<keyof NewMissionInput, string>> };

/** The repository is a local folder (local runner) or a GitHub URL (cloud runner), per spec F1. */
export function validateNewMission(input: NewMissionInput): NewMissionCheck {
  const e = copy.newMission.errors;
  const goal = input.goal.trim();
  const repo = input.repo.trim();
  const errors: Partial<Record<keyof NewMissionInput, string>> = {};

  if (goal.length === 0) errors.goal = e.goalEmpty;
  else if (goal.length < GOAL_MIN_LENGTH) errors.goal = e.goalShort(GOAL_MIN_LENGTH);
  else if (goal.length > GOAL_MAX_LENGTH) errors.goal = e.goalLong(GOAL_MAX_LENGTH);

  if (repo.length === 0) errors.repo = e.repoEmpty;
  else if (HAS_SCHEME.test(repo) && !GITHUB_REPO.test(repo)) errors.repo = e.repoUrl;

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { goal, repo } };
}

export { planBatches, type PlanBatches } from "./plan";
