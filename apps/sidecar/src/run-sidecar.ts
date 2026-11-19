import { createInterface } from "node:readline";
import type { createApplication } from "../../api/src/application";
import { EnvKeychain } from "../../api/src/platform/keychain";
import { appDataDirectory } from "../../api/src/platform/paths";
import { MissionEventFeed } from "../../api/src/routes/mission-event-feed";
import { createDesktopMethods } from "./methods";
import { RpcError } from "./rpc-error";

type RpcId = string | number | null;
type Application = Awaited<ReturnType<typeof createApplication>>;
type Subscription = { missionId: string; after: number };
const keychain = new EnvKeychain();
const shutdownGraceMs = 4_500;

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
  const token = await keychain.getSecret("BULLETIN_API_TOKEN");
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

export async function runSidecar({ app, log, stopMissions }: Application) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const desktop = createDesktopMethods({ dataDirectory: appDataDirectory(), keychain });
  const feed = new MissionEventFeed(log);
  const subscriptions = new Map<number, () => void>();
  const pending = new Set<Promise<void>>();
  let nextSubscription = 1;
  let shuttingDown = false;
  let shutdownDeadline: NodeJS.Timeout | undefined;

  function fail() {
    process.exitCode = 1;
    stop();
  }

  function stop() {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownDeadline = setTimeout(() => {
      // SQLite commits each append before publishing it. Close the connection
      // even if a runner or an in-flight request never returned after abort.
      void log.close().catch(fail).finally(() => process.exit(process.exitCode ?? 0));
    }, shutdownGraceMs);
    stopMissions();
    input.close();
    // A paused Windows pipe keeps the process alive while the client is connected.
    process.stdin.destroy();
  }

  async function dispatch(method: string, params: Record<string, unknown>, newSubscriptions: Map<number, Subscription>) {
    switch (method) {
      case "health":
        return (await proxy(app, { method: "GET", path: "/health" })).body;
      case "request":
        return proxy(app, params);
      case "shutdown":
        if (Object.keys(params).length) throw new RpcError(-32602, "Shutdown takes no parameters");
        stop();
        return { status: "shutting_down" };
      case "subscribe": {
        const { mission_id, after = 0 } = params;
        if (typeof mission_id !== "string" || mission_id.trim().length === 0 || !integer(after, 0)) {
          throw new RpcError(-32602, "Expected a mission ID and a non-negative event cursor");
        }
        if (!log.events.some((event) => event.mission_id === mission_id && event.type === "mission.created")) {
          throw new RpcError(-32004, "Mission not found");
        }
        const id = nextSubscription++;
        newSubscriptions.set(id, { missionId: mission_id, after });
        return { subscription_id: id };
      }
      case "unsubscribe": {
        const { subscription_id } = params;
        if (!integer(subscription_id, 1)) throw new RpcError(-32602, "Expected a subscription ID");
        subscriptions.get(subscription_id)?.();
        return { unsubscribed: subscriptions.delete(subscription_id) };
      }
      default: {
        const handler = Object.hasOwn(desktop, method) ? desktop[method] : undefined;
        if (!handler) throw new RpcError(-32601, "Method not found");
        return handler(params);
      }
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
    if (!shuttingDown) {
      for (const [subscription_id, { missionId, after }] of newSubscriptions) {
        const unsubscribe = feed.subscribe(missionId, after, {
          event: (event) => send({ method: "event", params: { subscription_id, event } }),
          end: () => subscriptions.delete(subscription_id),
          error: fail,
        });
        subscriptions.set(subscription_id, unsubscribe);
      }
    }
    await response;
  }
  input.on("line", (line) => {
    if (shuttingDown) return;
    const task = handle(line).catch(fail).finally(() => { pending.delete(task); });
    pending.add(task);
  });
  process.stdout.on("error", fail);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await new Promise<void>((resolve) => input.once("close", resolve));
  } finally {
    stop();
    subscriptions.clear();
    try {
      await Promise.all([...pending, feed.close()]);
    } finally {
      await app.close();
      // Let clean shutdown exit immediately. Keep the deadline available if a
      // runner left another handle open.
      shutdownDeadline?.unref();
      process.stdout.removeListener("error", fail);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  }
}
