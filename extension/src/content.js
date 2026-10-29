import { DEFAULT_SETTINGS } from "./defaults.js";
import { caretFrom, editableFrom, focusEditable, snapshotEditable, suggestionsOpen } from "./editors.js";
import { eraseSuffix, typeSnippet, TypingSession } from "./engine.js";
import { matchShortcut } from "./reconcile.js";

let settings = { ...DEFAULT_SETTINGS };
let snippets = [];
let remembered = null;
let session = new TypingSession();
let busy = false;
let cachedSnap = null;
let bridgeBroken = false;
let actSeq = 0;
let runToken = 0;
let chain = Promise.resolve();

const presence = {
  focused: false,
  fieldKind: "",
  host: location.host,
  sessionState: "idle",
  detail: "",
  progressIndex: 0,
  progressTotal: 0,
};

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
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

let bridgeState = "unknown";
let bridgeProbe = null;

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
  return probeBridge().then((ready) => (ready ? pageActRaw(payload, true) : Promise.resolve({ ok: false })));
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
    document.execCommand("insertText", false, "\t");
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
    rng: Math.random,
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
      },
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
      },
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
      host: location.host,
    }).catch(() => {});
  },
  true,
);

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Tab") return;
    maybeExpandFromKey(event, "tab");
  },
  true,
);

document.addEventListener(
  "keyup",
  (event) => {
    if (event.key === "Tab" || event.key === "Enter" || event.key === "Escape" || event.key === "Backspace") return;
    maybeExpandFromKey(event, "immediate");
  },
  true,
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
    /* the worker wakes on the next tick */
  }
}

setInterval(() => void tick(), 400);
void tick();
