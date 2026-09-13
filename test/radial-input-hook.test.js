import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../electron/radial-input-hook.js", import.meta.url), "utf8");
const factorySource = source.slice(
  source.indexOf("export function createRadialInputHook"),
  source.length
).replace("export function createRadialInputHook", "function createRadialInputHook");

function createHarness(options = {}) {
  let callback;
  const koffi = {
    load(name) {
      return {
        func(signature) {
          if (signature.includes("SetWindowsHookExW")) return () => ({});
          if (signature.includes("UnhookWindowsHookEx")) return () => 1;
          if (signature.includes("CallNextHookEx")) return () => 0;
          if (signature.includes("GetModuleHandleW")) return () => ({});
          throw new Error(`Unexpected native function for ${name}: ${signature}`);
        }
      };
    },
    struct: (name) => name,
    proto: (signature) => signature,
    pointer: (value) => value,
    register(value) { callback = value; return value; },
    unregister() {},
    decode: (value) => value
  };
  const context = vm.createContext({
    koffi,
    process: { platform: "win32" },
    console,
    structuredClone,
    setImmediate,
    HOOK_KEYBOARD_LL: 13,
    HOOK_MOUSE_LL: 14,
    WM_KEYDOWN: 0x0100,
    WM_KEYUP: 0x0101,
    WM_SYSKEYDOWN: 0x0104,
    WM_SYSKEYUP: 0x0105,
    WM_LBUTTONDOWN: 0x0201,
    WM_LBUTTONUP: 0x0202,
    WM_RBUTTONDOWN: 0x0204,
    WM_RBUTTONUP: 0x0205,
    WM_MBUTTONDOWN: 0x0207,
    WM_MBUTTONUP: 0x0208,
    WM_XBUTTONDOWN: 0x020b,
    WM_XBUTTONUP: 0x020c,
    LLKHF_INJECTED: 0x10,
    LLMHF_INJECTED: 0x01,
    VK_BY_CODE: new Map([
      ["ControlLeft", 0xa2], ["MetaLeft", 0x5b], ["KeyR", 0x52]
    ]),
    MODIFIER_FOR_VK: new Map([
      [0xa2, "CTRL"], [0x5b, "META"]
    ]),
    MOUSE_MESSAGE_BUTTONS: new Map([
      [0x0201, { button: 1, pressed: true }],
      [0x0202, { button: 1, pressed: false }]
    ]),
    hookInstanceId: 0
  });
  vm.runInContext(factorySource, context);
  const hook = context.createRadialInputHook(options);
  return {
    hook,
    dispatch(message, event) { return callback(0, message, event); }
  };
}

test("the Windows radial hook consumes key-up only when it consumed key-down", () => {
  const { hook, dispatch } = createHarness();
  hook.setTrigger({ kind: "keyboard", code: "KeyR", modifiers: ["CTRL"] });
  hook.start();

  assert.equal(dispatch(0x0100, { vkCode: 0xa2, flags: 0 }), 0, "Ctrl down reaches the target");
  assert.equal(dispatch(0x0100, { vkCode: 0x52, flags: 0 }), 1, "R down is the trigger");
  assert.equal(dispatch(0x0101, { vkCode: 0xa2, flags: 0 }), 0, "Ctrl up matches its passed down");
  assert.equal(dispatch(0x0101, { vkCode: 0x52, flags: 0 }), 1, "R up matches its consumed down");
  hook.stop();
});

test("the Windows hook passes a standalone Meta key through", async () => {
  const events = [];
  const { hook, dispatch } = createHarness({
    onPress: (event) => events.push(["press", event]),
    onRelease: (event) => events.push(["release", event])
  });
  hook.setTrigger({ kind: "keyboard", code: "ControlLeft", modifiers: ["META"] });
  hook.start();

  assert.equal(dispatch(0x0100, { vkCode: 0x5b, flags: 0 }), 0, "Meta down reaches the target");
  assert.equal(dispatch(0x0101, { vkCode: 0x5b, flags: 0 }), 0, "Meta up reaches the target");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [], "A standalone Meta press does not activate the hotkey");

  hook.stop();
});

test("the Windows hook still consumes a matching Control plus Meta chord", async () => {
  const events = [];
  const { hook, dispatch } = createHarness({
    onPress: (event) => events.push(["press", event]),
    onRelease: (event) => events.push(["release", event])
  });
  hook.setTrigger({ kind: "keyboard", code: "ControlLeft", modifiers: ["META"] });
  hook.start();

  assert.equal(dispatch(0x0100, { vkCode: 0x5b, flags: 0 }), 0, "Meta down is not preemptively consumed");
  assert.equal(dispatch(0x0100, { vkCode: 0xa2, flags: 0 }), 1, "Control down is the matching trigger");
  assert.equal(dispatch(0x0101, { vkCode: 0xa2, flags: 0 }), 1, "Control up is consumed");
  assert.equal(dispatch(0x0101, { vkCode: 0x5b, flags: 0 }), 0, "Meta up matches its passed-down event");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events[0]?.[0], "press", "The matching chord activates the hotkey");

  hook.stop();
});

test("native mouse capture reports buttons while leaving the Cancel click usable", async () => {
  const mouseEvents = [];
  const { hook, dispatch } = createHarness();
  hook.setCaptureHandler({ onMouseEvent: (event) => mouseEvents.push(event) });
  hook.start();

  assert.equal(dispatch(0x0201, { mouseData: 0, flags: 0 }), 0);
  assert.equal(dispatch(0x0202, { mouseData: 0, flags: 0 }), 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(mouseEvents.map((event) => ({ ...event })), [
    { type: "mouseDown", button: 1 },
    { type: "mouseUp", button: 1 }
  ]);
  hook.stop();
});
