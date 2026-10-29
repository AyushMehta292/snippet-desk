import {
  extraAfterCursor,
  indentToward,
  keyDelayMs,
  leadingWhitespace,
  normalizeNewlines,
  restoreStep,
  rollMistake,
  sessionMistakeRate,
} from "./reconcile.js";

export class TypingSession {
  constructor() {
    this.mode = "idle";
    this._waiters = [];
  }

  start() {
    this.mode = "typing";
  }

  pause() {
    if (this.mode === "typing") this.mode = "paused";
  }

  resume() {
    if (this.mode !== "paused") return;
    this.mode = "typing";
    const waiters = this._waiters;
    this._waiters = [];
    for (const resolve of waiters) resolve();
  }

  stop() {
    const wasPaused = this.mode === "paused";
    this.mode = "stopping";
    const waiters = this._waiters;
    this._waiters = [];
    for (const resolve of waiters) resolve();
    return wasPaused;
  }

  async checkpoint() {
    if (this.mode === "stopping") throw stopped();
    if (this.mode === "paused") {
      await new Promise((resolve) => this._waiters.push(resolve));
    }
    if (this.mode === "stopping") throw stopped();
  }
}

function stopped() {
  const error = new Error("stopped");
  error.code = "STOPPED";
  return error;
}

async function dismissSuggestions(io) {
  if (!io.suggestionsOpen()) return;
  await io.press("Escape");
  await io.settle();
  if (io.suggestionsOpen()) {
    await io.press("Escape");
    await io.settle();
  }
}

async function fixIndent(io, desiredWs, tabSize, session) {
  let previous = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await session.checkpoint();
    const snap = io.snapshot();
    if (!snap) return;
    const lineWs = leadingWhitespace(snap.line);
    const stamp = `${snap.line}\u0000${snap.col}\u0000${desiredWs}`;
    if (stamp === previous) return;
    previous = stamp;
    if (snap.col < lineWs.length) {
      await io.press("ArrowRight");
      await io.settle();
      continue;
    }
    const before = snap.line.slice(0, snap.col);
    const step = indentToward(before, desiredWs, tabSize);
    if (step.op === "done" || step.op === "blocked") return;
    await dismissSuggestions(io);
    if (step.op === "insert") {
      if (step.text === "\t") await io.insertText("\t");
      else await io.pressChar(step.text);
    } else {
      await io.press("Backspace");
    }
    await io.settle();
  }
}

async function typeOne(io, char, upcoming, session) {
  const before = io.snapshot();
  if (!before) {
    await io.insertText(char);
    await io.settle();
    return 0;
  }
  if (char === "\t") {
    await io.insertText("\t");
    await io.settle();
    return 0;
  }

  const goalPrefix = before.line.slice(0, before.col) + char;
  const originalSuffix = before.line.slice(before.col);
  await io.pressChar(char);
  await io.settle();
  if (io.suggestionsOpen()) {
    await io.press("Escape");
    await io.settle();
  }

  let previous = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await session.checkpoint();
    const snap = io.snapshot();
    if (!snap) return 0;
    const stamp = `${snap.line}\u0000${snap.col}`;
    const now = snap.line.slice(0, snap.col);
    const step = restoreStep(now, goalPrefix, upcoming);
    if (step.op === "done") {
      let skip = step.skip;
      const extra = extraAfterCursor(originalSuffix, snap.line, snap.col);
      if (extra) {
        const rest = upcoming.slice(skip);
        if (rest.startsWith(extra)) {
          for (let index = 0; index < extra.length; index += 1) {
            await io.press("ArrowRight");
            await io.settle();
          }
          skip += extra.length;
        } else {
          for (let index = 0; index < extra.length; index += 1) {
            await io.press("Delete");
            await io.settle();
          }
        }
      }
      return skip;
    }
    if (stamp === previous) break;
    previous = stamp;
    if (step.op === "missing") {
      await io.insertText(char);
      await io.settle();
      continue;
    }
    await io.press("Backspace");
    await io.settle();
  }
  return 0;
}

async function undoUntil(io, prefix, session) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await session.checkpoint();
    const snap = io.snapshot();
    if (!snap || snap.line.slice(0, snap.col) === prefix) return;
    await io.press("Backspace");
    await io.settle();
  }
}

export async function eraseSuffix(io, suffix, session) {
  const start = io.snapshot();
  if (!start) return false;
  const original = start.line.slice(0, start.col);
  if (!original.endsWith(suffix)) return false;
  const goal = original.slice(0, -suffix.length);
  for (let attempt = 0; attempt < suffix.length + 40; attempt += 1) {
    await session.checkpoint();
    const snap = io.snapshot();
    if (!snap) return false;
    if (snap.line.slice(0, snap.col) === goal) return true;
    await io.press("Backspace");
    await io.settle();
  }
  const snap = io.snapshot();
  return Boolean(snap && snap.line.slice(0, snap.col) === goal);
}

export async function typeSnippet(body, io, settings, session, hooks = {}) {
  if (session.mode === "idle" || session.mode === "stopping") session.start();
  const normalized = normalizeNewlines(body);
  const lines = normalized.split("\n");
  const rng = io.rng || Math.random;
  const rate = sessionMistakeRate(settings, rng);
  let progress = 0;
  const total = Math.max(normalized.length, 1);

  try {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      await session.checkpoint();
      const line = lines[lineIndex];
      const indent = leadingWhitespace(line);
      let content = line;

      if (lineIndex > 0) {
        await dismissSuggestions(io);
        await io.press("Enter");
        await io.settle();
        progress += 1;
        hooks.onProgress?.(Math.min(progress, total), total);
        await io.sleep(keyDelayMs("\n", settings.minCpm, settings.maxCpm, rng));
        await fixIndent(io, indent, settings.tabSize, session);
        content = line.slice(indent.length);
      } else if (indent.length > 0) {
        const snap = io.snapshot();
        if (snap) {
          const before = snap.line.slice(0, snap.col);
          const after = snap.line.slice(snap.col);
          const inWhitespace = /^[ \t]*$/.test(before) && after.trim() === "";
          if (inWhitespace) {
            await fixIndent(io, indent, settings.tabSize, session);
            content = line.slice(indent.length);
          }
        }
      }

      for (let index = 0; index < content.length; index += 1) {
        await session.checkpoint();
        hooks.onChar?.({ index: progress });
        await session.checkpoint();
        const char = content[index];
        const upcoming = content.slice(index + 1);
        await dismissSuggestions(io);

        const mistake = rollMistake(char, rate, rng);
        if (mistake) {
          const snap = io.snapshot();
          const prefix = snap ? snap.line.slice(0, snap.col) : "";
          await typeOne(io, mistake, "", session);
          await io.sleep(keyDelayMs(mistake, settings.minCpm, settings.maxCpm, rng));
          await undoUntil(io, prefix, session);
          await io.sleep(Math.max(16, Math.round(keyDelayMs(mistake, settings.minCpm, settings.maxCpm, rng) * 0.65)));
        }

        const skip = await typeOne(io, char, upcoming, session);
        index += skip;
        progress += 1 + skip;
        hooks.onProgress?.(Math.min(progress, total), total);
        await io.sleep(keyDelayMs(char, settings.minCpm, settings.maxCpm, rng));
      }
    }
    return { status: "done" };
  } catch (error) {
    if (error && error.code === "STOPPED") return { status: "stopped" };
    throw error;
  }
}
