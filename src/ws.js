import { WebSocketServer } from "ws";
import { atLeast, bearerToken } from "./rbac.js";

// WebSocket hub. Clients connect to /ws with ?token=... or an
// Authorization header; any role (viewer+) may subscribe. Every
// broadcast fans out to all open sockets.
export function attachHub(server, storage) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/ws") return socket.destroy();
      const token = url.searchParams.get("token") ?? bearerToken(req.headers.authorization);
      const role = token ? await storage.getRole(token) : null;
      if (!role || !atLeast(role, "viewer")) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return socket.destroy();
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "hello" }));
  });

  return {
    broadcast(obj) {
      const data = JSON.stringify(obj);
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(data);
      }
    },
    clientCount() {
      return wss.clients.size;
    },
    close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
