if (!globalThis.__snippetDeskBridge) {
  globalThis.__snippetDeskBridge = true;
  window.addEventListener("message", onMessage);
}

function onMessage(event) {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== "snippet-desk" || typeof msg.id !== "number") return;
  let result;
  try {
    result = perform(msg);
  } catch (error) {
    result = { ok: false, error: error?.message || "Could not type into this field." };
  }
  window.postMessage({ source: "snippet-desk-result", id: msg.id, ...result }, "*");
}

function perform(msg) {
  if (msg.op === "ping") return { ok: true, snap: null };
  const node = deepActive();
  const roots = findRoots(node);

  if (roots.monaco) {
    const editor = findMonaco(roots.monaco);
    if (editor) {
      if (msg.op !== "snapshot") monacoAct(editor, msg);
      return { ok: true, snap: snapMonaco(editor) };
    }
  }
  if (roots.ace) {
    const editor = findAce(roots.ace);
    if (editor) {
      if (msg.op !== "snapshot") aceAct(editor, msg);
      return { ok: true, snap: snapAce(editor) };
    }
  }
  if (roots.cm5) {
    const editor = roots.cm5.CodeMirror;
    if (editor?.getCursor) {
      if (msg.op !== "snapshot") cm5Act(editor, msg);
      return { ok: true, snap: snapCm5(editor) };
    }
  }
  if (roots.cm6) {
    const view = findCm6(roots.cm6);
    if (view) {
      if (msg.op !== "snapshot") cm6Act(view, msg);
      return { ok: true, snap: snapCm6(view) };
    }
  }
  if (msg.op !== "snapshot") plainAct(msg);
  return { ok: true, snap: snapPlain() };
}

function deepActive() {
  let node = document.activeElement;
  const seen = new Set();
  while (node?.shadowRoot?.activeElement && !seen.has(node)) {
    seen.add(node);
    node = node.shadowRoot.activeElement;
  }
  return node;
}

function findRoots(node) {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!(element instanceof Element)) return {};
  return {
    monaco: element.closest(".monaco-editor"),
    ace: element.closest(".ace_editor"),
    cm5: element.closest(".CodeMirror"),
    cm6: element.closest(".cm-editor"),
  };
}

function findMonaco(root) {
  const list = globalThis.monaco?.editor?.getEditors?.() || [];
  for (const editor of list) {
    const dom = editor.getDomNode?.();
    if (dom && (dom === root || dom.contains(root) || root.contains(dom))) return editor;
  }
  for (const key of Object.getOwnPropertyNames(root)) {
    try {
      const value = root[key];
      if (value && typeof value.getModel === "function" && typeof value.getPosition === "function" && typeof value.trigger === "function") {
        return value;
      }
    } catch {
      /* host objects can throw */
    }
  }
  return null;
}

function findAce(root) {
  if (root.env?.editor?.session) return root.env.editor;
  try {
    if (globalThis.ace?.edit) return globalThis.ace.edit(root);
  } catch {
    return null;
  }
  return null;
}

function findCm6(root) {
  for (let node = root; node; node = node.parentElement) {
    const view = node.cmView;
    if (view?.state && typeof view.dispatch === "function") return view;
  }
  return null;
}

function stampMonaco(editor) {
  const position = editor.getPosition?.();
  const model = editor.getModel?.();
  if (!position || !model) return "";
  return `${position.lineNumber}:${position.column}:${model.getValueLength?.() ?? ""}`;
}

function monacoAct(editor, msg) {
  try {
    editor.focus?.();
  } catch {
    /* focus can fail when the frame is in the background */
  }
  const before = stampMonaco(editor);
  if (msg.op === "char" || msg.op === "insert") {
    const text = String(msg.text ?? "");
    if (text === "\t") editor.trigger("keyboard", "tab", {});
    else if (text) editor.trigger("keyboard", "type", { text });
    if (text && stampMonaco(editor) === before) monacoInsert(editor, text === "\t" ? monacoTabText(editor) : text);
    return;
  }
  const name = msg.name;
  if (name === "Enter") {
    editor.trigger("keyboard", "type", { text: "\n" });
    if (stampMonaco(editor) === before) monacoInsert(editor, "\n");
    return;
  }
  if (name === "Backspace") {
    editor.trigger("keyboard", "deleteLeft", {});
    if (stampMonaco(editor) === before) monacoDelete(editor, -1);
    return;
  }
  if (name === "Delete") {
    editor.trigger("keyboard", "deleteRight", {});
    if (stampMonaco(editor) === before) monacoDelete(editor, 1);
    return;
  }
  if (name === "ArrowRight") {
    editor.trigger("keyboard", "cursorRight", {});
    if (stampMonaco(editor) === before) monacoMove(editor, 1);
    return;
  }
  if (name === "Tab") {
    editor.trigger("keyboard", "tab", {});
    if (stampMonaco(editor) === before) monacoInsert(editor, monacoTabText(editor));
    return;
  }
  if (name === "Escape") {
    try {
      editor.getContribution?.("editor.contrib.suggestController")?.cancelSuggestWidget?.();
    } catch {
      /* the widget may already be closed */
    }
    try {
      const inline = editor.getContribution?.("editor.contrib.inlineCompletionsController");
      inline?.reject?.() || inline?.stop?.();
    } catch {
      /* inline suggestions are optional */
    }
    try {
      editor.trigger("keyboard", "hideSuggestWidget", {});
    } catch {
      /* older editors use a different command id */
    }
    try {
      editor.trigger("keyboard", "editor.action.inlineSuggest.hide", {});
    } catch {
      /* ignore */
    }
  }
}

function monacoTabText(editor) {
  const model = editor.getModel();
  const position = editor.getPosition();
  const options = model?.getOptions?.() || {};
  const size = Number(options.tabSize) || 4;
  if (options.insertSpaces === false) return "\t";
  const column = Math.max(0, (position?.column || 1) - 1);
  return " ".repeat(Math.max(1, size - (column % size)));
}

function monacoInsert(editor, text) {
  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position || !text) return;
  const offset = model.getOffsetAt(position);
  editor.executeEdits("snippet-desk", [
    {
      range: {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      },
      text,
      forceMoveMarkers: true,
    },
  ]);
  editor.setPosition(model.getPositionAt(offset + text.length));
}

function monacoDelete(editor, direction) {
  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position) return;
  const offset = model.getOffsetAt(position);
  const next = offset + direction;
  if (next < 0 || next > model.getValueLength()) return;
  const start = model.getPositionAt(Math.min(offset, next));
  const end = model.getPositionAt(Math.max(offset, next));
  editor.executeEdits("snippet-desk", [
    {
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      text: "",
      forceMoveMarkers: true,
    },
  ]);
  editor.setPosition(start);
}

function monacoMove(editor, direction) {
  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position) return;
  const offset = model.getOffsetAt(position) + direction;
  if (offset < 0 || offset > model.getValueLength()) return;
  editor.setPosition(model.getPositionAt(offset));
}

function snapMonaco(editor) {
  const model = editor.getModel?.();
  const position = editor.getPosition?.();
  if (!model || !position) return null;
  const line = model.getLineContent(position.lineNumber);
  return { kind: "monaco", line, col: clamp(position.column - 1, 0, line.length) };
}

function aceAct(editor, msg) {
  editor.focus?.();
  if (msg.op === "char" || msg.op === "insert") {
    const text = String(msg.text ?? "");
    if (!text) return;
    if (text === "\t") {
      if (editor.execCommand?.("indent") === false) editor.insert?.(editor.session?.getTabString?.() || "\t");
      return;
    }
    if (typeof editor.execCommand === "function" && editor.execCommand("insertstring", text) !== false) return;
    editor.insert?.(text);
    return;
  }
  const name = msg.name;
  if (name === "Enter") {
    aceNewline(editor);
    return;
  }
  if (name === "Backspace") {
    editor.execCommand?.("backspace");
    return;
  }
  if (name === "Delete") {
    editor.execCommand?.("del");
    return;
  }
  if (name === "ArrowRight") {
    editor.execCommand?.("gotoright");
    return;
  }
  if (name === "Tab") {
    editor.execCommand?.("indent");
    return;
  }
  if (name === "Escape") {
    try {
      editor.completer?.detach?.();
    } catch {
      /* popup already closed */
    }
  }
}

function aceNewline(editor) {
  const cursor = editor.getCursorPosition();
  const state = editor.session.getState(cursor.row);
  const line = editor.session.getLine(cursor.row);
  const tab = editor.session.getTabString();
  editor.insert("\n");
  const mode = editor.session.getMode?.();
  if (typeof mode?.getNextLineIndent !== "function") return;
  let want = "";
  try {
    want = mode.getNextLineIndent(state, line, tab) || "";
  } catch {
    return;
  }
  const pos = editor.getCursorPosition();
  const have = (editor.session.getLine(pos.row).match(/^[ \t]*/) || [""])[0];
  if (want.length > have.length && want.startsWith(have)) editor.session.insert(pos, want.slice(have.length));
}

function snapAce(editor) {
  const pos = editor.getCursorPosition();
  const line = editor.session.getLine(pos.row) ?? "";
  return { kind: "ace", line, col: clamp(pos.column, 0, line.length) };
}

function cm5Act(cm, msg) {
  cm.focus?.();
  if (msg.op === "char" || msg.op === "insert") {
    const text = String(msg.text ?? "");
    if (!text) return;
    if (text === "\t") {
      cm.execCommand("defaultTab");
      return;
    }
    cm.replaceSelection(text, "end", "+input");
    return;
  }
  const name = msg.name;
  if (name === "Enter") {
    cm.execCommand("newlineAndIndent");
    return;
  }
  if (name === "Backspace") {
    cm.execCommand("delCharBefore");
    return;
  }
  if (name === "Delete") {
    cm.execCommand("delCharAfter");
    return;
  }
  if (name === "ArrowRight") {
    cm.execCommand("goCharRight");
    return;
  }
  if (name === "Tab") {
    cm.execCommand("defaultTab");
    return;
  }
  if (name === "Escape" && typeof cm.closeHint === "function") cm.closeHint();
}

function snapCm5(cm) {
  const pos = cm.getCursor();
  const line = cm.getLine(pos.line) ?? "";
  return { kind: "cm5", line, col: clamp(pos.ch, 0, line.length) };
}

function cm6Act(view, msg) {
  view.focus?.();
  const target = view.contentDOM || view.dom;
  if (msg.op === "char" || msg.op === "insert") {
    const text = String(msg.text ?? "");
    if (!text) return;
    if (text === "\t") {
      if (!pressKey(target, "Tab", "Tab", 9)) cm6Insert(view, cm6TabText(view));
      return;
    }
    cm6Insert(view, text);
    return;
  }
  const name = msg.name;
  if (name === "Enter") {
    if (!pressKey(target, "Enter", "Enter", 13)) cm6Insert(view, "\n");
    return;
  }
  if (name === "Backspace") {
    if (!pressKey(target, "Backspace", "Backspace", 8)) cm6Delete(view, -1);
    return;
  }
  if (name === "Delete") {
    if (!pressKey(target, "Delete", "Delete", 46)) cm6Delete(view, 1);
    return;
  }
  if (name === "ArrowRight") {
    if (!pressKey(target, "ArrowRight", "ArrowRight", 39)) cm6Move(view, 1);
    return;
  }
  if (name === "Tab") {
    if (!pressKey(target, "Tab", "Tab", 9)) cm6Insert(view, cm6TabText(view));
    return;
  }
  if (name === "Escape") pressKey(target, "Escape", "Escape", 27);
}

function pressKey(target, key, code, keyCode) {
  const event = new KeyboardEvent("keydown", {
    key,
    code,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
  });
  target?.dispatchEvent(event);
  return event.defaultPrevented;
}

function cm6TabText(view) {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const size = Number(view.state.tabSize) || 4;
  const column = head - line.from;
  return " ".repeat(Math.max(1, size - (column % size)));
}

function cm6Insert(view, text) {
  const sel = view.state.selection.main;
  const from = sel.empty ? sel.head : sel.from;
  const to = sel.empty ? sel.head : sel.to;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.type",
  });
}

function cm6Delete(view, direction) {
  const sel = view.state.selection.main;
  if (!sel.empty) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: "" },
      selection: { anchor: sel.from },
      userEvent: direction < 0 ? "delete.backward" : "delete.forward",
    });
    return;
  }
  const next = sel.head + direction;
  if (next < 0 || next > view.state.doc.length) return;
  const from = Math.min(sel.head, next);
  const to = Math.max(sel.head, next);
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
    userEvent: direction < 0 ? "delete.backward" : "delete.forward",
  });
}

function cm6Move(view, direction) {
  const head = view.state.selection.main.head + direction;
  if (head < 0 || head > view.state.doc.length) return;
  view.dispatch({ selection: { anchor: head }, userEvent: "select" });
}

function snapCm6(view) {
  const offset = view.state.selection.main.head;
  const line = view.state.doc.lineAt(offset);
  return { kind: "cm6", line: line.text, col: clamp(offset - line.from, 0, line.text.length) };
}

function plainAct(msg) {
  if (msg.op === "char" || msg.op === "insert") {
    document.execCommand("insertText", false, String(msg.text ?? ""));
    return;
  }
  const active = document.activeElement;
  const name = msg.name;
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
    active?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }),
    );
  }
}

function snapPlain() {
  const active = deepActive();
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    const value = active.value ?? "";
    const cursor = active.selectionStart ?? 0;
    const safe = clamp(cursor, 0, value.length);
    const lineStart = value.lastIndexOf("\n", Math.max(0, safe - 1)) + 1;
    const nextBreak = value.indexOf("\n", safe);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const kind = active instanceof HTMLTextAreaElement ? "textarea" : "input";
    return { kind, line: value.slice(lineStart, lineEnd), col: safe - lineStart };
  }
  return null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
