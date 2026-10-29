import test from "node:test";
import assert from "node:assert/strict";
import { freshRoom, change, snapshot, reconcile, hash } from "../room.js";
const host = hash("host"),
  guest = hash("guest");
function setup() {
  const r = freshRoom(host, 1000);
  change(r, host, "a", { type: "join" }, 1000);
  change(r, guest, "b", { type: "join" }, 1000);
  change(r, host, "a", { type: "source", source: "/demo.wav" }, 1000);
  return r;
}
test("play waits for both people; buffering pauses and readiness resumes", () => {
  const r = setup();
  change(
    r,
    host,
    "a",
    { type: "control", playing: true, position: 0, sourceRevision: 1 },
    1000,
  );
  assert.equal(r.playing, false);
  change(r, host, "a", { type: "ready", ready: true, sourceRevision: 1 }, 1100);
  assert.equal(r.playing, false);
  change(
    r,
    guest,
    "b",
    { type: "ready", ready: true, sourceRevision: 1 },
    1200,
  );
  assert.equal(r.playing, true);
  change(
    r,
    guest,
    "b",
    { type: "ready", ready: false, sourceRevision: 1 },
    3200,
  );
  assert.equal(r.playing, false);
  assert.equal(r.position, 2);
  change(
    r,
    guest,
    "b",
    { type: "ready", ready: true, sourceRevision: 1 },
    5000,
  );
  assert.equal(r.playing, true);
  assert.equal(r.position, 2);
});
test("host permissions cannot be bypassed by a guest", () => {
  const r = setup();
  assert.throws(
    () => change(r, guest, "b", { type: "settings", hostOnly: false }, 1000),
    /Only the host/,
  );
  assert.throws(
    () => change(r, guest, "b", { type: "source", source: "/demo.wav" }, 1000),
    /Only the host/,
  );
  change(r, host, "a", { type: "settings", hostOnly: false }, 1000);
  change(
    r,
    guest,
    "b",
    { type: "control", position: 4, playing: false, sourceRevision: 1 },
    1000,
  );
  assert.equal(r.position, 4);
});
test("stale readiness and playback commands cannot affect new media", () => {
  const r = setup();
  change(
    r,
    host,
    "a",
    { type: "source", source: "https://example.com/movie.mp4" },
    1000,
  );
  change(
    r,
    guest,
    "b",
    { type: "ready", ready: true, sourceRevision: 1 },
    1000,
  );
  assert.equal(r.members[guest].ready, false);
  assert.throws(
    () =>
      change(
        r,
        host,
        "a",
        { type: "control", position: 2, playing: true, sourceRevision: 1 },
        1000,
      ),
    /Media changed/,
  );
});
test("room capacity, session ownership and expiry are enforced", () => {
  const r = setup();
  assert.throws(
    () => change(r, hash("third"), "c", { type: "join" }, 1000),
    /two people/,
  );
  change(r, host, "new", { type: "join" }, 1000);
  assert.throws(
    () => change(r, host, "a", { type: "leave" }, 1000),
    /session moved/,
  );
  assert.throws(
    () => change(r, host, "new", { type: "refresh" }, r.expiresAt),
    /expired/,
  );
  reconcile(r, 50000);
  assert.equal(Object.keys(r.members).length, 0);
});
test("public snapshots never expose capability hashes or connection IDs", () => {
  const r = setup(),
    s = snapshot(r, guest, 1000);
  assert.equal(s.isHost, false);
  assert.equal(s.members, 2);
  assert.equal(JSON.stringify(s).includes(host), false);
  assert.equal("host" in s, false);
});
