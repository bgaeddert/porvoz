import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const mainSource = readFileSync(new URL("../electron/main.js", import.meta.url), "utf8");

function createHotkeyHarness() {
  const actions = [];
  const requests = [];
  const context = vm.createContext({
    UiohookKey: { Escape: 1 }, isCapturingHotkey: false, isHotkeyRecording: false,
    hotkeyIntentGeneration: 0, currentHotkey: { key: "ControlRight", modifiers: [] },
    pressedKeys: new Set(), MODIFIER_KEYCODES: {}, captureAttempts: new Map(),
    activeOperations: new Set(), rendererActivities: new Set(),
    suppressedHotkeyKeyCode: undefined, getUiohookKeyCode: () => 99,
    isSyntheticEscapeActive: () => false, isModifierPressed: () => true,
    createOperationCanceledError: () => new Error("Canceled by user."),
    setOverlayStatus: () => {}, notifyActivityCanceled: () => {},
    appService: {
      getSetupStatus: () => new Promise((resolve, reject) => requests.push({ resolve, reject }))
    },
    beginCaptureAttempt: () => ({ id: "capture" }),
    sendHotkeyAction: (action) => actions.push(action)
  });
  // Exercise the actual Electron handlers without starting Electron or hooks.
  vm.runInContext(mainSource.slice(mainSource.indexOf("async function handleGlobalKeyDown"),
    mainSource.indexOf("function isModifierPressed")), context);
  vm.runInContext(mainSource.slice(mainSource.indexOf("function cancelActiveActivity()"),
    mainSource.indexOf("function notifyActivityCanceled(")), context);
  return { context, actions, requests };
}

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
