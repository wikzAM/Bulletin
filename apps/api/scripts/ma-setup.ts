// One-time: create the Managed Agents environment and agent, and save their ids (not secrets)
// to .bulletin-local.json at the repo root. Needs ANTHROPIC_API_KEY in the shell that runs it.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set in this shell.");
  process.exit(1);
}
const client = new Anthropic();

const environment = await client.beta.environments.create({
  name: "bulletin-stations",
  config: { type: "cloud", networking: { type: "limited", allow_package_managers: true, allow_mcp_servers: false } },
} as never);

const agent = await client.beta.agents.create({
  name: "Bulletin station",
  model: "claude-sonnet-5-5",
  system:
    "You are a station in Bulletin. Build exactly one unit of work, touch only the files you are told to, " +
    "make the acceptance commands pass, then commit and push to the branch you are given.",
  tools: [
    {
      type: "agent_toolset_20260401",
      default_config: { enabled: true, permission_policy: { type: "auto" } },
      configs: [
        { name: "web_fetch", enabled: false },
        { name: "web_search", enabled: false },
      ],
    },
  ],
} as never);

const out = resolve(import.meta.dirname, "../../../.bulletin-local.json");
writeFileSync(out, JSON.stringify({ agentId: (agent as { id: string }).id, environmentId: (environment as { id: string }).id }, null, 2));
console.log(`agent ${(agent as { id: string }).id}, environment ${(environment as { id: string }).id}`);
console.log(`saved to ${out}`);
