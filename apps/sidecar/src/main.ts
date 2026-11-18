import { createInterface } from "node:readline";
import { createApplication } from "../../api/src/application";

type RpcId = string | number | null;
type Application = Awaited<ReturnType<typeof createApplication>>;
type Subscription = { missionId: string; after: number; index: number };

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcId(value: unknown): value is RpcId {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function send(frame: object): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`, (error) => error ? reject(error) : resolve());
  });
}

async function proxy(app: Application["app"], params: Record<string, unknown>) {
  const { method, path, body } = params;
  if (typeof method !== "string" || !/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/i.test(method) ||
    typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /[\r\n#]/.test(path)) {
    throw new RpcError(-32602, "Expected an HTTP method and a root-relative API path");
  }
  const token = process.env.BULLETIN_API_TOKEN;
  const response = await app.inject({
    method: method.toUpperCase(),
    url: path,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
    payloadAsStream: true,
  });
  const contentType = String(response.headers["content-type"] ?? "");
  if (contentType.startsWith("text/event-stream")) {
    response.stream().destroy();
    response.raw.res.destroy();
    throw new RpcError(-32602, "Use subscribe for mission events");
  }

  let raw = "";
  for await (const chunk of response.stream().setEncoding("utf8")) raw += chunk;
  return { status: response.statusCode, body: raw === "" ? null : contentType.includes("json") ? JSON.parse(raw) : raw };
}

async function main() {
  const { app, log } = await createApplication();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const subscriptions = new Map<number, Subscription>();
  const pending = new Set<Promise<void>>();
  let nextSubscription = 1;
  let pumping: Promise<void> | undefined;
  let shuttingDown = false;

  function fail() {
    process.exitCode = 1;
    input.close();
    process.stdin.pause();
  }

  async function dispatch(method: string, params: Record<string, unknown>, newSubscriptions: Map<number, Subscription>) {
    switch (method) {
      case "health":
        return (await proxy(app, { method: "GET", path: "/health" })).body;
      case "request":
        return proxy(app, params);
      case "subscribe": {
        const { mission_id, after = 0 } = params;
        if (typeof mission_id !== "string" || mission_id.trim().length === 0 || !integer(after, 0)) {
          throw new RpcError(-32602, "Expected a mission ID and a non-negative event cursor");
        }
        if (!log.events.some((event) => event.mission_id === mission_id && event.type === "mission.created")) {
          throw new RpcError(-32004, "Mission not found");
        }
        const firstUnseen = log.events.findIndex((event) => event.id > after);
        const id = nextSubscription++;
        newSubscriptions.set(id, { missionId: mission_id, after, index: firstUnseen < 0 ? log.events.length : firstUnseen });
        return { subscription_id: id };
      }
      case "unsubscribe": {
        const { subscription_id } = params;
        if (!integer(subscription_id, 1)) throw new RpcError(-32602, "Expected a subscription ID");
        return { unsubscribed: subscriptions.delete(subscription_id) };
      }
      default:
        throw new RpcError(-32601, "Method not found");
    }
  }

  async function handle(line: string) {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      await send({ id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    if (!record(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string" ||
      (Object.hasOwn(request, "id") && !rpcId(request.id))) {
      await send({ id: null, error: { code: -32600, message: "Invalid request" } });
      return;
    }
    const { id, method, params = {} } = request;
    const newSubscriptions = new Map<number, Subscription>();
    let outcome: object;
    try {
      if (!record(params)) throw new RpcError(-32602, "Expected named parameters");
      if (id === undefined && method === "subscribe") return;
      outcome = { result: await dispatch(method, params, newSubscriptions) };
    } catch (error) {
      outcome = { error: error instanceof RpcError ? { code: error.code, message: error.message }
        : { code: -32603, message: "Internal error" } };
    }
    // Queue the acknowledgement before registering the subscription so it
    // precedes replay, and an immediate unsubscribe can find the subscription.
    const response = id === undefined ? undefined : send({ id, ...outcome });
    if (!shuttingDown) for (const [subscriptionId, subscription] of newSubscriptions) subscriptions.set(subscriptionId, subscription);
    await response;
  }

  async function pump() {
    for (const [id, subscription] of subscriptions) {
      const end = log.events.length;
      while (subscriptions.has(id) && subscription.index < end) {
        const event = log.events[subscription.index++];
        if (event && event.id > subscription.after && event.mission_id === subscription.missionId) {
          await send({ method: "event", params: { subscription_id: id, event } });
        }
      }
    }
  }

  const poll = setInterval(() => {
    pumping ??= pump().catch(fail).finally(() => { pumping = undefined; });
  }, 50).unref();
  input.on("line", (line) => {
    const task = handle(line).catch(fail).finally(() => { pending.delete(task); });
    pending.add(task);
  });
  const stop = () => { input.close(); process.stdin.pause(); };
  process.stdout.on("error", fail);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await new Promise<void>((resolve) => input.once("close", resolve));
  } finally {
    shuttingDown = true;
    clearInterval(poll);
    subscriptions.clear();
    await Promise.all([...pending, pumping]);
    await app.close();
    process.stdout.removeListener("error", fail);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch(() => {
  console.error("Sidecar failed to start or shut down");
  process.exitCode = 1;
});
