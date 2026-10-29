import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import { createApp } from "../web-server.js";
import { MemoryStore, PostgresStore } from "../store.js";
function inbox(ws) {
  const messages = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.p(m));
    if (i >= 0) {
      const w = waiters.splice(i, 1)[0];
      clearTimeout(w.timer);
      w.resolve(m);
    } else messages.push(m);
  });
  return (p) => {
    const i = messages.findIndex(p);
    if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = {
        p,
        resolve,
        timer: setTimeout(() => reject(new Error("message timeout")), 7000),
      };
      waiters.push(w);
    });
  };
}
async function start(store) {
  const app = createApp(store);
  app.server.listen(0);
  await once(app.server, "listening");
  app.url = `http://localhost:${app.server.address().port}`;
  return app;
}
async function client(app) {
  const ws = new WebSocket(app.url.replace("http", "ws") + "/api/ws");
  const next = inbox(ws);
  await once(ws, "open");
  return {
    ws,
    next,
    send: (m) => ws.send(JSON.stringify(m)),
    token: randomBytes(32).toString("hex"),
  };
}
async function scenario(storeA, storeB) {
  const a = await start(storeA),
    b = await start(storeB);
  const clients = [];
  try {
    assert.equal((await fetch(a.url)).status, 200);
    assert.equal((await fetch(a.url + "/secret")).status, 404);
    assert.equal((await fetch(a.url + "/healthz")).status, 200);
    const host = await client(a);
    clients.push(host);
    host.send({ type: "create", token: host.token });
    const { room } = await host.next((m) => m.type === "joined");
    assert.equal((await host.next((m) => m.type === "state")).isHost, true);
    const guest = await client(b);
    clients.push(guest);
    guest.send({ type: "join", room, token: guest.token });
    await guest.next((m) => m.type === "joined");
    assert.equal((await guest.next((m) => m.type === "state")).isHost, false);
    const third = await client(a);
    clients.push(third);
    third.send({ type: "join", room, token: third.token });
    assert.equal((await third.next((m) => m.type === "error")).code, "full");
    guest.send({ type: "source", source: "/demo.wav" });
    assert.equal(
      (await guest.next((m) => m.type === "error")).code,
      "forbidden",
    );
    host.send({ type: "source", source: "/demo.wav" });
    await guest.next((m) => m.type === "state" && m.source === "/demo.wav");
    host.send({ type: "ready", ready: true, sourceRevision: 1 });
    guest.send({ type: "ready", ready: true, sourceRevision: 1 });
    host.send({
      type: "control",
      playing: true,
      position: 4,
      sourceRevision: 1,
    });
    await guest.next((m) => m.type === "state" && m.playing);
    guest.send({ type: "ready", ready: false, sourceRevision: 1 });
    await host.next((m) => m.type === "state" && !m.playing && m.requested);
    guest.send({ type: "ready", ready: true, sourceRevision: 1 });
    await host.next((m) => m.type === "state" && m.playing);
    host.send({
      type: "control",
      playing: false,
      position: 9,
      sourceRevision: 1,
    });
    await guest.next(
      (m) => m.type === "state" && !m.playing && m.position === 9,
    );
    host.ws.close();
    await once(host.ws, "close");
    const resumed = await client(b);
    clients.push(resumed);
    resumed.send({ type: "join", room, token: host.token });
    await resumed.next((m) => m.type === "joined");
    const s = await resumed.next((m) => m.type === "state");
    assert.equal(s.isHost, true);
    assert.equal(s.source, "/demo.wav");
    assert.equal(s.position, 9);
  } finally {
    for (const c of clients) c.ws.terminate();
    await a.close();
    await b.close();
  }
}
test(
  "two clients across separate servers: readiness, permissions, capacity and recovery",
  { timeout: 20000 },
  async () => {
    const shared = new MemoryStore();
    await scenario(shared, shared);
  },
);
test(
  "PostgreSQL multi-instance state and reconnect recovery",
  { skip: !process.env.DATABASE_URL, timeout: 30000 },
  async () => {
    await scenario(
      new PostgresStore(process.env.DATABASE_URL),
      new PostgresStore(process.env.DATABASE_URL),
    );
  },
);
test("rejects foreign browser origins", { timeout: 5000 }, async () => {
  const app = await start(new MemoryStore());
  try {
    const ws = new WebSocket(app.url.replace("http", "ws") + "/api/ws", {
      origin: "https://evil.example",
    });
    ws.on("error", () => {});
    const [request, response] = await once(ws, "unexpected-response");
    assert.equal(response.statusCode, 403);
    request.destroy();
  } finally {
    await app.close();
  }
});
