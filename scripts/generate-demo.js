import { writeFileSync } from "node:fs";
// Original synthesized melody. No third-party samples or recordings.
const rate = 22050,
  seconds = 35,
  b = Buffer.alloc(44 + rate * seconds * 2);
b.write("RIFF");
b.writeUInt32LE(b.length - 8, 4);
b.write("WAVEfmt ", 8);
b.writeUInt32LE(16, 16);
b.writeUInt16LE(1, 20);
b.writeUInt16LE(1, 22);
b.writeUInt32LE(rate, 24);
b.writeUInt32LE(rate * 2, 28);
b.writeUInt16LE(2, 32);
b.writeUInt16LE(16, 34);
b.write("data", 36);
b.writeUInt32LE(b.length - 44, 40);
const notes = [261.63, 329.63, 392, 440, 349.23, 329.63, 293.66, 261.63];
for (let i = 0; i < rate * seconds; i++) {
  const t = i / rate,
    n = notes[Math.floor(t / 2) % notes.length],
    envelope = Math.min(1, t / 1.5, (seconds - t) / 2),
    beat = Math.exp(-((t % 2) * 1.8));
  const value =
    (Math.sin(2 * Math.PI * n * t) * 0.13 +
      Math.sin(((2 * Math.PI * n) / 2) * t) * 0.13 +
      Math.sin(2 * Math.PI * n * 1.5 * t) * 0.05) *
    envelope *
    (0.35 + 0.65 * beat);
  b.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}
writeFileSync(new URL("../public/demo.wav", import.meta.url), b);
