import assert from "node:assert/strict";
import test from "node:test";
import { commandTarget, sameFrame, shouldReplaceLive, toggleAction } from "./control-logic.js";

test("pause and end follow the typing frame, then the last focused field", () => {
  const focus = { tabId: 4, frameId: 0 };
  const active = { tabId: 4, frameId: 2 };
  assert.deepEqual(commandTarget("start", focus, active), focus);
  assert.deepEqual(commandTarget("pause", focus, active), active);
  assert.deepEqual(commandTarget("stop", null, focus), focus);
  assert.equal(commandTarget("resume", null, null), null);
});

test("frame ids treat a missing frame as the top frame", () => {
  assert.equal(sameFrame({ tabId: 3 }, { tabId: 3, frameId: 0 }), true);
  assert.equal(sameFrame({ tabId: 3, frameId: 1 }, { tabId: 3, frameId: 0 }), false);
});

test("an idle dashboard tick does not wipe an in-progress typing status", () => {
  assert.equal(shouldReplaceLive(false, { tabId: 1, frameId: 0 }, "idle"), false);
  assert.equal(shouldReplaceLive(true, { tabId: 1, frameId: 0 }, "typing"), true);
  assert.equal(shouldReplaceLive(false, null, "typing"), true);
  assert.equal(shouldReplaceLive(false, null, "idle"), false);
});

test("the hotkey starts, pauses, and resumes", () => {
  assert.equal(toggleAction("idle"), "start");
  assert.equal(toggleAction("typing"), "pause");
  assert.equal(toggleAction("paused"), "resume");
  assert.equal(toggleAction("stopping"), "start");
});
