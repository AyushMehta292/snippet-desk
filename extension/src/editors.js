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
      /* host objects can throw */
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
  const lineEl =
    lines.find((line) => {
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
  const lineEl =
    lines.find((line) => {
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

export function editableFrom(node) {
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
      editor: findMonacoEditor(monaco),
    };
  }

  const ace = element.closest(".ace_editor");
  if (ace) {
    return {
      kind: "ace",
      root: ace,
      focusNode: ace.querySelector("textarea") || element,
      editor: findAceEditor(ace),
    };
  }

  const cm5 = element.closest(".CodeMirror");
  if (cm5) {
    return {
      kind: "cm5",
      root: cm5,
      focusNode: cm5.querySelector("textarea") || element,
      editor: cm5.CodeMirror || null,
    };
  }

  const cm6 = element.closest(".cm-editor");
  if (cm6) {
    return {
      kind: "cm6",
      root: cm6,
      focusNode: cm6.querySelector("textarea") || cm6.querySelector("[contenteditable='true']") || element,
      editor: findCm6(cm6),
    };
  }

  if (element instanceof HTMLTextAreaElement && !element.readOnly && !element.disabled) {
    return { kind: "textarea", root: element, focusNode: element, editor: null };
  }

  if (element instanceof HTMLInputElement && !element.disabled && !element.readOnly) {
    const allowed = new Set(["text", "search", "email", "url", "tel", ""]);
    if (!allowed.has(element.type)) return null;
    return { kind: "input", root: element, focusNode: element, editor: null };
  }

  const rich = element.closest("[contenteditable='true'], [contenteditable='']");
  if (rich instanceof HTMLElement) {
    return { kind: "contenteditable", root: rich, focusNode: rich, editor: null };
  }
  return null;
}

export function focusEditable(target) {
  if (!target) return;
  try {
    target.editor?.focus?.();
    target.focusNode?.focus?.();
  } catch {
    /* the field can disappear between focus and typing */
  }
}

export function snapshotEditable(target) {
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

export function suggestionsOpen(roots = []) {
  const scopes = [document];
  for (const root of roots) {
    if (root) scopes.push(root);
    if (root?.shadowRoot) scopes.push(root.shadowRoot);
  }
  const selectors = [
    ".suggest-widget.visible",
    ".ace_autocomplete",
    ".CodeMirror-hints",
    ".cm-tooltip-autocomplete",
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

export function caretFrom(node) {
  const path = node?.composedPath?.() || [];
  for (const entry of path) {
    const target = editableFrom(entry);
    if (target) return target;
  }
  return editableFrom(node?.target || node);
}
