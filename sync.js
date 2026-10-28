export function position(state, now = Date.now()) {
  return state.position + (state.playing ? Math.max(0, now - state.updatedAt) / 1000 : 0);
}
export function validSource(value) {
  try { return typeof value === 'string' && value.length <= 2048 && ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
