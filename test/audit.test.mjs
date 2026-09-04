import test from "node:test";
import assert from "node:assert/strict";
import { makeEntry, entryHash, verifyChain, GENESIS } from "../src/audit.js";

function buildChain(n) {
  const entries = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    prev = makeEntry(prev, { actor: "test", action: "act", details: { i } });
    entries.push(prev);
  }
  return entries;
}

test("empty chain verifies", () => {
  assert.deepEqual(verifyChain([]), { ok: true, length: 0 });
});

test("genesis entry links to the zero hash", () => {
  const [first] = buildChain(1);
  assert.equal(first.prevHash, GENESIS);
  assert.equal(first.seq, 1);
});

test("a well-formed chain verifies", () => {
  assert.equal(verifyChain(buildChain(25)).ok, true);
});

test("tampering with a middle entry's details is detected", () => {
  const chain = buildChain(10);
  chain[4].details.i = 999;
  const result = verifyChain(chain);
  assert.equal(result.ok, false);
  assert.equal(result.at, 5);
  assert.equal(result.reason, "entry hash mismatch");
});

test("deleting a middle entry is detected", () => {
  const chain = buildChain(10);
  chain.splice(4, 1);
  assert.equal(verifyChain(chain).ok, false);
});

test("reordering entries is detected", () => {
  const chain = buildChain(10);
  [chain[2], chain[3]] = [chain[3], chain[2]];
  assert.equal(verifyChain(chain).ok, false);
});

test("rewriting an entry and its own hash still breaks the next link", () => {
  const chain = buildChain(10);
  // Attacker tampers with entry 5 and correctly recomputes its own hash —
  // but entry 6 still commits to the old hash, so the chain breaks at 6.
  chain[4] = { ...chain[4], details: { i: 999 } };
  chain[4].hash = entryHash(chain[4]);
  const result = verifyChain(chain);
  assert.equal(result.ok, false);
  assert.equal(result.at, 6);
  assert.equal(result.reason, "broken link to previous entry");
});
