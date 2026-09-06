import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { createHotkeyGesture } from "../electron/hotkey-gesture.js";

const mainSource = readFileSync(new URL("../electron/main.js", import.meta.url), "utf8");

function createHotkeyHarness({
  autoHold = true,
  deferSelection = false,
  platform = "win32",
  hotkey = { key: "ControlRight", modifiers: [] },
  actualModifierState = false
} = {}) {
  const actions = [];
  const timers = new Map();
  let now = 1000;
  let panelOpens = 0;
  const requests = [];
  const selectionRequests = [];
  const keycodes = { ControlLeft: 10, ControlRight: 99, MetaLeft: 20 };
  const context = vm.createContext({
    process: { platform },
    UiohookKey: { Escape: 1 }, isCapturingHotkey: false, isHotkeyRecording: false,
    hotkeyIntentGeneration: 0, currentHotkey: hotkey,
    pressedKeys: new Set(), MODIFIER_KEYCODES: { CTRL: [10, 99], ALT: [], SHIFT: [], META: [20] },
    MODIFIER_FOR_CODE: new Map([["ControlLeft", "CTRL"], ["ControlRight", "CTRL"], ["MetaLeft", "META"]]),
    SINGLE_MODIFIER_HOTKEY_CODES: new Set(["ControlLeft", "ControlRight"]), captureAttempts: new Map(),
    activeOperations: new Set(), rendererActivities: new Set(),
    suppressedHotkeyKeyCode: undefined, getUiohookKeyCode: (code) => keycodes[code],
    isSyntheticCopyActive: () => false, isSyntheticEscapeActive: () => false,
    isModifierPressed: () => true,
    createOperationCanceledError: () => new Error("Canceled by user."),
    setOverlayStatus: () => {}, notifyActivityCanceled: () => {},
    statusOverlay: { prepareForCapture() {}, dismiss() {}, openResponse() { panelOpens += 1; } },
    selectedTextReader: {
      read: (options) => deferSelection
        ? new Promise((resolve) => selectionRequests.push({ resolve, options }))
        : Promise.resolve("")
    },
    appService: {
      getSetupStatus: () => new Promise((resolve, reject) => requests.push({ resolve, reject }))
    },
    beginCaptureAttempt: () => {
      const attempt = { id: "capture", state: "recording", targetWindow: 456 };
      context.captureAttempts.set(attempt.id, attempt);
      return attempt;
    },
    sendHotkeyAction: (action) => actions.push(action)
  });
  if (actualModifierState) {
    context.isModifierPressed = (modifier, event = {}) => {
      const eventModifier = modifier === "CTRL"
        ? event.ctrlKey
        : modifier === "ALT"
          ? event.altKey
          : modifier === "SHIFT"
            ? event.shiftKey
            : event.metaKey;
      return context.MODIFIER_KEYCODES[modifier].some((keycode) => context.pressedKeys.has(keycode))
        || eventModifier;
    };
  }
  // Exercise the actual Electron handlers without starting Electron or hooks.
  vm.runInContext(mainSource.slice(mainSource.indexOf("async function handleGlobalKeyDown"),
    mainSource.indexOf("function isModifierPressed")), context);
  vm.runInContext(mainSource.slice(mainSource.indexOf("function cancelActiveActivity()"),
    mainSource.indexOf("function notifyActivityCanceled(")), context);
  context.hotkeyGesture = createHotkeyGesture({
    onHold: () => context.startHotkeyRecording(),
    onRelease: () => context.stopHotkeyRecording(),
    onDoubleTap: () => context.statusOverlay.openResponse(),
    now: () => now,
    schedule: (callback) => { const id = {}; timers.set(id, callback); return id; },
    unschedule: (id) => timers.delete(id)
  });
  const fireHold = () => {
    const callbacks = [...timers.values()];
    timers.clear();
    return Promise.all(callbacks.map((callback) => callback()));
  };
  const rawDown = context.handleGlobalKeyDown;
  if (autoHold) context.handleGlobalKeyDown = (event) => {
    const result = rawDown(event);
    return Promise.all([result, fireHold()]);
  };
  return { context, actions, requests, selectionRequests, fireHold,
    advance: (ms) => { now += ms; }, getPanelOpens: () => panelOpens };

}

function createHotkeyCaptureHarness() {
  const saved = [];
  const statuses = [];
  const context = vm.createContext({
    isCapturingHotkey: true,
    capturePressedCodes: new Set(), captureSeenCodes: new Set(),
    captureTriggerCode: undefined, captureTriggerModifiers: [],
    MODIFIER_CODES: new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"]),
    MODIFIER_FOR_CODE: new Map([
      ["ControlLeft", "CTRL"], ["ControlRight", "CTRL"], ["AltLeft", "ALT"], ["AltRight", "ALT"],
      ["ShiftLeft", "SHIFT"], ["ShiftRight", "SHIFT"], ["MetaLeft", "META"], ["MetaRight", "META"]
    ]),
    SINGLE_MODIFIER_HOTKEY_CODES: new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight"]),
    normalizeHotkey: (value) => ({ key: value.key, modifiers: value.modifiers, label: "" }),
    saveHotkey: (hotkey) => saved.push(hotkey),
    notifyHotkeyCaptureStatus: (state, message) => statuses.push({ state, message })
  });
  vm.runInContext(mainSource.slice(mainSource.indexOf("function handleSettingsHotkeyInput"),
    mainSource.indexOf("async function handleGlobalKeyDown")), context);
  return { context, saved, statuses };
}

test("hotkey capture saves Control plus Super as a modifier-only combination", () => {
  const { context, saved } = createHotkeyCaptureHarness();
  const input = (type, code) => context.handleSettingsHotkeyInput(
    { preventDefault() {} }, { type, code, isAutoRepeat: false }
  );

  input("keyDown", "ControlLeft");
  input("keyDown", "MetaLeft");
  input("keyUp", "MetaLeft");
  input("keyUp", "ControlLeft");

  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, "ControlLeft");
  assert.deepEqual([...saved[0].modifiers], ["META"]);
});

test("modifier-only hotkeys activate regardless of modifier press order", async () => {
  const { context, actions, requests } = createHotkeyHarness({
    hotkey: { key: "ControlLeft", modifiers: ["META"] },
    actualModifierState: true
  });
  const superDown = context.handleGlobalKeyDown({ keycode: 20, metaKey: true, ctrlKey: false });
  await superDown;
  const controlDown = context.handleGlobalKeyDown({ keycode: 10, metaKey: true, ctrlKey: true });
  assert.equal(requests.length, 1);
  requests[0].resolve({ ready: true });
  await controlDown;
  assert.deepEqual(actions, ["start"]);
  context.handleGlobalKeyUp({ keycode: 10 });
  assert.deepEqual(actions, ["start", "stop"]);
});

test("Windows captures selection after the recording hotkey is released", async () => {
  const { context, actions, requests, selectionRequests } = createHotkeyHarness({
    deferSelection: true
  });
  const pending = context.handleGlobalKeyDown({ keycode: 99 });
  requests[0].resolve({ ready: true });
  await new Promise((resolve) => setImmediate(resolve));

  await pending;
  assert.deepEqual(actions, ["start"]);
  assert.equal(selectionRequests.length, 0);
  context.handleGlobalKeyUp({ keycode: 99 });
  assert.equal(selectionRequests.length, 1);
  assert.equal(selectionRequests[0].options.target, 456);
  selectionRequests[0].resolve("selected text");
  assert.deepEqual(actions, ["start", "stop"]);
});

test("Windows Ctrl+Meta records without copying and schedules one capture on release", async () => {
  for (const releaseOrder of [[10, 20], [20, 10]]) {
    const { context, actions, requests, selectionRequests } = createHotkeyHarness({
      platform: "win32", deferSelection: true, actualModifierState: true,
      hotkey: { key: "ControlLeft", modifiers: ["META"] }
    });
    await context.handleGlobalKeyDown({ keycode: 10, ctrlKey: true });
    const start = context.handleGlobalKeyDown({ keycode: 20, ctrlKey: true, metaKey: true });
    requests[0].resolve({ ready: true });
    await start;
    assert.deepEqual(actions, ["start"]);
    assert.equal(selectionRequests.length, 0);
    for (const keycode of releaseOrder) context.handleGlobalKeyUp({ keycode });
    assert.equal(selectionRequests.length, 1);
    selectionRequests[0].resolve("selected text");
    assert.deepEqual(actions, ["start", "stop"]);
  }
});

test("Linux starts recording without copying and captures on hotkey release", async () => {
  const { context, requests, selectionRequests, actions } = createHotkeyHarness({
    platform: "linux", deferSelection: true
  });
  const pending = context.handleGlobalKeyDown({ keycode: 99 });
  assert.equal(selectionRequests.length, 0);
  requests[0].resolve({ ready: true });
  await pending;
  assert.deepEqual(actions, ["start"]);
  assert.equal(selectionRequests.length, 0);
  context.handleGlobalKeyUp({ keycode: 99 });
  assert.equal(selectionRequests.length, 1);
  assert.equal(selectionRequests[0].options.target, 456);
  selectionRequests[0].resolve("selected text");
  assert.deepEqual(actions, ["start", "stop"]);
});

test("releasing a hotkey during setup never starts a late recording", async () => {
  const { context, actions, requests } = createHotkeyHarness();
  const pending = context.handleGlobalKeyDown({ keycode: 99 });
  context.handleGlobalKeyUp({ keycode: 99 });
  requests[0].resolve({ ready: true });
  await pending;
  assert.deepEqual(actions, ["stop"]);
  assert.equal(context.isHotkeyRecording, false);
});

test("Escape cancels a pending setup check and suppresses its late failure", async () => {
  const { context, actions, requests } = createHotkeyHarness();
  const pending = context.handleGlobalKeyDown({ keycode: 99 });
  await context.handleGlobalKeyDown({ keycode: 1 });
  requests[0].reject(new Error("Disconnected"));
  await pending;
  assert.deepEqual(actions, []);
  assert.equal(context.isHotkeyRecording, false);
});

test("an earlier setup response cannot start or cancel a subsequent hotkey hold", async () => {
  for (const failEarlierRequest of [false, true]) {
    const { context, actions, requests } = createHotkeyHarness();
    const first = context.handleGlobalKeyDown({ keycode: 99 });
    context.handleGlobalKeyUp({ keycode: 99 });
    const second = context.handleGlobalKeyDown({ keycode: 99 });
    if (failEarlierRequest) requests[0].reject(new Error("Disconnected"));
    else requests[0].resolve({ ready: true });
    await first;
    assert.deepEqual(actions, ["stop"]);
    assert.equal(context.isHotkeyRecording, true);
    requests[1].resolve({ ready: true });
    await second;
    context.handleGlobalKeyUp({ keycode: 99 });
    assert.deepEqual(actions, ["stop", "start", "stop"]);
  }
});

test("short taps open the saved response without setup, audio or clipboard work on either OS", async () => {
  for (const platform of ["win32", "linux"]) {
    const { context, actions, requests, selectionRequests, advance, getPanelOpens, fireHold } =
      createHotkeyHarness({ autoHold: false, platform, deferSelection: true });
    for (let tap = 0; tap < 2; tap += 1) {
      await context.handleGlobalKeyDown({ keycode: 99 });
      advance(80);
      context.handleGlobalKeyUp({ keycode: 99 });
      advance(100);
    }
    await fireHold();
    assert.equal(getPanelOpens(), 1);
    assert.deepEqual(actions, []);
    assert.equal(requests.length, 0);
    assert.equal(selectionRequests.length, 0);
    assert.equal(context.captureAttempts.size, 0);
  }
});

test("Settings keeps backend recovery usable while runtime loading is pending or fails", async () => {
  const elements = new Map();
  const backendIds = new Set(["#backend-form", "#backend-mode", "#remote-backend-fields",
    "#remote-backend-url", "#remote-admin-key", "#backend-status", "#backend-submit"]);
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      value: "", disabled: false, dataset: {}, listeners: new Map(),
      addEventListener(type, handler) { this.listeners.set(type, handler); },
      closest: () => backendIds.has(selector) ? {} : null,
      querySelector: () => element("#backend-submit")
    });
    return elements.get(selector);
  };
  let rejectRuntime;
  let reloads = 0;
  let saved;
  const runtimeRequest = new Promise((_resolve, reject) => { rejectRuntime = reject; });
  const context = vm.createContext({
    Audio: class {},
    document: { querySelector: element, querySelectorAll: () => [...elements.values()] },
    window: {
      location: { reload: () => { reloads += 1; } },
      porvozDesktop: {
        isElectron: true,
        getRuntimeConfig: () => runtimeRequest,
        getBackendSettings: async () => ({ mode: "remote", connectedMode: "remote",
          remoteUrl: "https://unavailable.example", adminKeyConfigured: true }),
        saveBackendSettings: async (value) => { saved = value; }
      }
    }
  });
  const runtimeSource = readFileSync(new URL("../public/runtime-config.js", import.meta.url), "utf8")
    .replace("export async function", "async function");
  const settingsSource = readFileSync(new URL("../public/settings.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "");
  const initialization = vm.runInContext(`(async () => {\n${runtimeSource}\n${settingsSource}\n})()`, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof element("#backend-form").listeners.get("submit"), "function");
  assert.equal(element("#backend-mode").disabled, false);
  assert.equal(element("#base-url").disabled, true);
  rejectRuntime(new Error("Server disconnected"));
  await initialization;
  assert.match(element("#backend-status").textContent, /Choose Local/);
  assert.equal(element("#backend-status").dataset.state, "error");
  element("#backend-mode").value = "local";
  element("#backend-mode").listeners.get("change")();
  assert.equal(element("#remote-backend-fields").hidden, true);
  await element("#backend-form").listeners.get("submit")({ preventDefault() {} });
  assert.equal(saved.mode, "local");
  assert.equal(reloads, 1);
});
