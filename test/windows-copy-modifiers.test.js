import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { throwIfAborted } from "../electron/operation-cancellation.js";

const source = readFileSync(new URL("../electron/text-input.js", import.meta.url), "utf8");
const factory = source.slice(source.indexOf("function createWindowsTextInput()"),
  source.indexOf("function createLinuxTextInput()"));

function fixture({ held = [], onWait = () => {} } = {}) {
  const keys = new Set(held), sent = [];
  let foreground = 100, polls = 0;
  const native = {
    GetForegroundWindow: () => foreground,
    SetForegroundWindow: () => 1,
    GetAncestor: window => window,
    GetWindowThreadProcessId: (_window, pid) => { pid[0] = 999; return 1; },
    GetAsyncKeyState: key => keys.has(key) ? 0x8000 : 0,
    SendInput: (count, inputs) => { sent.push(...inputs); return count; }
  };
  const koffi = {
    struct: name => name, union: () => ({}), sizeof: () => 40,
    load: () => ({ func: signature => {
      const name = Object.keys(native).find(name => signature.includes(`${name}(`));
      assert.ok(name, signature);
      return native[name];
    } })
  };
  const input = vm.runInNewContext(`(${factory})()`, {
    koffi, process: { pid: 123 }, INPUT_KEYBOARD: 1, KEYEVENTF_KEYUP: 2,
    WINDOWS_INPUT_EXTRA_INFO: 0x5056, MAX_MODIFIER_RELEASE_CHECKS: 32,
    MAX_MODIFIER_RELEASE_CHECKS_AFTER_NORMALIZATION: 8,
    MODIFIER_POLL_INTERVAL_MS: 25, TEXT_TARGET_FOCUS_DELAY_MS: 100,
    WINDOWS_KEY_CODES: new Map(), throwIfAborted,
    wait: async () => { onWait({ keys, sent, poll: ++polls }); }
  });
  return { input, sent, keys, focus: value => { foreground = value; } };
}

test("Windows copy waits for both Ctrl and Meta, then sends plain Ctrl+C", async () => {
  const { input, sent } = fixture({
    held: [0x11, 0x5b],
    onWait({ keys, sent, poll }) {
      assert.equal(sent.length, 0, "No copy or synthetic modifier release while hotkey is held");
      if (poll === 1) keys.delete(0x11);
      if (poll === 2) keys.delete(0x5b);
    }
  });
  await input.prepareCopy(100);
  input.sendCopy({ target: 100 });
  assert.deepEqual(sent.map(event => [event.u.ki.wVk, event.u.ki.dwFlags]),
    [[0x11, 0], [0x43, 0], [0x43, 2], [0x11, 2]]);
});

test("Windows copy does not release a modifier that remains physically held", async () => {
  const { input, sent, keys } = fixture({ held: [0x12, 0x10, 0x5c] });
  await assert.rejects(input.prepareCopy(100), /Release the keyboard modifiers/);
  assert.equal(sent.length, 0);
  assert.equal(keys.size, 3);
});

test("Windows copy rechecks focus and modifiers after clipboard snapshotting", async () => {
  for (const change of [state => state.keys.add(0x5b), state => state.focus(200)]) {
    const state = fixture();
    await state.input.prepareCopy(100);
    change(state);
    assert.throws(() => state.input.sendCopy({ target: 100 }), /changed before selection capture/);
    assert.equal(state.sent.length, 0);
  }
});
