import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { throwIfAborted } from "../electron/operation-cancellation.js";
import { isTerminalWindow } from "../electron/terminal-detection.js";

const source = readFileSync(new URL("../electron/text-input.js", import.meta.url), "utf8");
const factory = source.slice(source.indexOf("function createWindowsTextInput()"),
  source.indexOf("function createLinuxTextInput()"));

function fixture({ held = [], onWait = () => {}, windowClass = "Notepad", executable = "C:\\Windows\\notepad.exe", processAccess = true } = {}) {
  const keys = new Set(held), sent = [];
  let foreground = 100, polls = 0;
  const native = {
    GetClassNameW: (_window, buffer) => { buffer.write(windowClass, "utf16le"); return windowClass.length; },
    OpenProcess: () => processAccess ? 55 : null,
    QueryFullProcessImageNameW: (_process, _flags, buffer, size) => {
      buffer.write(executable, "utf16le"); size[0] = executable.length; return 1;
    },
    CloseHandle: () => 1,
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
    koffi, Buffer, isTerminalWindow, process: { pid: 123 }, INPUT_KEYBOARD: 1, KEYEVENTF_KEYUP: 2,
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

test("Windows terminals receive one Ctrl+Shift+C by window class or executable", async () => {
  for (const identity of [
    { windowClass: "CASCADIA_HOSTING_WINDOW_CLASS", processAccess: false },
    { windowClass: "ConsoleWindowClass" },
    { windowClass: "Chrome_WidgetWin_1", executable: "C:\\Users\\café\\Tabby.exe" }
  ]) {
    const { input, sent } = fixture(identity);
    await input.prepareCopy(100);
    input.sendCopy({ target: 100, consoleSelectionEnabled: true });
    assert.deepEqual(sent.map(event => [event.u.ki.wVk, event.u.ki.dwFlags]),
      [[0x11, 0], [0x10, 0], [0x43, 0], [0x43, 2], [0x10, 2], [0x11, 2]]);
  }
});

test("terminal copy retains held-modifier and focus guards", async () => {
  const state = fixture({ windowClass: "ConsoleWindowClass", held: [0x5b] });
  assert.throws(() => state.input.sendCopy({ target: 100, consoleSelectionEnabled: true }), /changed before selection capture/);
  state.keys.clear();
  state.focus(200);
  assert.throws(() => state.input.sendCopy({ target: 100, consoleSelectionEnabled: true }), /changed before selection capture/);
  assert.equal(state.sent.length, 0);
});

test("Windows paste remains Ctrl+V in terminals", () => {
  const { input, sent } = fixture({ windowClass: "ConsoleWindowClass" });
  input.sendPaste();
  assert.deepEqual(sent.map(event => [event.u.ki.wVk, event.u.ki.dwFlags]),
    [[0x11, 0], [0x56, 0], [0x56, 2], [0x11, 2]]);
});

test("console selection defaults off at the Windows input boundary", () => {
  for (const windowClass of ["CASCADIA_HOSTING_WINDOW_CLASS", "PseudoConsoleWindow"]) {
    const { input, sent } = fixture({ windowClass });
    assert.equal(input.isTerminalTarget(100), true);
    input.sendCopy({ target: 100 });
    assert.equal(sent.length, 0);
    input.sendPaste();
    assert.equal(sent.length, 4, "dictation paste remains available");
  }
});
