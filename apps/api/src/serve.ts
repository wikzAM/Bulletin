import { createApplication } from "./application";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer from 0 to 65535");

  const { app } = await createApplication();
  try {
    const address = await app.listen({ port, host: "127.0.0.1" });
    console.log(`api listening on ${address}`);
  } catch (error) {
    await app.close();
    throw error;
  }

  function stop() {
    void app.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
