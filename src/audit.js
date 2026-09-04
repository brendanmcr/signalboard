// Hash-chained audit log.
//
// Each entry commits to the previous entry's hash, so any mutation,
// deletion, or reordering of history is detectable by re-walking the
// chain. The hash input is a canonical string built from the entry's
// fields; `details` is committed as its exact JSON serialization.

import { createHash } from "node:crypto";

export const GENESIS = "0".repeat(64);

export function entryHash({ seq, ts, actor, action, details, prevHash }) {
  const input = `${seq}|${ts}|${actor}|${action}|${JSON.stringify(details)}|${prevHash}`;
  return createHash("sha256").update(input).digest("hex");
}

export function makeEntry(prev, { actor, action, details }) {
  const seq = prev ? prev.seq + 1 : 1;
  const ts = new Date().toISOString();
  const prevHash = prev ? prev.hash : GENESIS;
  const entry = { seq, ts, actor, action, details, prevHash };
  entry.hash = entryHash(entry);
  return entry;
}

export function verifyChain(entries) {
  let prevHash = GENESIS;
  let prevSeq = 0;
  for (const e of entries) {
    if (e.seq !== prevSeq + 1) {
      return { ok: false, at: e.seq, reason: "sequence gap" };
    }
    if (e.prevHash !== prevHash) {
      return { ok: false, at: e.seq, reason: "broken link to previous entry" };
    }
    if (entryHash(e) !== e.hash) {
      return { ok: false, at: e.seq, reason: "entry hash mismatch" };
    }
    prevHash = e.hash;
    prevSeq = e.seq;
  }
  return { ok: true, length: entries.length };
}
