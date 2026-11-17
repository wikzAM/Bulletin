import { createServer } from "node:http";

/**
 * The pass-worker runs deterministic checks on a clean checkout of a unit branch.
 * M0: a health endpoint only. The check runner (Docker) arrives with M1; the verdict
 * rules live in ./judge.
 */
const port = Number(process.env.PASS_WORKER_PORT ?? 4100);

createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "pass-worker" }));
    return;
  }
  res.writeHead(404).end();
}).listen(port, "0.0.0.0", () => console.log(`pass-worker listening on ${port}`));
