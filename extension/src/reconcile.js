export const PAIRS = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
};

export function normalizeNewlines(body) {
  return String(body ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function leadingWhitespace(line) {
  let index = 0;
  while (index < line.length && (line[index] === " " || line[index] === "\t")) index += 1;
  return line.slice(0, index);
}

export function whitespaceColumns(text, tabSize) {
  const size = Math.max(1, tabSize || 4);
  let column = 0;
  for (const char of text) {
    if (char === " ") column += 1;
    else if (char === "\t") column += size - (column % size);
    else break;
  }
  return column;
}

export function indentToward(beforeCursor, desiredWs, tabSize) {
  if ([...beforeCursor].some((char) => char !== " " && char !== "\t")) {
    return { op: "blocked" };
  }
  if (beforeCursor === desiredWs) return { op: "done" };
  const actualCol = whitespaceColumns(beforeCursor, tabSize);
  const desiredCol = whitespaceColumns(desiredWs, tabSize);
  if (actualCol === desiredCol) return { op: "done" };
  if (actualCol < desiredCol) {
    if (desiredWs.startsWith(beforeCursor)) {
      return { op: "insert", text: desiredWs[beforeCursor.length] };
    }
    return { op: "insert", text: " " };
  }
  return { op: "backspace" };
}

export function restoreStep(beforeCursor, goalPrefix, upcoming) {
  if (beforeCursor === goalPrefix) return { op: "done", skip: 0 };
  if (beforeCursor.startsWith(goalPrefix)) {
    const extra = beforeCursor.slice(goalPrefix.length);
    if (upcoming.startsWith(extra)) return { op: "done", skip: extra.length };
    return { op: "backspace" };
  }
  if (goalPrefix.startsWith(beforeCursor)) return { op: "missing" };
  return { op: "backspace" };
}

export function extraAfterCursor(originalSuffix, line, col) {
  const after = line.slice(col);
  if (!originalSuffix) return after;
  if (after.endsWith(originalSuffix)) return after.slice(0, after.length - originalSuffix.length);
  return "";
}

export function matchShortcut(textBeforeCursor, shortcuts) {
  let best = null;
  for (const item of shortcuts || []) {
    const shortcut = item?.shortcut || "";
    if (shortcut.length < 2) continue;
    if (!textBeforeCursor.endsWith(shortcut)) continue;
    const boundaryAt = textBeforeCursor.length - shortcut.length - 1;
    const startsWithWord = /^[A-Za-z0-9]/.test(shortcut);
    if (
      boundaryAt >= 0 &&
      startsWithWord &&
      /[A-Za-z0-9]/.test(textBeforeCursor[boundaryAt])
    ) {
      continue;
    }
    if (!best || shortcut.length > best.shortcut.length) best = item;
  }
  return best;
}

const NEIGHBORS = {
  a: ["s", "q", "w", "z"],
  b: ["v", "n", "g", "h"],
  c: ["x", "v", "d", "f"],
  d: ["s", "f", "e", "c"],
  e: ["w", "r", "d", "s"],
  f: ["d", "g", "r", "v"],
  g: ["f", "h", "t", "b"],
  h: ["g", "j", "y", "n"],
  i: ["u", "o", "k", "j"],
  j: ["h", "k", "u", "m"],
  k: ["j", "l", "i", "m"],
  l: ["k", "o", "p"],
  m: ["n", "j", "k"],
  n: ["b", "m", "h", "j"],
  o: ["i", "p", "l", "k"],
  p: ["o", "l"],
  q: ["w", "a"],
  r: ["e", "t", "f", "d"],
  s: ["a", "d", "w", "z"],
  t: ["r", "y", "g", "f"],
  u: ["y", "i", "j", "h"],
  v: ["c", "b", "f", "g"],
  w: ["q", "e", "s", "a"],
  x: ["z", "c", "s", "d"],
  y: ["t", "u", "h", "g"],
  z: ["a", "x", "s"],
  0: ["9", "1"],
  1: ["2", "q"],
  2: ["1", "3"],
  3: ["2", "4"],
  4: ["3", "5"],
  5: ["4", "6"],
  6: ["5", "7"],
  7: ["6", "8"],
  8: ["7", "9"],
  9: ["8", "0"],
};

export function rollMistake(char, rate, rng) {
  if (!(rate > 0)) return null;
  if (!/^[a-z0-9]$/i.test(char)) return null;
  if (rng() >= rate) return null;
  const options = NEIGHBORS[char.toLowerCase()];
  if (!options?.length) return null;
  let wrong = options[Math.floor(rng() * options.length) % options.length];
  if (char !== char.toLowerCase()) wrong = wrong.toUpperCase();
  return wrong;
}

export function sessionMistakeRate(settings, rng) {
  const min = Number(settings.minMistakePer100) / 100;
  const max = Number(settings.maxMistakePer100) / 100;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + rng() * (high - low);
}

export function keyDelayMs(char, minCpm, maxCpm, rng) {
  const low = Math.min(minCpm, maxCpm);
  const high = Math.max(minCpm, maxCpm);
  const cpm = low + rng() * (high - low);
  let delay = 60000 / Math.max(30, cpm);
  if (char === " ") delay *= 1.12;
  else if (char === "\n") delay *= 1.65;
  else if (".,;:!?".includes(char)) delay *= 1.28;
  if (rng() < 0.045) delay += 160 + rng() * 280;
  return Math.max(16, Math.round(delay));
}
