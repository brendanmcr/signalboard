import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket from "ws";
import { memoryStorage } from "../src/storage/memory.js";
import { createApp } from "../src/app.js";
import { attachHub } from "../src/ws.js";

async function boot() {
  const storage = memoryStorage();
  await storage.init();
  const admin = await storage.createKey("admin");
  const poster = await storage.createKey("poster");
  const viewer = await storage.createKey("viewer");
  const server = createServer();
  const hub = attachHub(server, storage);
  server.on("request", createApp(storage, hub));
  server.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    admin,
    poster,
    viewer,
    async stop() {
      hub.close();
      server.close();
      await storage.close();
    },
  };
}

function req(base, path, { method = "GET", token, body } = {}) {
  return fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("api: rejects missing and unknown tokens", async () => {
  const s = await boot();
  try {
    assert.equal((await req(s.base, "/api/channels")).status, 401);
    assert.equal((await req(s.base, "/api/channels", { token: "bogus" })).status, 401);
  } finally {
    await s.stop();
  }
});

test("api: role hierarchy is enforced", async () => {
  const s = await boot();
  try {
    // viewer cannot create channels; poster cannot either; admin can
    const mk = (token) =>
      req(s.base, "/api/channels", { method: "POST", token, body: { name: "deploys" } });
    assert.equal((await mk(s.viewer.token)).status, 403);
    assert.equal((await mk(s.poster.token)).status, 403);
    const created = await mk(s.admin.token);
    assert.equal(created.status, 201);
    const channel = await created.json();

    // viewer cannot post signals; poster can
    const post = (token) =>
      req(s.base, `/api/channels/${channel.id}/signals`, {
        method: "POST",
        token,
        body: { status: "ok", message: "all good" },
      });
    assert.equal((await post(s.viewer.token)).status, 403);
    assert.equal((await post(s.poster.token)).status, 201);

    // viewer can read
    const list = await req(s.base, `/api/channels/${channel.id}/signals`, {
      token: s.viewer.token,
    });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).length, 1);

    // audit endpoints are admin-only
    assert.equal((await req(s.base, "/api/audit", { token: s.poster.token })).status, 403);
    assert.equal((await req(s.base, "/api/audit", { token: s.admin.token })).status, 200);
  } finally {
    await s.stop();
  }
});

test("api: input validation", async () => {
  const s = await boot();
  try {
    const ch = await (
      await req(s.base, "/api/channels", {
        method: "POST",
        token: s.admin.token,
        body: { name: "ops" },
      })
    ).json();
    const bad = await req(s.base, `/api/channels/${ch.id}/signals`, {
      method: "POST",
      token: s.poster.token,
      body: { status: "exploded", message: "??" },
    });
    assert.equal(bad.status, 400);
    const noMsg = await req(s.base, `/api/channels/${ch.id}/signals`, {
      method: "POST",
      token: s.poster.token,
      body: { status: "ok", message: "" },
    });
    assert.equal(noMsg.status, 400);
    const badRole = await req(s.base, "/api/keys", {
      method: "POST",
      token: s.admin.token,
      body: { role: "root" },
    });
    assert.equal(badRole.status, 400);
  } finally {
    await s.stop();
  }
});

test("api: mutations land in a verifiable audit chain", async () => {
  const s = await boot();
  try {
    const ch = await (
      await req(s.base, "/api/channels", {
        method: "POST",
        token: s.admin.token,
        body: { name: "audit-me" },
      })
    ).json();
    for (let i = 0; i < 3; i++) {
      await req(s.base, `/api/channels/${ch.id}/signals`, {
        method: "POST",
        token: s.poster.token,
        body: { status: "ok", message: `beat ${i}` },
      });
    }
    const verify = await (
      await req(s.base, "/api/audit/verify", { token: s.admin.token })
    ).json();
    assert.equal(verify.ok, true);
    assert.ok(verify.length >= 4);

    const entries = await (await req(s.base, "/api/audit", { token: s.admin.token })).json();
    // No full tokens anywhere in the audit log
    for (const e of entries) {
      assert.ok(!JSON.stringify(e).includes(s.admin.token));
      assert.ok(!JSON.stringify(e).includes(s.poster.token));
    }
  } finally {
    await s.stop();
  }
});

test("ws: viewer receives fan-out; unauthenticated upgrade is rejected", async () => {
  const s = await boot();
  try {
    const wsUrl = s.base.replace("http", "ws") + `/ws?token=${s.viewer.token}`;
    const ws = new WebSocket(wsUrl);
    const messages = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await once(ws, "open");

    // wait for hello
    while (messages.length < 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(messages[0].type, "hello");

    const ch = await (
      await req(s.base, "/api/channels", {
        method: "POST",
        token: s.admin.token,
        body: { name: "live" },
      })
    ).json();
    await req(s.base, `/api/channels/${ch.id}/signals`, {
      method: "POST",
      token: s.poster.token,
      body: { status: "warn", message: "deploy rolling" },
    });

    while (messages.length < 2) await new Promise((r) => setTimeout(r, 10));
    assert.equal(messages[1].type, "signal");
    assert.equal(messages[1].signal.status, "warn");
    ws.close();

    // bad token upgrade is refused
    const bad = new WebSocket(s.base.replace("http", "ws") + "/ws?token=nope");
    const [err] = await once(bad, "error");
    assert.ok(err);
  } finally {
    await s.stop();
  }
});
