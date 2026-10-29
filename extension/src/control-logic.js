export function normalizeFrame(frame) {
  if (!frame || (frame.tabId !== 0 && !frame.tabId)) return null;
  return { tabId: frame.tabId, frameId: Number(frame.frameId) || 0 };
}

export function sameFrame(left, right) {
  const a = normalizeFrame(left);
  const b = normalizeFrame(right);
  return Boolean(a && b && a.tabId === b.tabId && a.frameId === b.frameId);
}

export function commandTarget(action, lastFocus, activeFrame) {
  if (action === "start") return normalizeFrame(lastFocus) || normalizeFrame(activeFrame);
  return normalizeFrame(activeFrame) || normalizeFrame(lastFocus);
}

export function shouldReplaceLive(fromActive, activeFrame, presenceState) {
  if (fromActive) return true;
  return !activeFrame && presenceState !== "idle";
}

export function toggleAction(mode) {
  if (mode === "typing") return "pause";
  if (mode === "paused") return "resume";
  return "start";
}
