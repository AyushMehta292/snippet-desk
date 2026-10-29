import assert from "node:assert/strict";
import test from "node:test";
import { eraseSuffix, typeSnippet, TypingSession } from "./engine.js";
import {
  indentToward,
  keyDelayMs,
  leadingWhitespace,
  matchShortcut,
  normalizeNewlines,
  restoreStep,
  whitespaceColumns,
} from "./reconcile.js";

const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };

class FakeEditor {
  constructor(options = {}) {
    this.text = options.text ?? "";
    this.cursor = options.cursor ?? this.text.length;
    this.autoIndent = options.autoIndent ?? false;
    this.autoClose = options.autoClose ?? false;
    this.tabSize = options.tabSize ?? 4;
    this.insertSpaces = options.insertSpaces ?? true;
    this.useTabStops = options.useTabStops ?? false;
    this.completions = options.completions ?? {};
    this.suggestions = false;
  }

  snapshot() {
    const lineStart = this.text.lastIndexOf("\n", Math.max(0, this.cursor - 1)) + 1;
    const nextBreak = this.text.indexOf("\n", this.cursor);
    const lineEnd = nextBreak === -1 ? this.text.length : nextBreak;
    return { line: this.text.slice(lineStart, lineEnd), col: this.cursor - lineStart };
  }

  suggestionsOpen() {
    return this.suggestions;
  }

  splice(value) {
    this.text = this.text.slice(0, this.cursor) + value + this.text.slice(this.cursor);
    this.cursor += value.length;
  }

  press(name) {
    if (name === "Enter") this.typeChar("\n");
    else if (name === "Backspace") this.backspace();
    else if (name === "Delete") this.deleteForward();
    else if (name === "Escape") this.suggestions = false;
    else if (name === "ArrowRight" && this.cursor < this.text.length) this.cursor += 1;
  }

  pressChar(char) {
    this.typeChar(char);
  }

  insertText(text) {
    if (text === "\t" && this.insertSpaces) {
      this.splice(" ".repeat(this.tabSize));
      return;
    }
    this.splice(text);
  }

  backspace() {
    if (this.cursor === 0) return;
    if (this.useTabStops) {
      const snap = this.snapshot();
      const before = snap.line.slice(0, snap.col);
      if (/^[ ]+$/.test(before) && before.length % this.tabSize === 0) {
        const count = Math.min(this.tabSize, before.length);
        this.text = this.text.slice(0, this.cursor - count) + this.text.slice(this.cursor);
        this.cursor -= count;
        return;
      }
    }
    this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
    this.cursor -= 1;
  }

  deleteForward() {
    if (this.cursor >= this.text.length) return;
    this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
  }

  typeChar(char) {
    if (char === "\n") {
      if (this.suggestions) {
        this.splice("ACCEPTED");
        this.suggestions = false;
        return;
      }
      if (this.autoIndent) {
        const snap = this.snapshot();
        const indent = leadingWhitespace(snap.line);
        const before = snap.line.slice(0, snap.col);
        let extra = "";
        if (/[{:]$/.test(before.trimEnd())) {
          extra = this.insertSpaces ? " ".repeat(this.tabSize) : "\t";
        }
        this.splice(`\n${indent}${extra}`);
        return;
      }
      this.splice("\n");
      return;
    }

    const snap = this.snapshot();
    const before = snap.line.slice(0, snap.col);
    const word = (before.match(/[A-Za-z0-9_]*$/)?.[0] ?? "") + char;
    if (this.completions[word]) {
      const completion = this.completions[word];
      const wordStart = this.cursor - (word.length - 1);
      this.text = this.text.slice(0, wordStart) + completion + this.text.slice(this.cursor);
      this.cursor = wordStart + completion.length;
      return;
    }

    this.splice(char);
    if (this.autoClose && PAIRS[char]) {
      this.text = this.text.slice(0, this.cursor) + PAIRS[char] + this.text.slice(this.cursor);
    }
    if (char === ".") this.suggestions = true;
  }
}

function ioFor(editor, rng = () => 0.5) {
  return {
    snapshot: () => editor.snapshot(),
    suggestionsOpen: () => editor.suggestionsOpen(),
    press: async (name) => editor.press(name),
    pressChar: async (char) => editor.pressChar(char),
    insertText: async (text) => editor.insertText(text),
    settle: async () => {},
    sleep: async () => {},
    rng,
  };
}

const fast = {
  minCpm: 12000,
  maxCpm: 12000,
  minMistakePer100: 0,
  maxMistakePer100: 0,
  tabSize: 4,
  expandTrigger: "immediate",
};

function visual(text, tabSize = 4) {
  return normalizeNewlines(text)
    .split("\n")
    .map((line) => {
      const indent = leadingWhitespace(line);
      return `${whitespaceColumns(indent, tabSize)}|${line.slice(indent.length)}`;
    })
    .join("\n");
}

async function typeInto(editor, body, settings = fast, hooks) {
  const session = new TypingSession();
  const result = await typeSnippet(body, ioFor(editor), settings, session, hooks);
  return result;
}

test("plain text keeps spaces, blank lines, and trailing whitespace", async () => {
  const editor = new FakeEditor();
  const body = "alpha\n\n    beta  \n";
  const result = await typeInto(editor, body);
  assert.equal(result.status, "done");
  assert.equal(editor.text, body);
});

test("auto-indent and auto-close still land on the saved snippet", async () => {
  const editor = new FakeEditor({ autoIndent: true, autoClose: true, useTabStops: true });
  const body = ["def solve(n):", "    if n <= 1:", "        return n", "    return n * solve(n - 1)", ""].join("\n");
  const result = await typeInto(editor, body);
  assert.equal(result.status, "done");
  assert.equal(editor.text, body);
});

test("brace snippets survive auto-close and tab-to-spaces conversion", async () => {
  const editor = new FakeEditor({ autoIndent: true, autoClose: true, insertSpaces: true, useTabStops: true });
  const body = "function f() {\n\treturn 1;\n}\n";
  const result = await typeInto(editor, body);
  assert.equal(result.status, "done");
  assert.equal(visual(editor.text), visual(body));
  assert.equal(editor.text.includes("ACCEPTED"), false);
});

test("suggestion popups are dismissed before enter", async () => {
  const editor = new FakeEditor({ autoIndent: true });
  const body = "foo.\nbar";
  await typeInto(editor, body);
  assert.equal(editor.text, body);
});

test("autocomplete that matches the snippet is kept", async () => {
  const editor = new FakeEditor({ completions: { prin: "print" } });
  await typeInto(editor, "print(1)");
  assert.equal(editor.text, "print(1)");
});

test("autocomplete that diverges from the snippet is removed", async () => {
  const editor = new FakeEditor({ completions: { prin: "println" } });
  await typeInto(editor, "print(1)");
  assert.equal(editor.text, "print(1)");
});

test("mistakes are corrected before the snippet continues", async () => {
  const editor = new FakeEditor();
  const settings = { ...fast, minMistakePer100: 100, maxMistakePer100: 100 };
  const result = await typeInto(editor, "Ab9", settings);
  assert.equal(result.status, "done");
  assert.equal(editor.text, "Ab9");
});

test("stop leaves a partial snippet", async () => {
  const editor = new FakeEditor();
  const session = new TypingSession();
  const result = await typeSnippet("abcdef", ioFor(editor), fast, session, {
    onChar({ index }) {
      if (index === 3) session.stop();
    },
  });
  assert.equal(result.status, "stopped");
  assert.equal(editor.text, "abc");
});

test("pause holds typing until resume", async () => {
  const editor = new FakeEditor();
  const session = new TypingSession();
  let paused = false;
  const result = await Promise.race([
    typeSnippet("abcdef", ioFor(editor), fast, session, {
      onChar({ index }) {
        if (index === 2) {
          paused = session.mode === "typing";
          session.pause();
          assert.equal(session.mode, "paused");
          queueMicrotask(() => session.resume());
        }
      },
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("pause did not resume")), 1000)),
  ]);
  assert.equal(paused, true);
  assert.equal(result.status, "done");
  assert.equal(editor.text, "abcdef");
});

test("existing indent is rewritten to the snippet indent", async () => {
  const editor = new FakeEditor({ text: "        ", cursor: 8, useTabStops: true });
  await typeInto(editor, "    return 1");
  assert.equal(editor.text, "    return 1");
});

test("eraseSuffix removes the shortcut and nothing before it", async () => {
  const editor = new FakeEditor({ text: "ready ;;sol", cursor: "ready ;;sol".length });
  const session = new TypingSession();
  session.start();
  const erased = await eraseSuffix(ioFor(editor), ";;sol", session);
  assert.equal(erased, true);
  assert.equal(editor.text, "ready ");
});

test("shortcut matching prefers the longest boundary-aware shortcut", () => {
  const items = [
    { shortcut: "fn", body: "short" },
    { shortcut: ";fn", body: "long" },
    { shortcut: "alpha", body: "word" },
  ];
  assert.equal(matchShortcut("use ;fn", items).body, "long");
  assert.equal(matchShortcut("afn", items), null);
  assert.equal(matchShortcut("fn", items).body, "short");
  assert.equal(matchShortcut("xx alpha", items).body, "word");
});

test("newline normalization keeps other whitespace", () => {
  assert.equal(normalizeNewlines("a\r\nb\rc  \t"), "a\nb\nc  \t");
});

test("indent planner matches columns when tabs and spaces differ", () => {
  assert.deepEqual(indentToward("    ", "    ", 4), { op: "done" });
  assert.deepEqual(indentToward("\t", "    ", 4), { op: "done" });
  assert.equal(indentToward("", "    ", 4).op, "insert");
  assert.equal(indentToward("        ", "    ", 4).op, "backspace");
  assert.equal(indentToward("code", "    ", 4).op, "blocked");
});

test("restore step keeps a matching completion and rejects a longer one", () => {
  assert.deepEqual(restoreStep("print", "prin", "t(1)"), { op: "done", skip: 1 });
  assert.equal(restoreStep("println", "prin", "t(1)").op, "backspace");
  assert.equal(restoreStep("pri", "prin", "t").op, "missing");
});

test("typing delay stays inside the configured speed", () => {
  const delay = keyDelayMs("a", 600, 600, () => 0.5);
  assert.equal(delay, 100);
});
