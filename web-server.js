import http from "node:http";
import { readFile } from "node:fs/promises";
import { WebSocketServer, WebSocket } from "ws";
import { makeStore } from "./store.js";
import { change, hash, id, snapshot, RoomError, reconcile } from "./room.js";

export function createApp(store = makeStore()) {
  const files = {
    "/": ["index.html", "text/html"],
    "/index.html": ["index.html", "text/html"],
    "/app.js": ["app.js", "text/javascript"],
    "/style.css": ["style.css", "text/css"],
    "/demo.wav": ["demo.wav", "audio/wav"],
  };
  const server = http.createServer(async (req, res) => {
    const headers = {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    };
    const path = new URL(req.url, "http://localhost").pathname;
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, headers);
      return res.end();
    }
    if (path === "/healthz") {
      try {
        await store.health();
        res.writeHead(200, {
          ...headers,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ status: "ok", storage: store.mode }));
      } catch {
        res.writeHead(503, headers);
        res.end("Storage unavailable");
      }
      return;
    }
    const file = files[path];
    if (!file) {
      res.writeHead(404, headers);
      return res.end("Not found");
    }
    try {
      const data = await readFile(
        new URL(`public/${file[0]}`, import.meta.url),
      );
      const meta = {
        ...headers,
        "Content-Type": file[1],
        "Content-Length": data.length,
        "Cache-Control":
          file[0] === "demo.wav" ? "public, max-age=86400" : "no-cache",
        "Accept-Ranges": "bytes",
      };
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        let start = match?.[1] ? Number(match[1]) : 0,
          end = match?.[2] ? Number(match[2]) : data.length - 1;
        if (match && !match[1] && match[2]) {
          start = Math.max(0, data.length - Number(match[2]));
          end = data.length - 1;
        }
        if (!match || start >= data.length || end < start) {
          res.writeHead(416, {
            ...meta,
            "Content-Range": `bytes */${data.length}`,
            "Content-Length": 0,
          });
          return res.end();
        }
        end = Math.min(end, data.length - 1);
        res.writeHead(206, {
          ...meta,
          "Content-Range": `bytes ${start}-${end}/${data.length}`,
          "Content-Length": end - start + 1,
        });
        return res.end(
          req.method === "HEAD" ? undefined : data.subarray(start, end + 1),
        );
      }
      res.writeHead(200, meta);
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(500, headers);
      res.end("Unable to load application");
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  const connections = new Map();
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url, "http://localhost").pathname,
      origin = req.headers.origin,
      expected = process.env.APP_ORIGIN;
    const originHost = origin
      ? (() => {
          try {
            return new URL(origin).host;
          } catch {
            return "";
          }
        })()
      : null;
    if (
      !["/ws", "/api/ws"].includes(path) ||
      (origin &&
        (expected ? origin !== expected : originHost !== req.headers.host)) ||
      wss.clients.size >= 200
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const address = process.env.VERCEL
      ? String(req.headers["x-forwarded-for"] || "unknown")
          .split(",")[0]
          .trim()
      : req.socket.remoteAddress || "unknown";
    if ((connections.get(address) || 0) >= 12) {
      socket.write(
        "HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n",
      );
      socket.destroy();
      return;
    }
    connections.set(address, (connections.get(address) || 0) + 1);
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.address = address;
      wss.emit("connection", ws);
    });
  });
  function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 65536) return ws.close(1013, "Slow connection");
      ws.send(JSON.stringify(data));
    }
  }
  function publish(key, room) {
    for (const ws of wss.clients)
      if (ws.room === key) send(ws, snapshot(room, ws.actor));
  }
  async function processMessage(ws, msg) {
    if (msg.type === "ping") {
      if (Number.isFinite(msg.sent))
        send(ws, { type: "pong", sent: msg.sent, server: Date.now() });
      return;
    }
    if (!ws.room) {
      if (
        !["create", "join"].includes(msg.type) ||
        typeof msg.token !== "string" ||
        !/^[a-f0-9]{64}$/.test(msg.token)
      )
        throw new RoomError("Invalid session.");
      const key = msg.type === "create" ? id() : msg.room;
      if (typeof key !== "string" || !/^[a-f0-9]{32}$/.test(key))
        throw new RoomError("Invalid invitation.");
      const actor = hash(msg.token);
      if (msg.type === "create")
        await store.create(
          key,
          actor,
          hash(`${process.env.RATE_LIMIT_SALT || "local"}:${ws.address}`),
        );
      const room = await store.update(key, (r) =>
        change(r, actor, ws.connection, { type: "join" }),
      );
      ws.room = key;
      ws.actor = actor;
      send(ws, { type: "joined", room: key });
      publish(key, room);
      return;
    }
    const room = await store.update(ws.room, (r) =>
      change(r, ws.actor, ws.connection, msg),
    );
    publish(ws.room, room);
  }
  wss.on("connection", (ws) => {
    ws.connection = id();
    ws.alive = true;
    ws.window = Date.now();
    ws.count = 0;
    ws.pending = 0;
    ws.queue = Promise.resolve();
    const joinTimeout = setTimeout(() => {
      if (!ws.room) ws.close(1008, "Join timeout");
    }, 10000);
    joinTimeout.unref();
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("message", (raw) => {
      if (Date.now() - ws.window > 1000) {
        ws.window = Date.now();
        ws.count = 0;
      }
      if (++ws.count > 20 || ws.pending >= 20)
        return ws.close(1008, "Rate limit");
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return send(ws, {
          type: "error",
          message: "Invalid JSON",
          code: "invalid",
        });
      }
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
      ws.pending++;
      ws.queue = ws.queue
        .then(() => processMessage(ws, msg))
        .catch((error) => {
          send(ws, {
            type: "error",
            message:
              error instanceof RoomError
                ? error.message
                : "Service temporarily unavailable. Please reconnect.",
            code: error instanceof RoomError ? error.code : "unavailable",
          });
          if (!(error instanceof RoomError))
            console.error(
              JSON.stringify({
                event: "operation_failed",
                code: error.code || "unknown",
              }),
            );
        })
        .finally(() => ws.pending--);
    });
    ws.on("close", () => {
      clearTimeout(joinTimeout);
      connections.set(
        ws.address,
        Math.max(0, (connections.get(ws.address) || 1) - 1),
      );
      if (!connections.get(ws.address)) connections.delete(ws.address);
      ws.queue.then(async () => {
        if (!ws.room) return;
        try {
          const r = await store.update(ws.room, (r) =>
            change(r, ws.actor, ws.connection, { type: "leave" }),
          );
          publish(ws.room, r);
        } catch {}
      });
    });
    ws.on("error", () => {});
  });
  let polling = false;
  const poll = setInterval(async () => {
    if (polling || !wss.clients.size) return;
    polling = true;
    try {
      for (const key of new Set(
        [...wss.clients].map((ws) => ws.room).filter(Boolean),
      )) {
        try {
          const room = await store.update(key, (r) => {
            if (r.expiresAt <= Date.now())
              throw new RoomError(
                "Room expired. Create a new shared space.",
                "expired",
              );
            for (const ws of wss.clients)
              if (
                ws.room === key &&
                r.members[ws.actor]?.connection === ws.connection &&
                ws.alive
              )
                r.members[ws.actor].seen = Date.now();
            reconcile(r);
          });
          publish(key, room);
        } catch (error) {
          for (const ws of wss.clients)
            if (ws.room === key) {
              send(ws, {
                type: "error",
                code: error instanceof RoomError ? error.code : "unavailable",
                message:
                  error instanceof RoomError
                    ? error.message
                    : "Storage unavailable; playback paused.",
              });
              ws.close(1012, "State unavailable");
            }
        }
      }
    } finally {
      polling = false;
    }
  }, 1000);
  poll.unref();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 15000);
  heartbeat.unref();
  async function close() {
    clearInterval(poll);
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
  return { server, wss, store, close };
}
