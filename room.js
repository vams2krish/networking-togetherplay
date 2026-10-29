import { createHash, randomBytes } from "node:crypto";
import { position, validSource } from "./sync.js";
export const ROOM_TTL = 6 * 60 * 60 * 1000,
  LEASE_MS = 45000;
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const id = () => randomBytes(16).toString("hex");
export class RoomError extends Error {
  constructor(message, code = "invalid") {
    super(message);
    this.code = code;
  }
}
export function freshRoom(host, now = Date.now()) {
  return {
    host,
    hostOnly: true,
    source: "",
    sourceRevision: 0,
    position: 0,
    playing: false,
    requested: false,
    updatedAt: now,
    revision: 0,
    expiresAt: now + ROOM_TTL,
    members: {},
  };
}
export function reconcile(room, now = Date.now()) {
  for (const [key, m] of Object.entries(room.members))
    if (now - m.seen > LEASE_MS) delete room.members[key];
  const members = Object.values(room.members);
  const playing = Boolean(
    room.source &&
    room.requested &&
    members.length &&
    members.every((m) => m.ready),
  );
  if (playing !== room.playing) {
    room.position = position(room, now);
    room.updatedAt = now;
    room.playing = playing;
    room.revision++;
  }
}
export function change(room, actor, connection, msg, now = Date.now()) {
  if (room.expiresAt <= now)
    throw new RoomError(
      "This room has expired. Create a new shared space.",
      "expired",
    );
  reconcile(room, now);
  if (msg.type === "join") {
    if (!room.members[actor] && Object.keys(room.members).length >= 2)
      throw new RoomError("This room already has two people.", "full");
    room.members[actor] = {
      connection,
      seen: now,
      ready: false,
      drift: null,
      rtt: null,
    };
    room.revision++;
  } else {
    const member = room.members[actor];
    if (!member || member.connection !== connection)
      throw new RoomError(
        "Your session moved or expired. Reconnect to continue.",
        "session",
      );
    member.seen = now;
    if (msg.type === "leave") {
      delete room.members[actor];
      room.position = position(room, now);
      room.updatedAt = now;
      room.requested = false;
      room.playing = false;
      room.revision++;
    } else if (msg.type === "ready") {
      if (
        msg.sourceRevision !== room.sourceRevision ||
        typeof msg.ready !== "boolean"
      )
        return;
      if (member.ready !== msg.ready) {
        member.ready = msg.ready;
        room.revision++;
      }
    } else if (msg.type === "telemetry") {
      if (
        Number.isFinite(msg.drift) &&
        Math.abs(msg.drift) <= 604800 &&
        Number.isFinite(msg.rtt) &&
        msg.rtt >= 0 &&
        msg.rtt < 60000
      ) {
        member.drift = Math.round(msg.drift * 1000);
        member.rtt = Math.round(msg.rtt);
      }
    } else if (["source", "control", "settings"].includes(msg.type)) {
      if (
        (msg.type === "settings" && actor !== room.host) ||
        (room.hostOnly && actor !== room.host)
      )
        throw new RoomError(
          "Only the host can change playback in this room.",
          "forbidden",
        );
      if (msg.type === "source") {
        if (!validSource(msg.source))
          throw new RoomError("Use an HTTPS link to a supported media file.");
        room.source = msg.source;
        room.sourceRevision++;
        room.position = 0;
        room.playing = false;
        room.requested = false;
        room.updatedAt = now;
        for (const m of Object.values(room.members)) m.ready = false;
      } else if (msg.type === "settings") {
        if (typeof msg.hostOnly !== "boolean")
          throw new RoomError("Invalid control setting.");
        room.hostOnly = msg.hostOnly;
      } else {
        if (msg.sourceRevision !== room.sourceRevision)
          throw new RoomError("Media changed. Try again.");
        if (
          typeof msg.playing !== "boolean" ||
          !Number.isFinite(msg.position) ||
          msg.position < 0 ||
          msg.position > 604800
        )
          throw new RoomError("Invalid playback command.");
        room.position = msg.position;
        room.updatedAt = now;
        room.requested = msg.playing;
      }
      room.revision++;
    } else if (msg.type !== "refresh") throw new RoomError("Unknown message.");
  }
  reconcile(room, now);
}
export function snapshot(room, actor, now = Date.now()) {
  const members = Object.values(room.members).filter(
    (m) => now - m.seen <= LEASE_MS,
  );
  return {
    type: "state",
    source: room.source,
    sourceRevision: room.sourceRevision,
    position: room.position,
    playing: room.playing,
    requested: room.requested,
    updatedAt: room.updatedAt,
    serverNow: now,
    revision: room.revision,
    expiresAt: room.expiresAt,
    hostOnly: room.hostOnly,
    isHost: actor === room.host,
    members: members.length,
    ready: members.filter((m) => m.ready).length,
    telemetry: members.map((m) => ({ drift: m.drift, rtt: m.rtt })),
  };
}
