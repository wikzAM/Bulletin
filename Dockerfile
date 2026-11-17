# One image for the api and the pass-worker; docker-compose picks the command.
FROM node:24-slim
RUN npm install -g pnpm@10.34.9
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/pass-worker/package.json apps/pass-worker/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/graph/package.json packages/graph/
COPY packages/runners/package.json packages/runners/
COPY packages/bulletin-mcp/package.json packages/bulletin-mcp/
COPY packages/prompts/package.json packages/prompts/
COPY packages/db/package.json packages/db/
COPY examples/todo-app/package.json examples/todo-app/
RUN pnpm install --frozen-lockfile
COPY . .
CMD ["pnpm", "--filter", "@bulletin/api", "start"]
