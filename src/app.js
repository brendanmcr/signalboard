import express from "express";
import { requireRole, ROLES } from "./rbac.js";
import { verifyChain } from "./audit.js";

const STATUSES = new Set(["ok", "warn", "down"]);

export function createApp(storage, hub) {
  const app = express();
  app.use(express.json({ limit: "16kb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // --- keys (admin) ---
  app.post("/api/keys", requireRole(storage, "admin"), async (req, res, next) => {
    try {
      const { role } = req.body ?? {};
      if (!ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of ${ROLES.join(", ")}` });
      }
      const key = await storage.createKey(role);
      await storage.appendAudit({
        actor: `${req.actor.role}:${req.actor.tokenPrefix}`,
        action: "key.create",
        details: { role, tokenPrefix: key.token.slice(0, 8) },
      });
      res.status(201).json(key);
    } catch (err) {
      next(err);
    }
  });

  // --- channels ---
  app.get("/api/channels", requireRole(storage, "viewer"), async (_req, res, next) => {
    try {
      res.json(await storage.listChannels());
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/channels", requireRole(storage, "admin"), async (req, res, next) => {
    try {
      const { name } = req.body ?? {};
      if (typeof name !== "string" || name.length < 1 || name.length > 80) {
        return res.status(400).json({ error: "name must be 1-80 characters" });
      }
      const channel = await storage.createChannel(name);
      await storage.appendAudit({
        actor: `${req.actor.role}:${req.actor.tokenPrefix}`,
        action: "channel.create",
        details: { channelId: channel.id, name },
      });
      res.status(201).json(channel);
    } catch (err) {
      next(err);
    }
  });

  // --- signals ---
  app.get("/api/channels/:id/signals", requireRole(storage, "viewer"), async (req, res, next) => {
    try {
      const channel = await storage.getChannel(req.params.id);
      if (!channel) return res.status(404).json({ error: "no such channel" });
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      res.json(await storage.listSignals(channel.id, limit));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/channels/:id/signals", requireRole(storage, "poster"), async (req, res, next) => {
    try {
      const channel = await storage.getChannel(req.params.id);
      if (!channel) return res.status(404).json({ error: "no such channel" });
      const { status, message } = req.body ?? {};
      if (!STATUSES.has(status)) {
        return res.status(400).json({ error: "status must be ok, warn, or down" });
      }
      if (typeof message !== "string" || message.length < 1 || message.length > 500) {
        return res.status(400).json({ error: "message must be 1-500 characters" });
      }
      const actor = `${req.actor.role}:${req.actor.tokenPrefix}`;
      const signal = await storage.addSignal(channel.id, { status, message, actor });
      await storage.appendAudit({
        actor,
        action: "signal.post",
        details: { channelId: channel.id, signalId: signal.id, status },
      });
      hub?.broadcast({ type: "signal", signal });
      res.status(201).json(signal);
    } catch (err) {
      next(err);
    }
  });

  // --- audit (admin) ---
  app.get("/api/audit", requireRole(storage, "admin"), async (_req, res, next) => {
    try {
      res.json(await storage.listAudit());
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/audit/verify", requireRole(storage, "admin"), async (_req, res, next) => {
    try {
      res.json(verifyChain(await storage.listAudit()));
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
