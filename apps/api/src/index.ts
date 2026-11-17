import { buildServer } from "./server";

const port = Number(process.env.API_PORT ?? 4000);

buildServer()
  .listen({ port, host: "0.0.0.0" })
  .then((address) => console.log(`api listening on ${address}`))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
