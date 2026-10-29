import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadBridge() {
  const listeners = [];
  const sent = [];
  class Element {}
  class HTMLTextAreaElement extends Element {}
  class HTMLInputElement extends Element {}
  const root = {
    closest() {
      return null;
    },
    contains(node) {
      return node === root;
    },
  };
  const field = new HTMLTextAreaElement();
  field.value = "hi";
  field.selectionStart = 2;
  field.selectionEnd = 2;
  field.closest = (selector) => (selector === ".monaco-editor" ? root : null);
  const model = {
    line: "hi",
    getLineContent() {
      return this.line;
    },
    getOffsetAt(position) {
      return position.column - 1;
    },
    getPositionAt(offset) {
      return { lineNumber: 1, column: offset + 1 };
    },
    getValueLength() {
      return this.line.length;
    },
    getOptions() {
      return { tabSize: 4, insertSpaces: true };
    },
  };
  const editor = {
    position: { lineNumber: 1, column: 3 },
    edits: 0,
    focus() {},
    getModel() {
      return model;
    },
    getPosition() {
      return this.position;
    },
    getDomNode() {
      return root;
    },
    trigger(_source, id, payload) {
      if (id !== "type") return;
      const column = this.position.column - 1;
      model.line = model.line.slice(0, column) + payload.text + model.line.slice(column);
      this.position = { lineNumber: 1, column: column + payload.text.length + 1 };
    },
    executeEdits() {
      this.edits += 1;
    },
    setPosition(position) {
      this.position = position;
    },
    getContribution() {
      return null;
    },
  };
  const document = {
    documentElement: { dataset: {} },
    activeElement: field,
    addEventListener() {},
    execCommand(command, _show, text) {
      if (command !== "insertText") return false;
      const start = field.selectionStart;
      field.value = field.value.slice(0, start) + text + field.value.slice(field.selectionEnd);
      field.selectionStart = field.selectionEnd = start + String(text).length;
      return true;
    },
  };
  const sandbox = {
    Element,
    HTMLTextAreaElement,
    HTMLInputElement,
    document,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    KeyboardEvent: class {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = {
    addEventListener(_type, handler) {
      listeners.push(handler);
    },
    postMessage(data) {
      sent.push(data);
    },
  };
  sandbox.monaco = { editor: { getEditors: () => [editor] } };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL("./page-bridge.js", import.meta.url), "utf8"), sandbox);
  return {
    listeners,
    sent,
    model,
    editor,
    field,
    document,
    send(data) {
      sent.length = 0;
      for (const handler of listeners) handler({ source: sandbox.window, data });
      return sent[0];
    },
  };
}

test("monaco typing uses the editor and does not fall back to a second insert", () => {
  const bridge = loadBridge();
  const result = bridge.send({ source: "snippet-desk", id: 1, op: "char", text: "!" });
  assert.equal(result.ok, true);
  assert.equal(result.snap.line, "hi!");
  assert.equal(result.snap.col, 3);
  assert.equal(bridge.editor.edits, 0);
  assert.equal(bridge.document.documentElement.dataset.snippetDesk, undefined);
});

test("a ping does not change the page", () => {
  const bridge = loadBridge();
  const result = bridge.send({ source: "snippet-desk", id: 4, op: "ping" });
  assert.equal(result.ok, true);
  assert.equal(result.snap, null);
  assert.equal(bridge.model.line, "hi");
  assert.equal(bridge.document.documentElement.dataset.snippetDesk, undefined);
});

test("a plain field receives insertText when no code editor is attached", () => {
  const bridge = loadBridge();
  bridge.field.closest = () => null;
  bridge.field.value = "ab";
  bridge.field.selectionStart = 2;
  bridge.field.selectionEnd = 2;
  const result = bridge.send({ source: "snippet-desk", id: 2, op: "char", text: "c" });
  assert.equal(result.ok, true);
  assert.equal(bridge.field.value, "abc");
  assert.equal(result.snap.kind, "textarea");
  assert.equal(result.snap.line, "abc");
  assert.equal(result.snap.col, 3);
});

test("bridge ignores anything that is not a typing request", () => {
  const bridge = loadBridge();
  const result = bridge.send({ source: "snippet-desk-result", id: 3, op: "char", text: "z" });
  assert.equal(result, undefined);
  assert.equal(bridge.model.line, "hi");
});
