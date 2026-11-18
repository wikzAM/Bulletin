import { describe, expect, it } from "vitest";
import { canPerformMissionAction, type Member, type Role } from "./member";

const missionId = "mission-1";
const commander: Member = { mission_id: missionId, user_id: "commander-1", role: "commander" };
const member: Member = { mission_id: missionId, user_id: "member-1", role: "member" };

describe("mission member roles", () => {
  const commanderOnly = ["approve_closed_lane_merge", "approve_budget_increase", "approve_plan"] as const;
  it.each(commanderOnly)("allows only the Commander to %s", (action) => {
    expect(canPerformMissionAction(commander, missionId, action)).toBe(true);
    expect(canPerformMissionAction(member, missionId, action)).toBe(false);
  });

  it.each(["commander", "member"] satisfies Role[])("lets a %s answer questions and claim units", (role) => {
    const actor = { ...member, role };
    expect(canPerformMissionAction(actor, missionId, "answer_question")).toBe(true);
    expect(canPerformMissionAction(actor, missionId, "claim_unit")).toBe(true);
  });

  it("limits permissions to the mission named by the membership", () => {
    expect(canPerformMissionAction(commander, "mission-2", "approve_plan")).toBe(false);
    expect(canPerformMissionAction(member, "mission-2", "answer_question")).toBe(false);
  });
});
