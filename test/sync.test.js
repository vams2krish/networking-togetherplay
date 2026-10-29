import test from "node:test";
import assert from "node:assert/strict";
import { position, validSource } from "../sync.js";
test("advances a playing snapshot using server elapsed time", () =>
  assert.equal(
    position({ position: 10, playing: true, updatedAt: 1000 }, 3500),
    12.5,
  ));
test("paused snapshot stays still and negative elapsed time is clamped", () => {
  assert.equal(
    position({ position: 10, playing: false, updatedAt: 1000 }, 3500),
    10,
  );
  assert.equal(
    position({ position: 10, playing: true, updatedAt: 1000 }, 500),
    10,
  );
});
test("accepts HTTPS and the built-in demo; rejects unsafe media URLs", () => {
  assert.equal(validSource("https://example.com/song.mp3"), true);
  assert.equal(validSource("/demo.wav"), true);
  for (const value of [
    "javascript:alert(1)",
    "file:///secret",
    "http://example.com/song.mp3",
    "https://user:password@example.com/song.mp3",
    "/other-file",
    "broken",
    null,
  ])
    assert.equal(validSource(value), false);
});
