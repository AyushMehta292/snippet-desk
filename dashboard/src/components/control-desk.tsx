"use client";

import { useEffect, useState } from "react";
import { errorText, readResponseJson } from "@/lib/read-response";

type Snippet = { id: string; name: string; shortcut: string; body: string };
type Status = {
  online: boolean;
  focused: boolean;
  fieldKind: string;
  host: string;
  sessionState: string;
  detail: string;
  progressIndex: number;
  progressTotal: number;
};

const fields: Record<string, string> = {
  textarea: "text area",
  input: "text input",
  monaco: "Monaco editor",
  ace: "Ace editor",
  cm5: "CodeMirror editor",
  cm6: "CodeMirror editor",
  contenteditable: "editable text",
};

const idleStatus: Status = {
  online: false,
  focused: false,
  fieldKind: "",
  host: "",
  sessionState: "idle",
  detail: "",
  progressIndex: 0,
  progressTotal: 0,
};

export function ControlDesk() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snippetId, setSnippetId] = useState("");
  const [status, setStatus] = useState<Status>(idleStatus);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const response = await fetch("/api/snippets");
        const data = await readResponseJson(response);
        if (cancel || !response.ok || !Array.isArray(data.snippets)) return;
        const next = data.snippets as Snippet[];
        setSnippets(next);
        if (next[0]) setSnippetId(next[0].id);
      } catch {
        if (!cancel) setError("Could not load snippets.");
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const response = await fetch("/api/agent/status");
        if (!response.ok || stop) return;
        const data = await readResponseJson(response);
        if (stop || typeof data.online !== "boolean") return;
        setStatus(data as Status);
      } catch {
        /* keep the last status if a poll fails */
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 800);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const selected = snippets.find((snippet) => snippet.id === snippetId) || null;
  const typing = status.sessionState === "typing";
  const paused = status.sessionState === "paused";
  const progress = status.progressTotal > 0 ? Math.min(100, Math.round((status.progressIndex / status.progressTotal) * 100)) : 0;
  const fieldLabel = fields[status.fieldKind] || status.fieldKind;

  async function send(action: "start" | "pause" | "resume" | "stop") {
    if (sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/agent/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, snippetId }),
      });
      const data = await readResponseJson(response);
      if (!response.ok) setError(errorText(data, "Could not send that control."));
    } catch {
      setError("Could not send that control.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="stage-head">
        <div>
          <h1>Live control</h1>
          <p>Start, pause, or end typing in the last field you clicked. Ctrl+Shift+Space does the same from the page. On a Mac, use Command+Shift+Space.</p>
        </div>
      </div>
      <div className="control-grid">
        <section className="panel editor">
          <div className="status-line">
            <span className={status.online ? "dot on" : "dot"} />
            <strong>{status.online ? "Extension connected" : "Extension not connected"}</strong>
          </div>
          <p className="lede">
            {status.focused
              ? `Will type into the last ${fieldLabel || "field"}${status.host ? ` on ${status.host}` : ""}.`
              : "Click a text field in any tab, then come back and press Start."}
          </p>
          {status.detail ? <p className="note">{status.detail}</p> : null}
          <div className="meter" aria-hidden="true"><span style={{ width: `${typing || paused ? progress : 0}%` }} /></div>
          <label className="field">
            <span>Snippet</span>
            <select value={snippetId} onChange={(event) => setSnippetId(event.target.value)}>
              {snippets.length === 0 ? <option value="">No snippets yet</option> : null}
              {snippets.map((snippet) => (
                <option key={snippet.id} value={snippet.id}>
                  {snippet.name} · {snippet.shortcut}
                </option>
              ))}
            </select>
          </label>
          <pre className="preview">{selected?.body || "Save a snippet first."}</pre>
          {error ? <p className="error">{error}</p> : null}
          <div className="control-actions">
            <button className="primary" type="button" disabled={!snippetId || sending} onClick={() => void send("start")}>Start</button>
            {paused ? (
              <button className="ghost" type="button" disabled={sending} onClick={() => void send("resume")}>Resume</button>
            ) : (
              <button className="ghost" type="button" disabled={!typing || sending} onClick={() => void send("pause")}>Pause</button>
            )}
            <button className="danger" type="button" disabled={sending || (!typing && !paused)} onClick={() => void send("stop")}>End</button>
          </div>
        </section>
        <section className="panel editor">
          <h2>Test pad</h2>
          <p className="lede">Click in this box, then press Start. The extension types here without leaving this page.</p>
          <textarea id="snippet-test-pad" className="test-pad" data-desk-pad="" spellCheck={false} defaultValue="" />
        </section>
      </div>
    </>
  );
}
