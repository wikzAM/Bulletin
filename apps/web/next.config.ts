import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@bulletin/core"],
  // The repo's own AGENTS.md and CLAUDE.md are the agent rules; next dev must not write another.
  agentRules: false,
};

export default config;
