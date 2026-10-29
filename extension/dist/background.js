// extension/src/control-logic.js
function normalizeFrame(frame) {
  if (!frame || frame.tabId !== 0 && !frame.tabId) return null;
  return { tabId: frame.tabId, frameId: Number(frame.frameId) || 0 };
}
function sameFrame(left, right) {
  const a = normalizeFrame(left);
  const b = normalizeFrame(right);
  return Boolean(a && b && a.tabId === b.tabId && a.frameId === b.frameId);
}
function commandTarget(action, lastFocus2, activeFrame2) {
  if (action === "start") return normalizeFrame(lastFocus2) || normalizeFrame(activeFrame2);
  return normalizeFrame(activeFrame2) || normalizeFrame(lastFocus2);
}
function shouldReplaceLive(fromActive, activeFrame2, presenceState) {
  if (fromActive) return true;
  return !activeFrame2 && presenceState !== "idle";
}
function toggleAction(mode) {
  if (mode === "typing") return "pause";
  if (mode === "paused") return "resume";
  return "start";
}

// extension/src/defaults.js
var DEFAULT_SETTINGS = {
  minCpm: 280,
  maxCpm: 620,
  minMistakePer100: 0,
  maxMistakePer100: 2,
  tabSize: 4,
  expandTrigger: "immediate"
};

// extension/src/background.js
var DEFAULT_BASE = "http://localhost:3000";
var token = null;
var baseUrl = DEFAULT_BASE;
var email = "";
var lastSeq = 0;
var lastFocus = null;
var activeFrame = null;
var lastBody = "";
var snippets = [];
var notice = "";
var live = {
  sessionState: "idle",
  detail: "",
  progressIndex: 0,
  progressTotal: 0
};
var ready = Promise.all([
  chrome.storage.local.get(["token", "baseUrl", "email", "lastSeq", "lastBody"]),
  chrome.storage.session.get(["lastFocus", "activeFrame"])
]).then(([stored, session]) => {
  token = stored.token || null;
  baseUrl = (stored.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  email = stored.email || "";
  lastSeq = Number(stored.lastSeq) || 0;
  lastBody = stored.lastBody || "";
  lastFocus = normalizeFrame(session.lastFocus);
  activeFrame = normalizeFrame(session.activeFrame);
});
function persistFrames() {
  return chrome.storage.session.set({ lastFocus, activeFrame });
}
function api(path) {
  return `${baseUrl}${path}`;
}
function senderFrame(sender) {
  if (sender?.tab?.id == null) return null;
  return normalizeFrame({ tabId: sender.tab.id, frameId: sender.frameId });
}
async function sync(presence, sender) {
  if (!token) return { ok: false, reason: "signed-out" };
  const frame = senderFrame(sender);
  const presenceState = presence?.sessionState || "idle";
  if (!activeFrame && (presenceState === "typing" || presenceState === "paused") && frame) {
    activeFrame = frame;
    void persistFrames();
  }
  const fromActive = sameFrame(activeFrame, frame);
  if (shouldReplaceLive(fromActive, activeFrame, presenceState)) {
    live = {
      sessionState: presenceState,
      detail: presence?.detail || "",
      progressIndex: Number(presence?.progressIndex) || 0,
      progressTotal: Number(presence?.progressTotal) || 0
    };
  }
  const status = {
    focused: Boolean(lastFocus),
    fieldKind: lastFocus?.fieldKind || "",
    host: lastFocus?.host || "",
    sessionState: notice ? "error" : live.sessionState,
    detail: notice || live.detail,
    progressIndex: live.progressIndex,
    progressTotal: live.progressTotal
  };
  if (notice) notice = "";
  let response;
  try {
    response = await fetch(api("/api/agent/sync"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ lastSeq, status })
    });
  } catch {
    return { ok: false, reason: "offline" };
  }
  if (response.status === 401) {
    token = null;
    await chrome.storage.local.remove("token");
    return { ok: false, reason: "signed-out" };
  }
  if (!response.ok) return { ok: false, reason: "http" };
  const data = await response.json();
  return {
    ok: true,
    snippets: data.snippets || [],
    settings: data.settings || DEFAULT_SETTINGS,
    command: data.command || null,
    seq: Number(data.seq) || 0
  };
}
async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {
    });
    await chrome.tabs.update(tabId, { active: true }).catch(() => {
    });
    return true;
  } catch {
    return false;
  }
}
async function deliver(command, sender) {
  const target = commandTarget(command.action, lastFocus, activeFrame);
  if (!target) {
    notice = "Click the field you want to type into, then press Start again.";
    return { delivered: false, forSender: null };
  }
  if (command.action === "start") {
    if (!await focusTab(target.tabId)) {
      notice = "The field's tab is gone. Click the field again, then press Start.";
      activeFrame = null;
      void persistFrames();
      return { delivered: false, forSender: null };
    }
    activeFrame = target;
    if (typeof command.body === "string") {
      lastBody = command.body;
      void chrome.storage.local.set({ lastBody });
    }
    void persistFrames();
  }
  if (sameFrame(target, senderFrame(sender))) {
    return { delivered: true, forSender: command };
  }
  try {
    await chrome.tabs.sendMessage(target.tabId, { type: "command", command }, { frameId: target.frameId });
    return { delivered: true, forSender: null };
  } catch {
    notice = "Could not reach that field. Refresh the page, click the field, and start again.";
    if (command.action === "start") {
      activeFrame = null;
      void persistFrames();
    }
    return { delivered: false, forSender: null };
  }
}
async function rememberSnippets(next) {
  if (Array.isArray(next) && next.length > 0) snippets = next;
}
async function toggleTyping() {
  await ready;
  const frame = activeFrame || lastFocus;
  if (!frame) {
    notice = "Click a text field first, then press the shortcut again.";
    return;
  }
  let mode = live.sessionState;
  try {
    const reply = await chrome.tabs.sendMessage(frame.tabId, { type: "session-state" }, { frameId: frame.frameId });
    if (reply?.mode) mode = reply.mode;
  } catch {
  }
  const action = toggleAction(mode);
  if (action === "start") {
    const body = lastBody || snippets[0]?.body;
    if (!body) {
      notice = "Save a snippet before starting from the shortcut.";
      return;
    }
    activeFrame = frame;
    void persistFrames();
    if (!await focusTab(frame.tabId)) return;
    try {
      await chrome.tabs.sendMessage(frame.tabId, { type: "command", command: { action: "start", body } }, { frameId: frame.frameId });
      lastBody = body;
      live.sessionState = "typing";
      void chrome.storage.local.set({ lastBody });
    } catch {
      notice = "Could not reach that field. Refresh the page and click it again.";
    }
    return;
  }
  try {
    await chrome.tabs.sendMessage(frame.tabId, { type: "command", command: { action } }, { frameId: frame.frameId });
    live.sessionState = action === "pause" ? "paused" : "typing";
  } catch {
    notice = "Could not reach the typing field. Click it and try the shortcut again.";
  }
}
var syncing = Promise.resolve();
function queueSync(presence, sender) {
  const run = syncing.then(async () => {
    const data = await sync(presence, sender);
    let commandForSender = null;
    if (data.ok && data.seq > lastSeq) {
      if (data.command) {
        const result = await deliver(data.command, sender);
        commandForSender = result.forSender;
        if (result.delivered) {
          lastSeq = data.seq;
          await chrome.storage.local.set({ lastSeq });
        }
      } else {
        lastSeq = data.seq;
        await chrome.storage.local.set({ lastSeq });
      }
    }
    if (data.ok) void rememberSnippets(data.snippets);
    return {
      ok: data.ok,
      reason: data.reason,
      snippets: data.snippets,
      settings: data.settings,
      command: commandForSender
    };
  });
  syncing = run.then(
    () => void 0,
    () => void 0
  );
  return run;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handle(message, sender).then(sendResponse);
  return true;
});
async function handle(message, sender) {
  await ready;
  if (message?.type === "get-state") {
    return { email, baseUrl, signedIn: Boolean(token) };
  }
  if (message?.type === "login") {
    baseUrl = String(message.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
    email = String(message.email || "").trim().toLowerCase();
    await chrome.storage.local.set({ baseUrl, email });
    try {
      const response = await fetch(api("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: message.password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) {
        return { ok: false, error: data.error || "Could not sign in." };
      }
      token = data.token;
      email = data.user?.email || email;
      lastSeq = 0;
      activeFrame = null;
      notice = "";
      await chrome.storage.local.set({ token, email, baseUrl, lastSeq: 0 });
      return { ok: true, email };
    } catch {
      return { ok: false, error: "The dashboard is not reachable at that address." };
    }
  }
  if (message?.type === "logout") {
    const current = token;
    token = null;
    email = "";
    lastSeq = 0;
    activeFrame = null;
    notice = "";
    await chrome.storage.local.remove(["token", "email"]);
    await chrome.storage.local.set({ lastSeq: 0 });
    if (current) {
      await fetch(api("/api/auth/logout"), {
        method: "POST",
        headers: { Authorization: `Bearer ${current}` }
      }).catch(() => {
      });
    }
    return { ok: true };
  }
  if (message?.type === "focus") {
    if (sender.tab?.id == null) return { ok: false };
    lastFocus = normalizeFrame({ tabId: sender.tab.id, frameId: sender.frameId });
    lastFocus.fieldKind = message.fieldKind || "field";
    lastFocus.host = message.host || "";
    void persistFrames();
    return { ok: true };
  }
  if (message?.type === "tick") {
    return queueSync(message.presence, sender);
  }
  return { ok: false };
}
chrome.commands.onCommand.addListener((name) => {
  if (name === "toggle-typing") void toggleTyping();
});
