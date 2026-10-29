(() => {
  // extension/src/defaults.js
  var DEFAULT_SETTINGS = {
    minCpm: 280,
    maxCpm: 620,
    minMistakePer100: 0,
    maxMistakePer100: 2,
    tabSize: 4,
    expandTrigger: "immediate"
  };

  // extension/src/editors.js
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function snapshotFromValue(value, cursor) {
    const safe = Math.max(0, Math.min(cursor ?? 0, value.length));
    const lineStart = value.lastIndexOf("\n", Math.max(0, safe - 1)) + 1;
    const nextBreak = value.indexOf("\n", safe);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    return { line: value.slice(lineStart, lineEnd), col: safe - lineStart };
  }
  function findMonacoEditor(root) {
    const monaco = globalThis.monaco;
    if (monaco?.editor?.getEditors) {
      const found = monaco.editor.getEditors().find((editor) => editor.getDomNode?.() === root);
      if (found) return found;
    }
    for (const key of Object.getOwnPropertyNames(root)) {
      try {
        const value = root[key];
        if (value && typeof value.getModel === "function" && typeof value.getPosition === "function") {
          return value;
        }
      } catch {
      }
    }
    return null;
  }
  function findAceEditor(root) {
    if (root.env?.editor?.getCursorPosition) return root.env.editor;
    try {
      if (globalThis.ace?.edit) return globalThis.ace.edit(root);
    } catch {
      return null;
    }
    return null;
  }
  function findCm6(root) {
    for (let node = root; node; node = node.parentElement) {
      if (node.cmView?.state) return node.cmView;
    }
    return null;
  }
  function snapshotRendered(root, lineSelector, cursorSelector) {
    const cursor = root.querySelector(cursorSelector);
    const lines = [...root.querySelectorAll(lineSelector)];
    if (!cursor || lines.length === 0) return null;
    const cursorRect = cursor.getBoundingClientRect();
    const lineEl = lines.find((line) => {
      const rect = line.getBoundingClientRect();
      return cursorRect.top >= rect.top - 2 && cursorRect.top < rect.bottom - 2;
    }) || lines[0];
    const text = (lineEl.textContent || "").replace(/\u00a0/g, " ").replace(/\n$/, "");
    const origin = lineEl.getBoundingClientRect().left;
    const style = getComputedStyle(lineEl);
    const canvas = snapshotRendered.canvas || (snapshotRendered.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const width = context.measureText("0").width || 8;
    const col = clamp(Math.round((cursorRect.left - origin) / width), 0, text.length);
    return { line: text, col };
  }
  function snapshotMonacoDom(root) {
    const cursor = root.querySelector(".cursors-layer .cursor");
    const lines = [...root.querySelectorAll(".view-lines > .view-line")];
    if (!cursor || lines.length === 0) return null;
    const cursorRect = cursor.getBoundingClientRect();
    const lineEl = lines.find((line) => {
      const rect = line.getBoundingClientRect();
      return cursorRect.top >= rect.top - 2 && cursorRect.top < rect.bottom - 2;
    }) || lines[0];
    const text = (lineEl.innerText || "").replace(/\u00a0/g, " ").replace(/\n$/, "");
    const span = lineEl.querySelector("span");
    const origin = (span || lineEl).getBoundingClientRect().left;
    const style = getComputedStyle(lineEl);
    const canvas = snapshotMonacoDom.canvas || (snapshotMonacoDom.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const width = context.measureText("0").width || 8;
    const col = clamp(Math.round((cursorRect.left - origin) / width), 0, text.length);
    return { line: text, col };
  }
  function snapshotContentEditable(root) {
    const selection = root.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    if (!root.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0);
    const before = range.cloneRange();
    before.selectNodeContents(root);
    before.setEnd(range.endContainer, range.endOffset);
    const beforeText = before.toString().replace(/\u00a0/g, " ");
    const all = (root.innerText || "").replace(/\u00a0/g, " ");
    const beforeLines = beforeText.split("\n");
    const allLines = all.split("\n");
    const line = allLines[beforeLines.length - 1] ?? "";
    const col = clamp(beforeLines[beforeLines.length - 1]?.length ?? 0, 0, line.length);
    return { line, col };
  }
  function editableFrom(node) {
    const element = node instanceof Element ? node : node?.parentElement;
    if (!(element instanceof Element)) return null;
    if (element instanceof HTMLInputElement && (element.type === "password" || element.disabled || element.readOnly)) {
      return null;
    }
    const monaco = element.closest(".monaco-editor");
    if (monaco) {
      return {
        kind: "monaco",
        root: monaco,
        focusNode: monaco.querySelector("textarea.inputarea") || element,
        editor: findMonacoEditor(monaco)
      };
    }
    const ace = element.closest(".ace_editor");
    if (ace) {
      return {
        kind: "ace",
        root: ace,
        focusNode: ace.querySelector("textarea") || element,
        editor: findAceEditor(ace)
      };
    }
    const cm5 = element.closest(".CodeMirror");
    if (cm5) {
      return {
        kind: "cm5",
        root: cm5,
        focusNode: cm5.querySelector("textarea") || element,
        editor: cm5.CodeMirror || null
      };
    }
    const cm6 = element.closest(".cm-editor");
    if (cm6) {
      return {
        kind: "cm6",
        root: cm6,
        focusNode: cm6.querySelector("textarea") || cm6.querySelector("[contenteditable='true']") || element,
        editor: findCm6(cm6)
      };
    }
    if (element instanceof HTMLTextAreaElement && !element.readOnly && !element.disabled) {
      return { kind: "textarea", root: element, focusNode: element, editor: null };
    }
    if (element instanceof HTMLInputElement && !element.disabled && !element.readOnly) {
      const allowed = /* @__PURE__ */ new Set(["text", "search", "email", "url", "tel", ""]);
      if (!allowed.has(element.type)) return null;
      return { kind: "input", root: element, focusNode: element, editor: null };
    }
    const rich = element.closest("[contenteditable='true'], [contenteditable='']");
    if (rich instanceof HTMLElement) {
      return { kind: "contenteditable", root: rich, focusNode: rich, editor: null };
    }
    return null;
  }
  function focusEditable(target) {
    if (!target) return;
    try {
      target.editor?.focus?.();
      target.focusNode?.focus?.();
    } catch {
    }
  }
  function snapshotEditable(target) {
    if (!target) return null;
    try {
      if (target.kind === "monaco" && target.editor?.getModel && target.editor.getPosition) {
        const model = target.editor.getModel();
        const position = target.editor.getPosition();
        if (model && position) {
          const line = model.getLineContent(position.lineNumber);
          return { line, col: clamp(position.column - 1, 0, line.length) };
        }
      }
      if (target.kind === "ace" && target.editor?.session) {
        const position = target.editor.getCursorPosition();
        const line = target.editor.session.getLine(position.row) ?? "";
        return { line, col: clamp(position.column, 0, line.length) };
      }
      if (target.kind === "cm5" && target.editor?.getCursor) {
        const position = target.editor.getCursor();
        const line = target.editor.getLine(position.line) ?? "";
        return { line, col: clamp(position.ch, 0, line.length) };
      }
      if (target.kind === "cm6" && target.editor?.state) {
        const offset = target.editor.state.selection.main.head;
        const lineInfo = target.editor.state.doc.lineAt(offset);
        return { line: lineInfo.text, col: clamp(offset - lineInfo.from, 0, lineInfo.text.length) };
      }
      if (target.kind === "textarea" || target.kind === "input") {
        return snapshotFromValue(target.focusNode.value ?? "", target.focusNode.selectionStart ?? 0);
      }
      if (target.kind === "contenteditable") return snapshotContentEditable(target.root);
      if (target.kind === "monaco") return snapshotMonacoDom(target.root);
      if (target.kind === "ace") return snapshotRendered(target.root, ".ace_line", ".ace_cursor");
      if (target.kind === "cm5") return snapshotRendered(target.root, ".CodeMirror-line", ".CodeMirror-cursor");
      if (target.kind === "cm6") return snapshotRendered(target.root, ".cm-line", ".cm-cursor");
    } catch {
      return null;
    }
    return null;
  }
  function suggestionsOpen(roots = []) {
    const scopes = [document];
    for (const root of roots) {
      if (root) scopes.push(root);
      if (root?.shadowRoot) scopes.push(root.shadowRoot);
    }
    const selectors = [
      ".suggest-widget.visible",
      ".ace_autocomplete",
      ".CodeMirror-hints",
      ".cm-tooltip-autocomplete"
    ];
    for (const scope of scopes) {
      for (const selector of selectors) {
        const nodes = scope.querySelectorAll?.(selector) || [];
        for (const node of nodes) {
          const view = node.ownerDocument?.defaultView;
          const style = view?.getComputedStyle(node);
          if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            continue;
          }
          if (node.getAttribute("aria-hidden") === "true") continue;
          return true;
        }
      }
      if (scope.querySelector?.(".ghost-text-decoration, .suggest-preview-text")) return true;
    }
    return false;
  }
  function caretFrom(node) {
    const path = node?.composedPath?.() || [];
    for (const entry of path) {
      const target = editableFrom(entry);
      if (target) return target;
    }
    return editableFrom(node?.target || node);
  }

  // extension/src/reconcile.js
  function normalizeNewlines(body) {
    return String(body ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
  function leadingWhitespace(line) {
    let index = 0;
    while (index < line.length && (line[index] === " " || line[index] === "	")) index += 1;
    return line.slice(0, index);
  }
  function whitespaceColumns(text, tabSize) {
    const size = Math.max(1, tabSize || 4);
    let column = 0;
    for (const char of text) {
      if (char === " ") column += 1;
      else if (char === "	") column += size - column % size;
      else break;
    }
    return column;
  }
  function indentToward(beforeCursor, desiredWs, tabSize) {
    if ([...beforeCursor].some((char) => char !== " " && char !== "	")) {
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
  function restoreStep(beforeCursor, goalPrefix, upcoming) {
    if (beforeCursor === goalPrefix) return { op: "done", skip: 0 };
    if (beforeCursor.startsWith(goalPrefix)) {
      const extra = beforeCursor.slice(goalPrefix.length);
      if (upcoming.startsWith(extra)) return { op: "done", skip: extra.length };
      return { op: "backspace" };
    }
    if (goalPrefix.startsWith(beforeCursor)) return { op: "missing" };
    return { op: "backspace" };
  }
  function extraAfterCursor(originalSuffix, line, col) {
    const after = line.slice(col);
    if (!originalSuffix) return after;
    if (after.endsWith(originalSuffix)) return after.slice(0, after.length - originalSuffix.length);
    return "";
  }
  function matchShortcut(textBeforeCursor, shortcuts) {
    let best = null;
    for (const item of shortcuts || []) {
      const shortcut = item?.shortcut || "";
      if (shortcut.length < 2) continue;
      if (!textBeforeCursor.endsWith(shortcut)) continue;
      const boundaryAt = textBeforeCursor.length - shortcut.length - 1;
      const startsWithWord = /^[A-Za-z0-9]/.test(shortcut);
      if (boundaryAt >= 0 && startsWithWord && /[A-Za-z0-9]/.test(textBeforeCursor[boundaryAt])) {
        continue;
      }
      if (!best || shortcut.length > best.shortcut.length) best = item;
    }
    return best;
  }
  var NEIGHBORS = {
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
    9: ["8", "0"]
  };
  function rollMistake(char, rate, rng) {
    if (!(rate > 0)) return null;
    if (!/^[a-z0-9]$/i.test(char)) return null;
    if (rng() >= rate) return null;
    const options = NEIGHBORS[char.toLowerCase()];
    if (!options?.length) return null;
    let wrong = options[Math.floor(rng() * options.length) % options.length];
    if (char !== char.toLowerCase()) wrong = wrong.toUpperCase();
    return wrong;
  }
  function sessionMistakeRate(settings2, rng) {
    const min = Number(settings2.minMistakePer100) / 100;
    const max = Number(settings2.maxMistakePer100) / 100;
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return low + rng() * (high - low);
  }
  function keyDelayMs(char, minCpm, maxCpm, rng) {
    const low = Math.min(minCpm, maxCpm);
    const high = Math.max(minCpm, maxCpm);
    const cpm = low + rng() * (high - low);
    let delay = 6e4 / Math.max(30, cpm);
    if (char === " ") delay *= 1.12;
    else if (char === "\n") delay *= 1.65;
    else if (".,;:!?".includes(char)) delay *= 1.28;
    if (rng() < 0.045) delay += 160 + rng() * 280;
    return Math.max(16, Math.round(delay));
  }

  // extension/src/engine.js
  var TypingSession = class {
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
  };
  async function pauseAwareSleep(io, session2, ms) {
    let left = Math.max(0, ms);
    while (left > 0) {
      await session2.checkpoint();
      const slice = Math.min(40, left);
      await io.sleep(slice);
      left -= slice;
    }
    await session2.checkpoint();
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
  async function fixIndent(io, desiredWs, tabSize, session2) {
    let previous = "";
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await session2.checkpoint();
      const snap = io.snapshot();
      if (!snap) return;
      const lineWs = leadingWhitespace(snap.line);
      const stamp = `${snap.line}\0${snap.col}\0${desiredWs}`;
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
        if (step.text === "	") await io.insertText("	");
        else await io.pressChar(step.text);
      } else {
        await io.press("Backspace");
      }
      await io.settle();
    }
  }
  async function typeOne(io, char, upcoming, session2) {
    const before = io.snapshot();
    if (!before) {
      await io.insertText(char);
      await io.settle();
      return 0;
    }
    if (char === "	") {
      await io.insertText("	");
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
      await session2.checkpoint();
      const snap = io.snapshot();
      if (!snap) return 0;
      const stamp = `${snap.line}\0${snap.col}`;
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
  async function undoUntil(io, prefix, session2) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await session2.checkpoint();
      const snap = io.snapshot();
      if (!snap || snap.line.slice(0, snap.col) === prefix) return;
      await io.press("Backspace");
      await io.settle();
    }
  }
  async function eraseSuffix(io, suffix, session2) {
    const start = io.snapshot();
    if (!start) return false;
    const original = start.line.slice(0, start.col);
    if (!original.endsWith(suffix)) return false;
    const goal = original.slice(0, -suffix.length);
    for (let attempt = 0; attempt < suffix.length + 40; attempt += 1) {
      await session2.checkpoint();
      const snap2 = io.snapshot();
      if (!snap2) return false;
      if (snap2.line.slice(0, snap2.col) === goal) return true;
      await io.press("Backspace");
      await io.settle();
    }
    const snap = io.snapshot();
    return Boolean(snap && snap.line.slice(0, snap.col) === goal);
  }
  async function typeSnippet(body, io, settings2, session2, hooks = {}) {
    if (session2.mode === "idle" || session2.mode === "stopping") session2.start();
    const normalized = normalizeNewlines(body);
    const lines = normalized.split("\n");
    const rng = io.rng || Math.random;
    const rate = sessionMistakeRate(settings2, rng);
    let progress = 0;
    const total = Math.max(normalized.length, 1);
    try {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        await session2.checkpoint();
        const line = lines[lineIndex];
        const indent = leadingWhitespace(line);
        let content = line;
        if (lineIndex > 0) {
          await dismissSuggestions(io);
          await io.press("Enter");
          await io.settle();
          progress += 1;
          hooks.onProgress?.(Math.min(progress, total), total);
          await pauseAwareSleep(io, session2, keyDelayMs("\n", settings2.minCpm, settings2.maxCpm, rng));
          await fixIndent(io, indent, settings2.tabSize, session2);
          content = line.slice(indent.length);
        } else if (indent.length > 0) {
          const snap = io.snapshot();
          if (snap) {
            const before = snap.line.slice(0, snap.col);
            const after = snap.line.slice(snap.col);
            const inWhitespace = /^[ \t]*$/.test(before) && after.trim() === "";
            if (inWhitespace) {
              await fixIndent(io, indent, settings2.tabSize, session2);
              content = line.slice(indent.length);
            }
          }
        }
        for (let index = 0; index < content.length; index += 1) {
          await session2.checkpoint();
          hooks.onChar?.({ index: progress });
          await session2.checkpoint();
          const char = content[index];
          const upcoming = content.slice(index + 1);
          await dismissSuggestions(io);
          const mistake = rollMistake(char, rate, rng);
          if (mistake) {
            const snap = io.snapshot();
            const prefix = snap ? snap.line.slice(0, snap.col) : "";
            await typeOne(io, mistake, "", session2);
            await pauseAwareSleep(io, session2, keyDelayMs(mistake, settings2.minCpm, settings2.maxCpm, rng));
            await undoUntil(io, prefix, session2);
            await pauseAwareSleep(io, session2, Math.max(16, Math.round(keyDelayMs(mistake, settings2.minCpm, settings2.maxCpm, rng) * 0.65)));
          }
          const skip = await typeOne(io, char, upcoming, session2);
          index += skip;
          progress += 1 + skip;
          hooks.onProgress?.(Math.min(progress, total), total);
          await pauseAwareSleep(io, session2, keyDelayMs(char, settings2.minCpm, settings2.maxCpm, rng));
        }
      }
      return { status: "done" };
    } catch (error) {
      if (error && error.code === "STOPPED") return { status: "stopped" };
      throw error;
    }
  }

  // extension/src/content.js
  var settings = { ...DEFAULT_SETTINGS };
  var snippets = [];
  var remembered = null;
  var session = new TypingSession();
  var busy = false;
  var cachedSnap = null;
  var bridgeBroken = false;
  var actSeq = 0;
  var runToken = 0;
  var chain = Promise.resolve();
  var presence = {
    focused: false,
    fieldKind: "",
    host: location.host,
    sessionState: "idle",
    detail: "",
    progressIndex: 0,
    progressTotal: 0
  };
  function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  function report(state, detail = "", index = presence.progressIndex, total = presence.progressTotal) {
    presence.sessionState = state;
    presence.detail = detail;
    presence.progressIndex = index;
    presence.progressTotal = total;
  }
  function liveTarget() {
    if (remembered?.focusNode?.isConnected) {
      return editableFrom(remembered.focusNode) || remembered;
    }
    const active = caretFrom({ target: document.activeElement, composedPath: () => [] });
    return active;
  }
  function deskFieldIgnored(target) {
    const node = target?.focusNode instanceof Element ? target.focusNode : target?.root;
    if (!(node instanceof Element)) return false;
    if (node.closest("[data-desk-pad]")) return false;
    return Boolean(node.closest("[data-desk-app]"));
  }
  function ensureFocus(target) {
    const active = document.activeElement;
    if (target?.root && (target.root === active || target.root.contains(active))) return;
    focusEditable(target);
  }
  var bridgeState = "unknown";
  var bridgeProbe = null;
  function pageActRaw(payload, markMissingOnTimeout = false) {
    const id = ++actSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        if (markMissingOnTimeout) {
          bridgeBroken = true;
          bridgeState = "missing";
        }
        resolve({ ok: false, error: "timeout" });
      }, 200);
      function onMessage(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== "snippet-desk-result" || data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(data);
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ source: "snippet-desk", id, ...payload }, "*");
    });
  }
  function probeBridge() {
    if (bridgeState === "ready") return Promise.resolve(true);
    if (bridgeState === "missing" || bridgeBroken) return Promise.resolve(false);
    if (!bridgeProbe) {
      bridgeProbe = pageActRaw({ op: "ping" }).then((result) => {
        bridgeState = result?.ok ? "ready" : "missing";
        if (!result?.ok) bridgeBroken = true;
        return bridgeState === "ready";
      });
    }
    return bridgeProbe;
  }
  function pageAct(payload) {
    if (bridgeState === "missing" || bridgeBroken) return Promise.resolve({ ok: false });
    return probeBridge().then((ready) => ready ? pageActRaw(payload, true) : Promise.resolve({ ok: false }));
  }
  void probeBridge();
  function fallbackAction(name, text) {
    const active = document.activeElement;
    if (text != null) {
      document.execCommand("insertText", false, text);
      return;
    }
    if (name === "Backspace") {
      document.execCommand("delete");
      return;
    }
    if (name === "Delete") {
      document.execCommand("forwardDelete");
      return;
    }
    if (name === "Enter") {
      if (!document.execCommand("insertLineBreak")) document.execCommand("insertText", false, "\n");
      return;
    }
    if (name === "Tab") {
      document.execCommand("insertText", false, "	");
      return;
    }
    if (name === "ArrowRight" && active && "selectionStart" in active && active.selectionStart != null) {
      const next = Math.min(active.value.length, active.selectionStart + 1);
      active.selectionStart = active.selectionEnd = next;
      return;
    }
    if (name === "ArrowRight") {
      document.getSelection()?.modify?.("move", "forward", "character");
      return;
    }
    if (name === "Escape") {
      active?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    }
  }
  function keepSnap(snap, live) {
    if (snap && live && snap.kind === live.kind) cachedSnap = snap;
  }
  async function drive(op, extra) {
    const live = liveTarget();
    ensureFocus(live);
    const result = await pageAct({ op, ...extra });
    if (result?.ok || result?.error) {
      keepSnap(result.snap, live);
      return;
    }
    if (op === "special") fallbackAction(extra.name, null);
    else fallbackAction(null, extra.text ?? "");
    cachedSnap = null;
  }
  function makeIO(target) {
    return {
      snapshot() {
        const live = liveTarget() || target;
        const local = snapshotEditable(live);
        if (!live || live.kind === "textarea" || live.kind === "input" || live.kind === "contenteditable") return local;
        if (cachedSnap && cachedSnap.kind === live.kind) return { line: cachedSnap.line, col: cachedSnap.col };
        return local;
      },
      suggestionsOpen() {
        const live = liveTarget() || target;
        return suggestionsOpen([live?.root]);
      },
      async press(name) {
        await drive("special", { name });
      },
      async pressChar(char) {
        await drive("char", { text: char });
      },
      async insertText(text) {
        await drive("insert", { text });
      },
      async settle() {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise((resolve) => setTimeout(resolve, 12));
        const live = liveTarget() || target;
        const result = await pageAct({ op: "snapshot" });
        if (result?.ok) keepSnap(result.snap, live);
      },
      sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      },
      rng: Math.random
    };
  }
  async function runBody(body, localSession, token) {
    const target = liveTarget();
    if (!target || deskFieldIgnored(target)) {
      report("error", "Click the field you want to type into, then start again.", 0, 0);
      if (session === localSession) session = new TypingSession();
      void tick(true);
      return;
    }
    remembered = target;
    ensureFocus(target);
    if (token !== runToken) return;
    busy = true;
    report("typing", "", 0, body.length);
    try {
      const io = makeIO(target);
      await io.settle();
      if (token !== runToken) return;
      const result = await typeSnippet(body, io, settings, localSession, {
        onProgress(index, total) {
          if (token !== runToken) return;
          report(localSession.mode === "paused" ? "paused" : "typing", presence.detail, index, total);
        }
      });
      if (token === runToken) {
        report("idle", result.status === "done" ? "Finished" : "Stopped", presence.progressIndex, presence.progressTotal);
      }
    } catch (error) {
      if (token === runToken) report("error", error?.message || "Typing failed.");
    } finally {
      if (token === runToken) {
        busy = false;
        session = new TypingSession();
        void tick(true);
      }
    }
  }
  function startTyping(body) {
    const token = ++runToken;
    session.stop();
    const localSession = new TypingSession();
    session = localSession;
    localSession.start();
    return enqueue(() => runBody(body, localSession, token));
  }
  async function expand(match) {
    if (busy || session.mode === "typing" || session.mode === "paused") return;
    const token = ++runToken;
    const localSession = new TypingSession();
    session = localSession;
    localSession.start();
    busy = true;
    const target = liveTarget();
    if (!target || deskFieldIgnored(target)) {
      busy = false;
      session = new TypingSession();
      report("error", "Click the field you want to type into, then start again.", 0, 0);
      void tick(true);
      return;
    }
    remembered = target;
    try {
      if (token !== runToken) return;
      ensureFocus(target);
      const io = makeIO(target);
      await io.settle();
      if (token !== runToken) return;
      report("typing", "Replacing shortcut", 0, match.body.length);
      const erased = await eraseSuffix(io, match.shortcut, localSession);
      if (!erased) {
        report("error", "Could not remove the shortcut from the field.");
        return;
      }
      const result = await typeSnippet(match.body, io, settings, localSession, {
        onProgress(index, total) {
          report(localSession.mode === "paused" ? "paused" : "typing", "", index, total);
        }
      });
      report("idle", result.status === "done" ? "Finished" : "Stopped");
    } catch (error) {
      if (token === runToken && error?.code !== "STOPPED") {
        report("error", error?.message || "Could not expand the shortcut.");
      }
    } finally {
      if (token === runToken) {
        busy = false;
        session = new TypingSession();
        void tick(true);
      }
    }
  }
  function applyCommand(command) {
    if (!command) return;
    if (command.action === "pause") {
      session.pause();
      if (session.mode === "paused") report("paused", "Paused");
      void tick(true);
      return;
    }
    if (command.action === "resume") {
      session.resume();
      if (session.mode === "typing") report("typing", "");
      void tick(true);
      return;
    }
    if (command.action === "stop") {
      session.stop();
      report("idle", "Stopped");
      void tick(true);
      return;
    }
    if (command.action === "start" && typeof command.body === "string") {
      report("typing", "Starting", 0, command.body.length);
      void startTyping(command.body);
    }
  }
  function maybeExpandFromKey(event, trigger) {
    if (busy || session.mode === "typing" || session.mode === "paused") return;
    if (settings.expandTrigger !== trigger) return;
    if (trigger === "immediate" && event.key.length !== 1) return;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = caretFrom(event);
    if (!target || deskFieldIgnored(target)) return;
    remembered = target;
    const snap = snapshotEditable(target);
    if (!snap) return;
    const match = matchShortcut(snap.line.slice(0, snap.col), snippets);
    if (!match) return;
    if (trigger === "tab") {
      event.preventDefault();
      event.stopPropagation();
    }
    void enqueue(() => expand(match));
  }
  document.addEventListener(
    "focusin",
    (event) => {
      const target = caretFrom(event);
      if (!target || deskFieldIgnored(target)) return;
      remembered = target;
      presence.focused = true;
      presence.fieldKind = target.kind;
      chrome.runtime.sendMessage({
        type: "focus",
        fieldKind: target.kind,
        host: location.host
      }).catch(() => {
      });
    },
    true
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Tab") return;
      maybeExpandFromKey(event, "tab");
    },
    true
  );
  document.addEventListener(
    "keyup",
    (event) => {
      if (event.key === "Tab" || event.key === "Enter" || event.key === "Escape" || event.key === "Backspace") return;
      maybeExpandFromKey(event, "immediate");
    },
    true
  );
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "session-state") {
      sendResponse({ mode: session.mode });
      return;
    }
    if (message?.type === "command") applyCommand(message.command);
  });
  async function tick(force = false) {
    if (!force && !document.hasFocus() && session.mode === "idle" && !busy) return;
    presence.focused = Boolean(liveTarget()) && document.hasFocus();
    presence.host = location.host;
    try {
      const response = await chrome.runtime.sendMessage({ type: "tick", presence: { ...presence } });
      if (!response?.ok) return;
      if (response.settings) settings = { ...DEFAULT_SETTINGS, ...response.settings };
      if (Array.isArray(response.snippets)) snippets = response.snippets;
      if (response.command) applyCommand(response.command);
    } catch {
    }
  }
  setInterval(() => void tick(), 400);
  void tick();
})();
