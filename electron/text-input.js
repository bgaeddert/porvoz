import { ClipboardItem, clipboard } from "electron";
import koffi from "koffi";
import { parseTextCommands } from "./text-command-parser.js";
import { createClipboardTextTransaction } from "./clipboard-text-transaction.js";
import { abortableDelay, throwIfAborted } from "./operation-cancellation.js";
import { getX11 } from "./linux-x11.js";
import { isTerminalWindow } from "./terminal-detection.js";

const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const MOUSEEVENTF_XDOWN = 0x0080;
const MOUSEEVENTF_XUP = 0x0100;
const WINDOWS_INPUT_EXTRA_INFO = 0x5056;
const TEXT_TARGET_FOCUS_DELAY_MS = 100;
const MODIFIER_POLL_INTERVAL_MS = 25;
const MAX_MODIFIER_RELEASE_CHECKS = 32;
const MAX_MODIFIER_RELEASE_CHECKS_AFTER_NORMALIZATION = 8;
const WINDOWS_KEY_CODES = new Map([
  ["Control", 0x11],
  ["Alt", 0x12],
  ["Shift", 0x10],
  ["Meta", 0x5b],
  ["Enter", 0x0d],
  ["Escape", 0x1b],
  ["Tab", 0x09],
  ["Space", 0x20],
  ["Backspace", 0x08],
  ["Delete", 0x2e],
  ["Insert", 0x2d],
  ["Home", 0x24],
  ["End", 0x23],
  ["PageUp", 0x21],
  ["PageDown", 0x22],
  ["ArrowUp", 0x26],
  ["ArrowDown", 0x28],
  ["ArrowLeft", 0x25],
  ["ArrowRight", 0x27],
  ["CapsLock", 0x14],
  ["NumLock", 0x90],
  ["ScrollLock", 0x91],
  ["PrintScreen", 0x2c],
  ["Pause", 0x13],
  ["ContextMenu", 0x5d],
  [";", 0xba],
  ["=", 0xbb],
  [",", 0xbc],
  ["-", 0xbd],
  [".", 0xbe],
  ["/", 0xbf],
  ["`", 0xc0],
  ["[", 0xdb],
  ["\\", 0xdc],
  ["]", 0xdd],
  ["'", 0xde],
  ["Numpad0", 0x60],
  ["Numpad1", 0x61],
  ["Numpad2", 0x62],
  ["Numpad3", 0x63],
  ["Numpad4", 0x64],
  ["Numpad5", 0x65],
  ["Numpad6", 0x66],
  ["Numpad7", 0x67],
  ["Numpad8", 0x68],
  ["Numpad9", 0x69],
  ["NumpadMultiply", 0x6a],
  ["NumpadAdd", 0x6b],
  ["NumpadSubtract", 0x6d],
  ["NumpadDecimal", 0x6e],
  ["NumpadDivide", 0x6f],
  ["NumpadEnter", 0x0d],
  ["NumpadEnd", 0x23], ["NumpadArrowDown", 0x28], ["NumpadPageDown", 0x22],
  ["NumpadArrowLeft", 0x25], ["NumpadArrowRight", 0x27], ["NumpadHome", 0x24],
  ["NumpadArrowUp", 0x26], ["NumpadPageUp", 0x21], ["NumpadInsert", 0x2d],
  ["NumpadDelete", 0x2e]
]);
for (let functionNumber = 1; functionNumber <= 24; functionNumber += 1) {
  WINDOWS_KEY_CODES.set(`F${functionNumber}`, 0x70 + functionNumber - 1);
}
const X11_KEY_NAMES = new Map([
  ["Control", "Control_L"],
  ["Alt", "Alt_L"],
  ["Shift", "Shift_L"],
  ["Meta", "Super_L"],
  ["Enter", "Return"],
  ["Escape", "Escape"],
  ["Tab", "Tab"],
  ["Space", "space"],
  ["Backspace", "BackSpace"],
  ["Delete", "Delete"],
  ["Insert", "Insert"],
  ["PageUp", "Page_Up"],
  ["PageDown", "Page_Down"],
  ["ArrowUp", "Up"],
  ["ArrowDown", "Down"],
  ["ArrowLeft", "Left"],
  ["ArrowRight", "Right"],
  ["CapsLock", "Caps_Lock"],
  ["NumLock", "Num_Lock"],
  ["ScrollLock", "Scroll_Lock"],
  ["PrintScreen", "Print"],
  ["ContextMenu", "Menu"],
  [";", "semicolon"],
  ["=", "equal"],
  [",", "comma"],
  ["-", "minus"],
  [".", "period"],
  ["/", "slash"],
  ["`", "grave"],
  ["[", "bracketleft"],
  ["\\", "backslash"],
  ["]", "bracketright"],
  ["'", "apostrophe"]
]);

let textInputForPlatform;
let syntheticEscapeSuppressedUntil = 0;
let syntheticCopySuppressedUntil = 0;
let syntheticRadialInputSuppressedUntil = 0;

if (process.platform === "win32") {
  textInputForPlatform = createWindowsTextInput();
} else if (process.platform === "linux") {
  textInputForPlatform = createLinuxTextInput();
} else {
  textInputForPlatform = createUnsupportedTextInput();
}

const clipboardTextTransaction = createClipboardTextTransaction({
  clipboard,
  ClipboardItem
});

export function captureTextInputTarget() {
  return textInputForPlatform.captureTarget();
}

export function disposeTextInput() {
  textInputForPlatform.dispose();
}

export function isSyntheticEscapeActive() {
  return Date.now() < syntheticEscapeSuppressedUntil;
}

export function isSyntheticCopyActive() {
  return Date.now() < syntheticCopySuppressedUntil;
}

export function isSyntheticRadialInputActive() {
  return Date.now() < syntheticRadialInputSuppressedUntil;
}

export async function readSelectedTextFromClipboard({
  signal,
  target,
  consoleSelectionEnabled = false
} = {}) {
  await textInputForPlatform.prepareCopy(target, signal);
  if (!consoleSelectionEnabled && textInputForPlatform.isTerminalTarget(target)) return "";
  return clipboardTextTransaction.readSelectedText(
    () => {
      syntheticCopySuppressedUntil = Math.max(syntheticCopySuppressedUntil, Date.now() + 250);
      return textInputForPlatform.sendCopy({ target, consoleSelectionEnabled });
    },
    { signal }
  );
}

export async function typeText(text, { target = null, signal } = {}) {
  if (typeof text !== "string" || !text) return;
  throwIfAborted(signal);
  await textInputForPlatform.prepareTarget(target, signal);
  throwIfAborted(signal);

  for (const command of parseTextCommands(text)) {
    throwIfAborted(signal);
    if (command.type === "key") {
      await textInputForPlatform.pressKeyCombination(command.keys, signal);
    } else if (command.value) {
      await clipboardTextTransaction.pasteText(
        command.value,
        () => textInputForPlatform.sendPaste(),
        { signal }
      );
    }
  }
}

export async function sendRadialAction(action, { target = null, signal } = {}) {
  if (!action || typeof action !== "object") return false;
  await textInputForPlatform.prepareTarget(target, signal);
  throwIfAborted(signal);
  if (action.type === "hotkey" && Array.isArray(action.keys) && action.keys.length) {
    suppressSyntheticRadialInput();
    await textInputForPlatform.pressKeyCombination(action.keys, signal);
    return true;
  }
  if (action.type === "navigation" && ["back", "forward"].includes(action.command)) {
    suppressSyntheticRadialInput();
    await textInputForPlatform.sendNavigation(action.command, signal);
    return true;
  }
  return false;
}

function createWindowsTextInput() {
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const GetClassNameW = user32.func(
    "int __stdcall GetClassNameW(void *hWnd, _Out_ uint16_t *lpClassName, int nMaxCount)"
  );
  const OpenProcess = kernel32.func(
    "void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t processId)"
  );
  const QueryFullProcessImageNameW = kernel32.func(
    "int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)"
  );
  const CloseHandle = kernel32.func("int __stdcall CloseHandle(void *handle)");
  const MOUSEINPUT = koffi.struct("PorvozMouseInput", {
    dx: "long",
    dy: "long",
    mouseData: "uint32_t",
    dwFlags: "uint32_t",
    time: "uint32_t",
    dwExtraInfo: "uintptr_t"
  });
  const KEYBDINPUT = koffi.struct("PorvozKeyboardInput", {
    wVk: "uint16_t",
    wScan: "uint16_t",
    dwFlags: "uint32_t",
    time: "uint32_t",
    dwExtraInfo: "uintptr_t"
  });
  const HARDWAREINPUT = koffi.struct("PorvozHardwareInput", {
    uMsg: "uint32_t",
    wParamL: "uint16_t",
    wParamH: "uint16_t"
  });
  const INPUT = koffi.struct("PorvozInput", {
    type: "uint32_t",
    u: koffi.union({
      mi: MOUSEINPUT,
      ki: KEYBDINPUT,
      hi: HARDWAREINPUT
    })
  });

  const GetForegroundWindow = user32.func(
    "void * __stdcall GetForegroundWindow()"
  );
  const SetForegroundWindow = user32.func(
    "int __stdcall SetForegroundWindow(void *hWnd)"
  );
  const GetAncestor = user32.func(
    "void * __stdcall GetAncestor(void *hWnd, uint32_t gaFlags)"
  );
  const GetWindowThreadProcessId = user32.func(
    "uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)"
  );
  const GetAsyncKeyState = user32.func(
    "int16_t __stdcall GetAsyncKeyState(int32_t vKey)"
  );
  const SendInput = user32.func(
    "unsigned int __stdcall SendInput(unsigned int cInputs, PorvozInput *pInputs, int cbSize)"
  );

  const ModifierKeys = [
    0x10, // VK_SHIFT
    0xa0, // VK_LSHIFT
    0xa1, // VK_RSHIFT
    0x11, // VK_CONTROL
    0xa2, // VK_LCONTROL
    0xa3, // VK_RCONTROL
    0x12, // VK_MENU
    0xa4, // VK_LMENU
    0xa5, // VK_RMENU
    0x5b, // VK_LWIN
    0x5c // VK_RWIN
  ];
  const ModifierReleaseKeys = [
    0xa0,
    0xa1,
    0x10,
    0xa2,
    0xa3,
    0x11,
    0xa4,
    0xa5,
    0x12,
    0x5b,
    0x5c
  ];

  return {
    captureTarget() {
      const foregroundWindow = GetForegroundWindow();
      if (!foregroundWindow) return null;
      const processId = [0];
      if (!GetWindowThreadProcessId(foregroundWindow, processId)) return null;
      return processId[0] === process.pid ? null : foregroundWindow;
    },
    async prepareCopy(target, signal) {
      // Copy only after the user's full hotkey chord is released. In particular,
      // Ctrl+Meta recording must never inject Ctrl+Meta+C into the editor.
      if (!await pollModifierRelease(MAX_MODIFIER_RELEASE_CHECKS, signal)) {
        throw new Error("Release the keyboard modifiers before copying selected text.");
      }
      if (target && !isTargetForeground(target)) {
        throw new Error("The recording application lost focus before selection capture.");
      }
    },
    async prepareTarget(target, signal) {
      throwIfAborted(signal);
      await waitForModifierKeysReleased(signal);
      throwIfAborted(signal);
      if (!target) {
        await wait(TEXT_TARGET_FOCUS_DELAY_MS, signal);
        return;
      }

      if (isTargetForeground(target)) {
        await wait(TEXT_TARGET_FOCUS_DELAY_MS, signal);
        return;
      }

      throwIfAborted(signal);
      SetForegroundWindow(target);
      await wait(TEXT_TARGET_FOCUS_DELAY_MS, signal);
      if (isTargetForeground(target)) return;

      throwIfAborted(signal);
      sendInput([
        createWindowsKeyInput(0x12, 0, 0),
        createWindowsKeyInput(0x12, 0, KEYEVENTF_KEYUP)
      ]);
      await wait(MODIFIER_POLL_INTERVAL_MS, signal);
      throwIfAborted(signal);
      SetForegroundWindow(target);
      await wait(TEXT_TARGET_FOCUS_DELAY_MS, signal);
      if (!isTargetForeground(target)) {
        throw new Error("Windows could not refocus the application that started recording.");
      }
    },
    sendPaste() {
      sendInput([
        createWindowsKeyInput(0x11, 0, 0),
        createWindowsKeyInput(0x56, 0, 0),
        createWindowsKeyInput(0x56, 0, KEYEVENTF_KEYUP),
        createWindowsKeyInput(0x11, 0, KEYEVENTF_KEYUP)
      ]);
    },
    async sendNavigation(command, signal) {
      throwIfAborted(signal);
      const mouseData = command === "forward" ? 2 : 1;
      sendInput([
        createWindowsMouseInput(mouseData, MOUSEEVENTF_XDOWN),
        createWindowsMouseInput(mouseData, MOUSEEVENTF_XUP)
      ]);
      await wait(MODIFIER_POLL_INTERVAL_MS, signal);
    },
    isTerminalTarget(target) {
      const window = target || GetForegroundWindow();
      return Boolean(window && isTerminalForeground(window));
    },
    sendCopy({ target, consoleSelectionEnabled = false } = {}) {
      const foregroundWindow = GetForegroundWindow();
      if (!foregroundWindow) throw new Error("No application is focused for selection capture.");
      const terminal = isTerminalForeground(foregroundWindow);
      if (terminal && !consoleSelectionEnabled) return;
      // Clipboard snapshotting is asynchronous. Recheck immediately before
      // injection in case focus or modifier state changed during that work.
      if (ModifierKeys.some(isKeyDown) || GetForegroundWindow() !== foregroundWindow
        || (target && !isTargetForeground(target))) {
        throw new Error("The keyboard or focused application changed before selection capture.");
      }
      sendInput([
        createWindowsKeyInput(0x11, 0, 0),
        ...(terminal ? [createWindowsKeyInput(0x10, 0, 0)] : []),
        createWindowsKeyInput(0x43, 0, 0),
        createWindowsKeyInput(0x43, 0, KEYEVENTF_KEYUP),
        ...(terminal ? [createWindowsKeyInput(0x10, 0, KEYEVENTF_KEYUP)] : []),
        createWindowsKeyInput(0x11, 0, KEYEVENTF_KEYUP)
      ]);
    },
    async pressKeyCombination(keys, signal) {
      throwIfAborted(signal);
      const virtualKeys = keys.map(getWindowsVirtualKey);
      throwIfAborted(signal);
      if (keys.includes("Escape")) suppressSyntheticEscape();
      const inputs = [
        ...virtualKeys.map((virtualKey) => createWindowsKeyInput(virtualKey, 0, 0)),
        ...[...virtualKeys].reverse().map((virtualKey) =>
          createWindowsKeyInput(virtualKey, 0, KEYEVENTF_KEYUP))
      ];
      sendInput(inputs);
      await wait(MODIFIER_POLL_INTERVAL_MS, signal);
    },
    async pressEnter(signal) {
      await this.pressKeyCombination(["Enter"], signal);
    },
    dispose() {}
  };

  function isTerminalForeground(window) {
    const classBuffer = Buffer.alloc(512);
    const length = GetClassNameW(window, classBuffer, 256);
    const windowClasses = length > 0 ? [classBuffer.toString("utf16le", 0, length * 2)] : [];
    if (isTerminalWindow({ windowClasses })) return true;
    const processId = [0];
    GetWindowThreadProcessId(window, processId);
    const processHandle = processId[0] ? OpenProcess(0x1000, 0, processId[0]) : null;
    if (!processHandle) return false;
    try {
      const capacity = [32768];
      const name = Buffer.alloc(capacity[0] * 2);
      return Boolean(QueryFullProcessImageNameW(processHandle, 0, name, capacity)
        && isTerminalWindow({ executable: name.toString("utf16le", 0, capacity[0] * 2) }));
    } finally {
      CloseHandle(processHandle);
    }
  }

  function isTargetForeground(target) {
    const foregroundWindow = GetForegroundWindow();
    if (!foregroundWindow || !target) return false;
    if (foregroundWindow === target) return true;
    const targetRoot = GetAncestor(target, 2);
    const foregroundRoot = GetAncestor(foregroundWindow, 2);
    return Boolean(targetRoot && foregroundRoot && targetRoot === foregroundRoot);
  }

  async function waitForModifierKeysReleased(signal) {
    throwIfAborted(signal);
    if (await pollModifierRelease(MAX_MODIFIER_RELEASE_CHECKS, signal)) return;

    const stuckKeys = ModifierReleaseKeys.filter(isKeyDown);
    if (stuckKeys.length) {
      throwIfAborted(signal);
      sendInput(stuckKeys.map((key) => createWindowsKeyInput(key, 0, KEYEVENTF_KEYUP)));
      await wait(MODIFIER_POLL_INTERVAL_MS, signal);
      if (await pollModifierRelease(MAX_MODIFIER_RELEASE_CHECKS_AFTER_NORMALIZATION, signal)) return;
    }

    throw new Error("Release the keyboard modifiers before pasting the response.");
  }

  async function pollModifierRelease(maxChecks, signal) {
    for (let attempt = 0; attempt < maxChecks; attempt += 1) {
      throwIfAborted(signal);
      if (!ModifierKeys.some(isKeyDown)) return true;
      await wait(MODIFIER_POLL_INTERVAL_MS, signal);
    }
    return !ModifierKeys.some(isKeyDown);
  }

  function isKeyDown(key) {
    return (GetAsyncKeyState(key) & 0x8000) !== 0;
  }

  function getWindowsVirtualKey(key) {
    const virtualKey = WINDOWS_KEY_CODES.get(key);
    if (virtualKey) return virtualKey;
    if (/^[A-Z0-9]$/.test(key)) return key.charCodeAt(0);
    throw new Error(`Windows does not recognize key notation '${key}'.`);
  }

  function sendInput(inputs) {
    const sent = SendInput(inputs.length, inputs, koffi.sizeof(INPUT));
    if (sent !== inputs.length) {
      throw new Error("Windows rejected the requested paste input.");
    }
  }

  function createWindowsKeyInput(virtualKey, scanCode, flags) {
    return {
      type: INPUT_KEYBOARD,
      u: {
        ki: {
          wVk: virtualKey,
          wScan: scanCode,
          dwFlags: flags,
          time: 0,
          dwExtraInfo: WINDOWS_INPUT_EXTRA_INFO
        }
      }
    };
  }

  function createWindowsMouseInput(mouseData, flags) {
    return {
      type: INPUT_MOUSE,
      u: {
        mi: {
          dx: 0,
          dy: 0,
          mouseData,
          dwFlags: flags,
          time: 0,
          dwExtraInfo: WINDOWS_INPUT_EXTRA_INFO
        }
      }
    };
  }
}

function createLinuxTextInput() {
  const x11 = koffi.load("libX11.so.6");
  const xtst = koffi.load("libXtst.so.6");
  const XOpenDisplay = x11.func("void * XOpenDisplay(const char *display_name)");
  const XCloseDisplay = x11.func("int XCloseDisplay(void *display)");
  const XFlush = x11.func("int XFlush(void *display)");
  const XQueryKeymap = x11.func("int XQueryKeymap(void *display, _Out_ uint8_t *keys)");
  const XStringToKeysym = x11.func("uint64_t XStringToKeysym(const char *string)");
  const XKeysymToKeycode = x11.func("uint8_t XKeysymToKeycode(void *display, uint64_t keysym)");
  const XTestFakeKeyEvent = xtst.func(
    "int XTestFakeKeyEvent(void *display, uint8_t keycode, int is_press, uint64_t delay)"
  );
  let XTestFakeButtonEvent;
  const keycodes = new Map();
  let display;
  let preparedTarget;

  return {
    captureTarget() {
      return getX11().activeWindow() || null;
    },
    async prepareCopy(target, signal) {
      await waitForModifiers(signal);
      verifyTarget(target);
    },
    async prepareTarget(target, signal) {
      getDisplay();
      await waitForModifiers(signal);
      await wait(TEXT_TARGET_FOCUS_DELAY_MS, signal);
      verifyTarget(target);
      preparedTarget = target;
    },
    isTerminalTarget(target) {
      const window = target || getX11().activeWindow();
      return Boolean(window && isTerminalWindow({ windowClasses: getX11().windowClasses(window) }));
    },
    sendCopy({ target, consoleSelectionEnabled = false } = {}) {
      const foregroundWindow = getX11().activeWindow();
      if (!foregroundWindow) throw new Error("No application is focused for selection capture.");
      const terminal = isTerminalWindow({ windowClasses: getX11().windowClasses(foregroundWindow) });
      if (terminal && !consoleSelectionEnabled) return;
      verifyTarget(target || foregroundWindow);
      verifyTarget(foregroundWindow);
      sendControlShortcut("c", terminal);
    },
    sendPaste() {
      const foregroundWindow = getX11().activeWindow();
      if (!foregroundWindow) throw new Error("No application is focused for pasting the response.");
      const terminal = isTerminalWindow({ windowClasses: getX11().windowClasses(foregroundWindow) });
      verifyTarget(preparedTarget);
      verifyTarget(foregroundWindow);
      sendControlShortcut("v", terminal);
    },
    async sendNavigation(command, signal) {
      throwIfAborted(signal);
      const button = command === "forward" ? 9 : 8;
      sendButton(button, true);
      sendButton(button, false);
      await wait(MODIFIER_POLL_INTERVAL_MS, signal);
    },
    async pressKeyCombination(keys, signal) {
      throwIfAborted(signal);
      verifyTarget(preparedTarget);
      const keycodes = keys.map((key) => getKeycode(getX11KeyName(key)));
      throwIfAborted(signal);
      if (keys.includes("Escape")) suppressSyntheticEscape();
      const pressed = [];
      try {
        for (const keycode of keycodes) {
          throwIfAborted(signal);
          pressed.push(keycode);
          sendKey(keycode, true);
        }
      } finally {
        for (const keycode of [...pressed].reverse()) sendKey(keycode, false);
      }
      await wait(MODIFIER_POLL_INTERVAL_MS, signal);
    },
    async pressEnter(signal) {
      await this.pressKeyCombination(["Enter"], signal);
    },
    dispose() {
      if (!display) return;
      XCloseDisplay(display);
      display = undefined;
    }
  };

  async function waitForModifiers(signal) {
    // Wait for all modifier families, regardless of the configured hotkey.
    // Never synthesize key-up for a modifier the user is physically holding.
    const modifiers = ["Control_L", "Control_R", "Alt_L", "Alt_R", "Shift_L", "Shift_R", "Super_L", "Super_R", "Meta_L", "Meta_R", "ISO_Level3_Shift"]
      .map((name) => XKeysymToKeycode(getDisplay(), XStringToKeysym(name))).filter(Boolean);
    for (let attempt = 0; ; attempt += 1) {
      throwIfAborted(signal);
      const keys = Buffer.alloc(32);
      XQueryKeymap(getDisplay(), keys);
      if (!modifiers.some((key) => keys[key >> 3] & (1 << (key & 7)))) break;
      if (attempt >= MAX_MODIFIER_RELEASE_CHECKS) {
        throw new Error("Release the keyboard modifiers before pasting the response.");
      }
      await wait(MODIFIER_POLL_INTERVAL_MS, signal);
    }
  }

  function sendControlShortcut(key, withShift = false) {
    const control = getKeycode("Control_L");
    const shift = withShift ? getKeycode("Shift_L") : null;
    const keycode = getKeycode(key);
    // Pace terminal shortcuts at the X server so the receiving toolkit can
    // observe the modifiers before the letter and before they are released.
    // XFlush alone sends the entire chord as an effectively instant burst.
    const eventDelay = withShift ? 25 : 0;
    sendKey(control, true, eventDelay);
    try {
      if (shift) sendKey(shift, true, eventDelay);
      sendKey(keycode, true, eventDelay);
      sendKey(keycode, false, eventDelay);
    } finally {
      if (shift) sendKey(shift, false, eventDelay);
      sendKey(control, false, eventDelay);
    }
  }

  function getDisplay() {
    if (display) return display;
    display = XOpenDisplay(null);
    if (!display) throw new Error("Linux clipboard paste requires an available X11 display.");
    return display;
  }

  function verifyTarget(target) {
    if (target && getX11().activeWindow() !== target) {
      throw new Error("The recording application lost focus before the response could be pasted.");
    }
  }

  function getKeycode(name) {
    const cached = keycodes.get(name);
    if (cached) return cached;
    const keysym = XStringToKeysym(name);
    if (!keysym) throw new Error(`Linux could not resolve the X11 key '${name}'.`);
    const keycode = XKeysymToKeycode(getDisplay(), keysym);
    if (!keycode) throw new Error(`Linux could not map the X11 key '${name}'.`);
    keycodes.set(name, keycode);
    return keycode;
  }

  function getX11KeyName(key) {
    if (/^Numpad[0-9]$/.test(key)) return `KP_${key.slice(-1)}`;
    if (key === "NumpadMultiply") return "KP_Multiply";
    if (key === "NumpadAdd") return "KP_Add";
    if (key === "NumpadSubtract") return "KP_Subtract";
    if (key === "NumpadDecimal") return "KP_Decimal";
    if (key === "NumpadDivide") return "KP_Divide";
    return X11_KEY_NAMES.get(key) || key;
  }

  function sendKey(keycode, isPressed, delayMs = 0) {
    if (!XTestFakeKeyEvent(getDisplay(), keycode, isPressed ? 1 : 0, delayMs)) {
      throw new Error("Linux rejected the requested paste input.");
    }
    XFlush(getDisplay());
  }

  function sendButton(button, isPressed) {
    if (!XTestFakeButtonEvent) {
      XTestFakeButtonEvent = xtst.func(
        "int XTestFakeButtonEvent(void *display, uint32_t button, int is_press, uint64_t delay)"
      );
    }
    if (!XTestFakeButtonEvent(getDisplay(), button, isPressed ? 1 : 0, 0)) {
      throw new Error("Linux rejected the requested navigation input.");
    }
    XFlush(getDisplay());
  }
}

function createUnsupportedTextInput() {
  return {
    captureTarget() {
      return null;
    },
    async prepareCopy() {
      throw new Error(`Clipboard copy input is not available on ${process.platform}.`);
    },
    async prepareTarget() {
      throw new Error(`Clipboard paste input is not available on ${process.platform}.`);
    },
    sendPaste() {
      throw new Error(`Clipboard paste input is not available on ${process.platform}.`);
    },
    sendCopy() {
      throw new Error(`Clipboard copy input is not available on ${process.platform}.`);
    },
    async pressKeyCombination() {
      throw new Error(`Clipboard paste input is not available on ${process.platform}.`);
    },
    async sendNavigation() {
      throw new Error(`Navigation input is not available on ${process.platform}.`);
    },
    async pressEnter() {
      throw new Error(`Clipboard paste input is not available on ${process.platform}.`);
    },
    dispose() {}
  };
}

const wait = abortableDelay;

function suppressSyntheticEscape() {
  syntheticEscapeSuppressedUntil = Math.max(syntheticEscapeSuppressedUntil, Date.now() + 100);
}

function suppressSyntheticRadialInput() {
  syntheticRadialInputSuppressedUntil = Math.max(
    syntheticRadialInputSuppressedUntil,
    Date.now() + 250
  );
}
