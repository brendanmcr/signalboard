import { randomUUID, randomBytes } from "node:crypto";
import { makeEntry } from "../audit.js";

// Reference storage adapter. The Postgres adapter implements the same
// contract; test/storage.test.mjs runs the contract against both.

export function memoryStorage() {
  const keys = new Map(); // token -> role
  const channels = new Map(); // id -> channel
  const signals = new Map(); // channelId -> signal[]
  const audit = [];

  return {
    kind: "memory",
    async init() {},
    async close() {},

    async createKey(role) {
      const token = randomBytes(24).toString("hex");
      keys.set(token, role);
      return { token, role };
    },
    async putKey(token, role) {
      keys.set(token, role);
    },
    async getRole(token) {
      return keys.get(token) ?? null;
    },

    async createChannel(name) {
      const channel = { id: randomUUID(), name, createdAt: new Date().toISOString() };
      channels.set(channel.id, channel);
      signals.set(channel.id, []);
      return channel;
    },
    async listChannels() {
      return [...channels.values()];
    },
    async getChannel(id) {
      return channels.get(id) ?? null;
    },

    async addSignal(channelId, { status, message, actor }) {
      const signal = {
        id: randomUUID(),
        channelId,
        status,
        message,
        actor,
        ts: new Date().toISOString(),
      };
      signals.get(channelId).push(signal);
      return signal;
    },
    async listSignals(channelId, limit = 50) {
      return (signals.get(channelId) ?? []).slice(-limit).reverse();
    },

    async appendAudit({ actor, action, details }) {
      const prev = audit[audit.length - 1] ?? null;
      const entry = makeEntry(prev, { actor, action, details });
      audit.push(entry);
      return entry;
    },
    async listAudit() {
      return audit.map((e) => ({ ...e }));
    },
  };
}
