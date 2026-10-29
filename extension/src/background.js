import { DEFAULT_SETTINGS } from "./defaults.js";

const DEFAULT_BASE = "http://localhost:3000";

let token = null;
let baseUrl = DEFAULT_BASE;
let email = "";
let lastSeq = 0;
let lastFocus = null;
let activeFrame = null;
let notice = "";
let live = {
  sessionState: "idle",
  detail: "",
  progressIndex: 0,
  progressTotal: 0,
};

const ready = chrome.storage.local
  .get(["token", "baseUrl", "email", "lastSeq"])
  .then((stored) => {
    token = stored.token || null;
    baseUrl = (stored.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
    email = stored.email || "";
    lastSeq = Number(stored.lastSeq) || 0;
  });

function api(path) {
  return `${baseUrl}${path}`;
}

function sameFrame(left, right) {
  return Boolean(left && right && left.tabId === right.tabId && left.frameId === right.frameId);
}

async function sync(presence, sender) {
  if (!token) return { ok: false, reason: "signed-out" };
  const fromActive = sameFrame(activeFrame, { tabId: sender.tab?.id, frameId: sender.frameId });
  if (fromActive || !activeFrame) {
    live = {
      sessionState: presence?.sessionState || "idle",
      detail: presence?.detail || "",
      progressIndex: Number(presence?.progressIndex) || 0,
      progressTotal: Number(presence?.progressTotal) || 0,
    };
  }

  const status = {
    focused: Boolean(lastFocus),
    fieldKind: lastFocus?.fieldKind || "",
    host: lastFocus?.host || "",
    sessionState: notice ? "error" : live.sessionState,
    detail: notice || live.detail,
    progressIndex: live.progressIndex,
    progressTotal: live.progressTotal,
  };
  if (notice) notice = "";

  let response;
  try {
    response = await fetch(api("/api/agent/sync"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ lastSeq, status }),
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
    seq: Number(data.seq) || 0,
  };
}

async function deliver(command, seq) {
  const target = command.action === "start" ? lastFocus : activeFrame;
  lastSeq = seq;
  await chrome.storage.local.set({ lastSeq });
  if (!target?.tabId && target?.tabId !== 0) {
    notice = "Click the field you want to type into, then press Start again.";
    return;
  }
  if (command.action === "start") {
    activeFrame = { tabId: target.tabId, frameId: target.frameId };
    let tab;
    try {
      tab = await chrome.tabs.get(target.tabId);
    } catch {
      notice = "The field's tab is gone. Click the field again, then press Start.";
      activeFrame = null;
      return;
    }
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    await chrome.tabs.update(target.tabId, { active: true }).catch(() => {});
  }
  try {
    await chrome.tabs.sendMessage(target.tabId, { type: "command", command }, { frameId: target.frameId });
  } catch {
    notice = "Could not reach that field. Refresh the page, click the field, and start again.";
    if (command.action === "start") activeFrame = null;
  }
}

let syncing = Promise.resolve();

function queueSync(presence, sender) {
  const run = syncing.then(async () => {
    const data = await sync(presence, sender);
    if (data.ok && data.seq > lastSeq) {
      lastSeq = data.seq;
      await chrome.storage.local.set({ lastSeq });
      if (data.command) await deliver(data.command, data.seq);
    }
    return {
      ok: data.ok,
      reason: data.reason,
      snippets: data.snippets,
      settings: data.settings,
    };
  });
  syncing = run.then(
    () => undefined,
    () => undefined,
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
        body: JSON.stringify({ email, password: message.password }),
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
        headers: { Authorization: `Bearer ${current}` },
      }).catch(() => {});
    }
    return { ok: true };
  }
  if (message?.type === "focus") {
    if (sender.tab?.id == null) return { ok: false };
    lastFocus = {
      tabId: sender.tab.id,
      frameId: sender.frameId,
      fieldKind: message.fieldKind || "field",
      host: message.host || "",
    };
    return { ok: true };
  }
  if (message?.type === "tick") {
    return queueSync(message.presence, sender);
  }
  return { ok: false };
}
