import { PlanSchema, type BulletinEvent, type Plan } from "@bulletin/core";
import { z } from "zod";
import { missionLimits } from "./mission-ledger";

const metadataSchema = z.object({
  repo: z.string().min(1),
  base: z.string().min(1),
  goal: z.string().optional(),
});

export interface MissionExecution {
  missionId: string;
  repo: string;
  baseBranch: string;
  briefing?: string;
  plan: Plan;
  budgetCents?: number;
  unitAllowanceCents?: number;
}

export function missionExecution(
  created: BulletinEvent,
  proposed: BulletinEvent | undefined,
  history: readonly BulletinEvent[],
): MissionExecution | undefined {
  const metadata = metadataSchema.safeParse(created.payload);
  const plan = PlanSchema.safeParse(proposed?.payload.plan);
  if (!metadata.success || !plan.success) return undefined;

  const { repo, base, goal } = metadata.data;
  const markdown = history.findLast(({ type }) => type === "briefing.versioned")?.payload.markdown;
  const { budgetCents, unitAllowanceCents } = missionLimits(created, history);
  return {
    missionId: created.mission_id,
    repo,
    baseBranch: base,
    briefing: typeof markdown === "string" ? markdown : goal,
    plan: plan.data,
    ...(budgetCents === null ? {} : { budgetCents }),
    ...(unitAllowanceCents === null ? {} : { unitAllowanceCents }),
  };
}
