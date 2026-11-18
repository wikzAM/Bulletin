export type Role = "commander" | "member";

export interface Member {
  mission_id: string;
  user_id: string;
  role: Role;
}

export type MissionAction =
  | "approve_closed_lane_merge"
  | "approve_budget_increase"
  | "approve_plan"
  | "answer_question"
  | "claim_unit";

/** Evaluate the membership loaded for the authenticated human. */
export function canPerformMissionAction(member: Member, missionId: string, action: MissionAction): boolean {
  if (member.mission_id !== missionId) return false;

  switch (action) {
    case "approve_closed_lane_merge":
    case "approve_budget_increase":
    case "approve_plan":
      return member.role === "commander";
    case "answer_question":
    case "claim_unit":
      return member.role === "commander" || member.role === "member";
    default:
      return false;
  }
}
