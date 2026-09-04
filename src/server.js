import { createServer } from "node:http";
import { storageFromEnv } from "./storage/index.js";
import { createApp } from "./app.js";
import { attachHub } from "./ws.js";

const storage = storageFromEnv();
await storage.init();

// Bootstrap keys from env so a fresh deploy is usable. Tokens come from
// the environment; they are never generated-and-printed here.
if (process.env.ADMIN_KEY) await storage.putKey(process.env.ADMIN_KEY, "admin");
if (process.env.POSTER_KEY) await storage.putKey(process.env.POSTER_KEY, "poster");
if (process.env.VIEWER_KEY) await storage.putKey(process.env.VIEWER_KEY, "viewer");

const server = createServer();
const hub = attachHub(server, storage);
const app = createApp(storage, hub);
server.on("request", app);

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`signalboard (${storage.kind}) listening on :${port}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    hub.close();
    server.close();
    await storage.close();
    process.exit(0);
  });
}
