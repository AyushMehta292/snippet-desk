"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { errorText, readResponseJson } from "@/lib/read-response";

type Snippet = {
  id: string;
  name: string;
  shortcut: string;
  body: string;
  updatedAt: number;
};

const empty = { id: "", name: "", shortcut: "", body: "" };

function showInvisibles(text: string) {
  return text.replace(/ /g, "·").replace(/\t/g, "→");
}

export function SnippetDesk() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [draft, setDraft] = useState(empty);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [showSpaces, setShowSpaces] = useState(true);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const caretRef = useRef<number | null>(null);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const response = await fetch("/api/snippets");
        const data = await readResponseJson(response);
        if (cancel) return;
        if (!response.ok || !Array.isArray(data.snippets)) {
          setError(errorText(data, "Could not load snippets."));
          return;
        }
        const next = data.snippets as Snippet[];
        setSnippets(next);
        if (next[0]) setDraft(next[0]);
      } catch {
        if (!cancel) setError("Could not load snippets.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const preview = useMemo(() => (showSpaces ? showInvisibles(draft.body) : draft.body), [draft.body, showSpaces]);

  useEffect(() => {
    if (caretRef.current == null) return;
    const field = document.getElementById("snippet-body");
    if (!(field instanceof HTMLTextAreaElement)) return;
    field.selectionStart = caretRef.current;
    field.selectionEnd = caretRef.current;
    caretRef.current = null;
  }, [draft.body]);

  function select(snippet: Snippet) {
    setDraft(snippet);
    setWarning("");
    setError("");
    setSaved("");
  }

  function onBodyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const el = event.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = `${draft.body.slice(0, start)}\t${draft.body.slice(end)}`;
    caretRef.current = start + 1;
    setDraft({ ...draft, body: next });
  }

  async function save() {
    if (working) return;
    setWorking(true);
    setError("");
    setSaved("");
    setWarning("");
    try {
      const payload = { name: draft.name, shortcut: draft.shortcut, body: draft.body };
      const response = await fetch(draft.id ? `/api/snippets/${draft.id}` : "/api/snippets", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readResponseJson(response);
      if (!response.ok || !data.snippet || typeof data.snippet !== "object") {
        setError(errorText(data, "Could not save."));
        return;
      }
      const snippet = data.snippet as Snippet;
      setSnippets((current) => {
        const rest = current.filter((item) => item.id !== snippet.id);
        return [snippet, ...rest];
      });
      setDraft(snippet);
      setWarning(typeof data.warning === "string" ? data.warning : "");
      setSaved("Saved. Spaces and tabs were kept exactly.");
    } catch {
      setError("Could not save.");
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    if (working) return;
    if (!draft.id) {
      setDraft(empty);
      return;
    }
    if (!window.confirm(`Delete “${draft.name || draft.shortcut}”?`)) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/snippets/${draft.id}`, { method: "DELETE" });
      const data = await readResponseJson(response);
      if (!response.ok) {
        setError(errorText(data, "Could not delete."));
        return;
      }
      const rest = snippets.filter((item) => item.id !== draft.id);
      setSnippets(rest);
      setDraft(rest[0] || empty);
      setSaved("");
    } catch {
      setError("Could not delete.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <div className="stage-head">
        <div>
          <h1>Snippets</h1>
          <p>Each shortcut expands into the saved text, including its indentation.</p>
        </div>
        <button
          className="primary"
          type="button"
          onClick={() => {
            setDraft(empty);
            setWarning("");
            setError("");
            setSaved("");
          }}
        >
          New snippet
        </button>
      </div>
      <div className="desk">
        <div className="panel snippet-list">
          {loading ? <p className="lede">Loading…</p> : null}
          {!loading && snippets.length === 0 ? <p className="lede">No snippets yet.</p> : null}
          {snippets.map((snippet) => (
            <button
              key={snippet.id}
              type="button"
              className="snippet-item"
              aria-pressed={snippet.id === draft.id}
              onClick={() => select(snippet)}
            >
              <strong>{snippet.name}</strong>
              <small>{snippet.shortcut}</small>
            </button>
          ))}
        </div>
        <form
          className="panel editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="row">
            <label className="field">
              <span>Name</span>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
            </label>
            <label className="field">
              <span>Shortcut</span>
              <input
                value={draft.shortcut}
                onChange={(event) => setDraft({ ...draft, shortcut: event.target.value })}
                spellCheck={false}
                autoCapitalize="off"
                required
              />
            </label>
          </div>
          <label className="field">
            <span>Text</span>
            <textarea
              id="snippet-body"
              className="snippet-body"
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              onKeyDown={onBodyKeyDown}
              spellCheck={false}
              autoCorrect="off"
              required
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={showSpaces} onChange={(event) => setShowSpaces(event.target.checked)} /> Show spaces and tabs
          </label>
          <pre className="preview">{preview || " "}</pre>
          {error ? <p className="error">{error}</p> : null}
          {warning ? <p className="note">{warning}</p> : null}
          {saved ? <p className="ok">{saved}</p> : null}
          <div className="actions">
            <button className="primary" type="submit" disabled={working}>Save snippet</button>
            <button className="danger" type="button" disabled={working} onClick={() => void remove()}>Delete</button>
          </div>
        </form>
      </div>
    </>
  );
}
