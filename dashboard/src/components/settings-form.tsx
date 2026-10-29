"use client";

import { useEffect, useState } from "react";
import { errorText, readResponseJson } from "@/lib/read-response";

type Settings = {
  minCpm: number;
  maxCpm: number;
  minMistakePer100: number;
  maxMistakePer100: number;
  tabSize: number;
  expandTrigger: "immediate" | "tab";
};

const starter: Settings = {
  minCpm: 280,
  maxCpm: 620,
  minMistakePer100: 0,
  maxMistakePer100: 2,
  tabSize: 4,
  expandTrigger: "immediate",
};

export function SettingsForm() {
  const [settings, setSettings] = useState<Settings>(starter);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const response = await fetch("/api/settings");
        const data = await readResponseJson(response);
        if (cancel || !response.ok || !data.settings || typeof data.settings !== "object") return;
        setSettings(data.settings as Settings);
      } catch {
        if (!cancel) setError("Could not load typing settings.");
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    setSaved("");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await readResponseJson(response);
      if (!response.ok || !data.settings || typeof data.settings !== "object") {
        setError(errorText(data, "Could not save settings."));
        return;
      }
      setSettings(data.settings as Settings);
      setSaved("Typing settings saved.");
    } catch {
      setError("Could not save settings.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="stage-head">
        <div>
          <h1>Typing</h1>
          <p>Each snippet picks a pace and a mistake rate inside these ranges, then varies from character to character.</p>
        </div>
      </div>
      <div className="control-grid">
        <form
          className="panel editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="settings-grid">
            <label className="field">
              <span>Slowest speed (characters / minute)</span>
              <input type="number" min={30} max={12000} value={settings.minCpm} onChange={(event) => update("minCpm", Number(event.target.value))} />
            </label>
            <label className="field">
              <span>Fastest speed (characters / minute)</span>
              <input type="number" min={30} max={12000} value={settings.maxCpm} onChange={(event) => update("maxCpm", Number(event.target.value))} />
            </label>
            <label className="field">
              <span>Fewest mistakes per 100 characters</span>
              <input type="number" min={0} max={40} step="0.5" value={settings.minMistakePer100} onChange={(event) => update("minMistakePer100", Number(event.target.value))} />
            </label>
            <label className="field">
              <span>Most mistakes per 100 characters</span>
              <input type="number" min={0} max={40} step="0.5" value={settings.maxMistakePer100} onChange={(event) => update("maxMistakePer100", Number(event.target.value))} />
            </label>
            <label className="field">
              <span>Tab width</span>
              <input type="number" min={1} max={8} value={settings.tabSize} onChange={(event) => update("tabSize", Number(event.target.value))} />
            </label>
            <label className="field">
              <span>Expand shortcut</span>
              <select value={settings.expandTrigger} onChange={(event) => update("expandTrigger", event.target.value as Settings["expandTrigger"])}>
                <option value="immediate">As soon as it is typed</option>
                <option value="tab">When Tab is pressed</option>
              </select>
            </label>
          </div>
          <p className="lede">Mistakes are a nearby wrong key, then a backspace, then the right character. Only letters and digits are eligible, so indentation stays put. Editors that auto-indent, auto-close brackets, or accept a completion are corrected back to the saved snippet.</p>
          {error ? <p className="error">{error}</p> : null}
          {saved ? <p className="ok">{saved}</p> : null}
          <button className="primary" type="submit" disabled={pending}>Save typing settings</button>
        </form>
        <section className="panel editor">
          <h2>Extension</h2>
          <ol className="steps">
            <li>From the project folder, run <code>npm run build:extension</code>.</li>
            <li>Open <code>chrome://extensions</code>, turn on Developer mode, and choose Load unpacked.</li>
            <li>Select the <code>extension/dist</code> folder.</li>
            <li>Open the extension popup and sign in with the same account. Set the dashboard address to the URL printed when you start it, usually <code>http://localhost:3000</code>.</li>
            <li>Refresh any tab you want to type into. Typing goes through the page editor, so indentation and completions still apply, and Chrome does not show a debugging banner.</li>
          </ol>
        </section>
      </div>
    </>
  );
}
