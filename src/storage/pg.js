import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { makeEntry } from "../audit.js";

const AUDIT_LOCK = 4242; // advisory lock key serializing audit appends

// Audit columns are stored as text (not timestamptz/jsonb) deliberately:
// the chain hash commits to the exact serialized bytes, and round-tripping
// through jsonb or timestamptz can reorder keys / reformat timestamps,
// which would break verification of untampered history.

export function pgStorage(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10 });

  return {
    kind: "pg",
    async init() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    },

    async createKey(role) {
      const token = randomBytes(24).toString("hex");
      await pool.query("INSERT INTO api_keys (token, role) VALUES ($1, $2)", [token, role]);
      return { token, role };
    },
    async putKey(token, role) {
      await pool.query(
        "INSERT INTO api_keys (token, role) VALUES ($1, $2) ON CONFLICT (token) DO UPDATE SET role = $2",
        [token, role]
      );
    },
    async getRole(token) {
      const r = await pool.query("SELECT role FROM api_keys WHERE token = $1", [token]);
      return r.rows[0]?.role ?? null;
    },

    async createChannel(name) {
      const id = randomUUID();
      const r = await pool.query(
        "INSERT INTO channels (id, name) VALUES ($1, $2) RETURNING id, name, created_at",
        [id, name]
      );
      const row = r.rows[0];
      return { id: row.id, name: row.name, createdAt: row.created_at.toISOString() };
    },
    async listChannels() {
      const r = await pool.query("SELECT id, name, created_at FROM channels ORDER BY created_at");
      return r.rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at.toISOString() }));
    },
    async getChannel(id) {
      const r = await pool.query("SELECT id, name, created_at FROM channels WHERE id = $1", [id]);
      const row = r.rows[0];
      return row ? { id: row.id, name: row.name, createdAt: row.created_at.toISOString() } : null;
    },

    async addSignal(channelId, { status, message, actor }) {
      const id = randomUUID();
      const ts = new Date().toISOString();
      await pool.query(
        "INSERT INTO signals (id, channel_id, status, message, actor, ts) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, channelId, status, message, actor, ts]
      );
      return { id, channelId, status, message, actor, ts };
    },
    async listSignals(channelId, limit = 50) {
      const r = await pool.query(
        "SELECT id, channel_id, status, message, actor, ts FROM signals WHERE channel_id = $1 ORDER BY ts DESC LIMIT $2",
        [channelId, limit]
      );
      return r.rows.map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        status: row.status,
        message: row.message,
        actor: row.actor,
        ts: row.ts,
      }));
    },

    async appendAudit({ actor, action, details }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [AUDIT_LOCK]);
        const last = await client.query(
          "SELECT seq, ts, actor, action, details, prev_hash, hash FROM audit_log ORDER BY seq DESC LIMIT 1"
        );
        const prev = last.rows[0]
          ? {
              seq: Number(last.rows[0].seq),
              ts: last.rows[0].ts,
              actor: last.rows[0].actor,
              action: last.rows[0].action,
              details: JSON.parse(last.rows[0].details),
              prevHash: last.rows[0].prev_hash,
              hash: last.rows[0].hash,
            }
          : null;
        const entry = makeEntry(prev, { actor, action, details });
        await client.query(
          "INSERT INTO audit_log (seq, ts, actor, action, details, prev_hash, hash) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [entry.seq, entry.ts, entry.actor, entry.action, JSON.stringify(entry.details), entry.prevHash, entry.hash]
        );
        await client.query("COMMIT");
        return entry;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async listAudit() {
      const r = await pool.query(
        "SELECT seq, ts, actor, action, details, prev_hash, hash FROM audit_log ORDER BY seq"
      );
      return r.rows.map((row) => ({
        seq: Number(row.seq),
        ts: row.ts,
        actor: row.actor,
        action: row.action,
        details: JSON.parse(row.details),
        prevHash: row.prev_hash,
        hash: row.hash,
      }));
    },
  };
}
