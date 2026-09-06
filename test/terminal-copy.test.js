import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { isTerminalWindow } from "../electron/terminal-detection.js";
import { throwIfAborted } from "../electron/operation-cancellation.js";

test("terminal matching accepts class, instance, and executable identities without substring collisions", () => {
  for (const value of ["St", "org.gnome.Terminal", "com.mitchellh.ghostty", "org.kde.konsole", "WindowsTerminal.exe"]) {
    assert.equal(isTerminalWindow({ windowClasses: [value] }), true, value);
  }
  assert.equal(isTerminalWindow({ executable: "C:\\Apps\\Tabby.exe" }), true);
  assert.equal(isTerminalWindow({ windowClasses: ["custom-instance", "XTerm"] }), true);
  for (const value of ["Notepad", "Code", "Cursor", "Chrome_WidgetWin_1", "studio", "footnotes", "terminal-notes", ""]) {
    assert.equal(isTerminalWindow({ windowClasses: [value] }), false, value);
  }
});

const source = readFileSync(new URL("../electron/text-input.js", import.meta.url), "utf8");
const factory = source.slice(source.indexOf("function createLinuxTextInput()"),
  source.indexOf("function createUnsupportedTextInput()"));

function linuxFixture(windowClasses, { changeFocusDuringLookup = false } = {}) {
  const sent = [];
  const delays = [];
  const names = new Map(), reverse = new Map();
  let active = 100;
  const native = {
    XOpenDisplay: () => 1, XCloseDisplay: () => 0, XFlush: () => 0,
    XQueryKeymap: () => 0,
    XStringToKeysym: name => {
      if (!names.has(name)) { names.set(name, names.size + 1); reverse.set(names.get(name), name); }
      return names.get(name);
    },
    XKeysymToKeycode: (_display, symbol) => symbol,
    XTestFakeKeyEvent: (_display, keycode, pressed, delay) => {
      sent.push([reverse.get(keycode), pressed]); delays.push(delay); return 1;
    }
  };
  const input = vm.runInNewContext(`(${factory})()`, {
    koffi: { load: () => ({ func: signature => {
      const name = Object.keys(native).find(name => signature.includes(`${name}(`));
      assert.ok(name, signature);
      return native[name];
    } }) },
    getX11: () => ({
      activeWindow: () => active,
      windowClasses: () => { if (changeFocusDuringLookup) active = 200; return windowClasses; }
    }),
    Buffer, isTerminalWindow, throwIfAborted, wait: async () => {},
    MAX_MODIFIER_RELEASE_CHECKS: 32, MODIFIER_POLL_INTERVAL_MS: 25, TEXT_TARGET_FOCUS_DELAY_MS: 100
  });
  return { input, sent, delays };
}

test("Linux copy uses Ctrl+Shift+C for terminals and plain Ctrl+C for editors", async () => {
  for (const [classes, terminal] of [[["custom", "Gnome-terminal"], true], [["ghostty", "com.mitchellh.ghostty"], true], [["gedit", "Gedit"], false]]) {
    const { input, sent } = linuxFixture(classes);
    await input.prepareCopy(100);
    input.sendCopy({ target: 100, consoleSelectionEnabled: true });
    assert.deepEqual(sent, [
      ["Control_L", 1], ...(terminal ? [["Shift_L", 1]] : []),
      ["c", 1], ["c", 0], ...(terminal ? [["Shift_L", 0]] : []), ["Control_L", 0]
    ]);
  }
});

test("Linux does not copy into a window that gained focus during terminal detection", () => {
  const { input, sent } = linuxFixture(["XTerm"], { changeFocusDuringLookup: true });
  assert.throws(() => input.sendCopy({ target: 100, consoleSelectionEnabled: true }), /lost focus/);
  assert.equal(sent.length, 0);
});

test("Linux paste uses Ctrl+Shift+V in terminals and Ctrl+V in editors regardless of console selection", async () => {
  for (const [classes, terminal] of [[["XTerm"], true], [["com.mitchellh.ghostty"], true], [["Gnome-terminal"], true], [["Gedit"], false]]) {
    const { input, sent } = linuxFixture(classes);
    await input.prepareCopy(100);
    input.sendCopy({ target: 100 }); // Default-off console selection must not disable paste.
    sent.length = 0;
    await input.prepareTarget(100);
    input.sendPaste();
    assert.deepEqual(sent, [["Control_L", 1], ...(terminal ? [["Shift_L", 1]] : []),
      ["v", 1], ["v", 0], ...(terminal ? [["Shift_L", 0]] : []), ["Control_L", 0]]);
  }
});

test("Linux paste aborts if focus changes during terminal detection", async () => {
  const { input, sent } = linuxFixture(["XTerm"], { changeFocusDuringLookup: true });
  await input.prepareTarget(100);
  assert.throws(() => input.sendPaste(), /lost focus/);
  assert.equal(sent.length, 0);
});

test("Linux terminal shortcuts pace modifier and letter events at the X server", async () => {
  for (const classes of [["com.mitchellh.ghostty"], ["Gnome-terminal"], ["Gedit"]]) {
    const { input, delays } = linuxFixture(classes);
    const terminal = isTerminalWindow({ windowClasses: classes });
    await input.prepareTarget(100);
    input.sendPaste();
    assert.deepEqual(delays, Array(terminal ? 6 : 4).fill(terminal ? 25 : 0));
    delays.length = 0;
    input.sendCopy({ target: 100, consoleSelectionEnabled: true });
    assert.deepEqual(delays, Array(terminal ? 6 : 4).fill(terminal ? 25 : 0));
  }
});

test("an empty terminal copy is attempted only once and returns no selected context", async () => {
  const { input, sent } = linuxFixture(["XTerm"]);
  const reader = source.slice(source.indexOf("export async function readSelectedTextFromClipboard"),
    source.indexOf("export async function typeText")).replace("export ", "");
  const capture = vm.runInNewContext(`(${reader})`, {
    textInputForPlatform: input, syntheticCopySuppressedUntil: 0,
    clipboardTextTransaction: { readSelectedText: async copy => { await copy(); return ""; } }
  });
  assert.equal(await capture({ target: 100, consoleSelectionEnabled: true }), "");
  assert.deepEqual(sent, [["Control_L", 1], ["Shift_L", 1], ["c", 1], ["c", 0], ["Shift_L", 0], ["Control_L", 0]]);
});

test("console selection off skips the clipboard only for recognized terminals", async () => {
  const reader = source.slice(source.indexOf("export async function readSelectedTextFromClipboard"),
    source.indexOf("export async function typeText")).replace("export ", "");
  for (const enabled of [undefined, false, true]) {
    for (const [classes, terminal] of [[["XTerm"], true], [["Gedit"], false], [["Code"], false]]) {
      const { input, sent } = linuxFixture(classes);
      let clipboardTransactions = 0;
      const capture = vm.runInNewContext(`(${reader})`, {
        textInputForPlatform: input, syntheticCopySuppressedUntil: 0,
        clipboardTextTransaction: { readSelectedText: async copy => {
          clipboardTransactions += 1; await copy(); return "selected fixture";
        } }
      });
      const skipped = terminal && enabled !== true;
      assert.equal(await capture({ target: 100, consoleSelectionEnabled: enabled }), skipped ? "" : "selected fixture");
      assert.equal(clipboardTransactions, skipped ? 0 : 1);
      assert.equal(sent.length, skipped ? 0 : terminal ? 6 : 4);
    }
  }
});

test("Linux input boundary does not copy from terminals with console selection off", () => {
  const { input, sent } = linuxFixture(["XTerm"]);
  input.sendCopy({ target: 100 });
  assert.equal(sent.length, 0);
});
