export function position(state, now = Date.now()) {
  return (
    state.position +
    (state.playing ? Math.max(0, now - state.updatedAt) / 1000 : 0)
  );
}
export function validSource(value) {
  if (value === "/demo.wav") return true;
  try {
    const url = new URL(value);
    return (
      typeof value === "string" &&
      value.length <= 2048 &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
