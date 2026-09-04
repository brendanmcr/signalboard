import test from "node:test";
import assert from "node:assert/strict";
import { memoryStorage } from "../src/storage/memory.js";
import { verifyChain } from "../src/audit.js";

const adapters = [["memory", () => memoryStorage()]];

if (process.env.DATABASE_URL) {
  const { pgStorage } = await import("../src/storage/pg.js");
  adapters.push(["pg", () => pgStorage(process.env.DATABASE_URL)]);
}

for (const [name, make] of adapters) {
  test(`[${name}] key roundtrip and unknown token`, async () => {
    const s = make();
    await s.init();
    const key = await s.createKey("poster");
    assert.equal(await s.getRole(key.token), "poster");
    assert.equal(await s.getRole("nope"), null);
    await s.close();
  });

  test(`[${name}] channels and signals`, async () => {
    const s = make();
    await s.init();
    const ch = await s.createChannel(`deploys-${Date.now()}`);
    assert.ok((await s.listChannels()).some((c) => c.id === ch.id));
    await s.addSignal(ch.id, { status: "ok", message: "first", actor: "t" });
    await s.addSignal(ch.id, { status: "down", message: "second", actor: "t" });
    const signals = await s.listSignals(ch.id, 10);
    assert.equal(signals.length, 2);
    assert.equal(signals[0].message, "second"); // newest first
    await s.close();
  });

  test(`[${name}] audit chain grows and verifies through storage`, async () => {
    const s = make();
    await s.init();
    const before = (await s.listAudit()).length;
    for (let i = 0; i < 5; i++) {
      await s.appendAudit({ actor: "t", action: "test.append", details: { i } });
    }
    const entries = await s.listAudit();
    assert.equal(entries.length, before + 5);
    assert.equal(verifyChain(entries).ok, true);
    await s.close();
  });
}
