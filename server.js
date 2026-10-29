import { createApp } from "./web-server.js";
const { server, close } = createApp();
server.listen(process.env.PORT || 3000, () =>
  console.log(`TogetherPlay listening on port ${server.address().port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await close();
    process.exit(0);
  });
