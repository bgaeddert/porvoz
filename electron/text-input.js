import { ClipboardItem, clipboard } from "electron";
import koffi from "koffi";
import { parseTextCommands } from "./text-command-parser.js";
import { createClipboardTextTransaction } from "./clipboard-text-transaction.js";

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const WINDOWS_INPUT_EXTRA_INFO = 0x5056;
const TEXT_TARGET_FOCUS_DELAY_MS = 100;
const MODIFIER_POLL_INTERVAL_MS = 25;
const MAX_MODIFIER_RELEASE_CHECKS = 32;
const MAX_MODIFIER_RELEASE_CHECKS_AFTER_NORMALIZATION = 8;

let textInputForPlatform;

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

export async function typeText(text, { target = null } = {}) {
  if (typeof text !== "string" || !text) return;
  await textInputForPlatform.prepareTarget(target);

  for (const command of parseTextCommands(text)) {
    if (command.type === "enter") {
      await textInputForPlatform.pressEnter();
    } else if (command.value) {
      await clipboardTextTransaction.pasteText(
        command.value,
        () => textInputForPlatform.sendPaste()
      );
    }
  }
}

function createWindowsTextInput() {
  const user32 = koffi.load("user32.dll");
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
    async prepareTarget(target) {
      await waitForModifierKeysReleased();
      if (!target) {
        await wait(TEXT_TARGET_FOCUS_DELAY_MS);
        return;
      }

      if (isTargetForeground(target)) {
        await wait(TEXT_TARGET_FOCUS_DELAY_MS);
        return;
      }

      SetForegroundWindow(target);
      await wait(TEXT_TARGET_FOCUS_DELAY_MS);
      if (isTargetForeground(target)) return;

      sendInput([
        createWindowsKeyInput(0x12, 0, 0),
        createWindowsKeyInput(0x12, 0, KEYEVENTF_KEYUP)
      ]);
      await wait(MODIFIER_POLL_INTERVAL_MS);
      SetForegroundWindow(target);
      await wait(TEXT_TARGET_FOCUS_DELAY_MS);
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
    async pressEnter() {
      sendInput([
        createWindowsKeyInput(0x0d, 0, 0),
        createWindowsKeyInput(0x0d, 0, KEYEVENTF_KEYUP)
      ]);
      await wait(MODIFIER_POLL_INTERVAL_MS);
    },
    dispose() {}
  };

  function isTargetForeground(target) {
    const foregroundWindow = GetForegroundWindow();
    if (!foregroundWindow || !target) return false;
    if (foregroundWindow === target) return true;
    const targetRoot = GetAncestor(target, 2);
    const foregroundRoot = GetAncestor(foregroundWindow, 2);
    return Boolean(targetRoot && foregroundRoot && targetRoot === foregroundRoot);
  }

  async function waitForModifierKeysReleased() {
    if (await pollModifierRelease(MAX_MODIFIER_RELEASE_CHECKS)) return;

    const stuckKeys = ModifierReleaseKeys.filter(isKeyDown);
    if (stuckKeys.length) {
      sendInput(stuckKeys.map((key) => createWindowsKeyInput(key, 0, KEYEVENTF_KEYUP)));
      await wait(MODIFIER_POLL_INTERVAL_MS);
      if (await pollModifierRelease(MAX_MODIFIER_RELEASE_CHECKS_AFTER_NORMALIZATION)) return;
    }

    throw new Error("Release the keyboard modifiers before pasting the response.");
  }

  async function pollModifierRelease(maxChecks) {
    for (let attempt = 0; attempt < maxChecks; attempt += 1) {
      if (!ModifierKeys.some(isKeyDown)) return true;
      await wait(MODIFIER_POLL_INTERVAL_MS);
    }
    return !ModifierKeys.some(isKeyDown);
  }

  function isKeyDown(key) {
    return (GetAsyncKeyState(key) & 0x8000) !== 0;
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
}

function createLinuxTextInput() {
  const x11 = koffi.load("libX11.so.6");
  const xtst = koffi.load("libXtst.so.6");
  const XOpenDisplay = x11.func("void * XOpenDisplay(const char *display_name)");
  const XCloseDisplay = x11.func("int XCloseDisplay(void *display)");
  const XFlush = x11.func("int XFlush(void *display)");
  const XStringToKeysym = x11.func("uint64_t XStringToKeysym(const char *string)");
  const XKeysymToKeycode = x11.func("uint8_t XKeysymToKeycode(void *display, uint64_t keysym)");
  const XTestFakeKeyEvent = xtst.func(
    "int XTestFakeKeyEvent(void *display, uint8_t keycode, int is_press, uint64_t delay)"
  );
  const keycodes = new Map();
  let display;

  return {
    captureTarget() {
      return null;
    },
    async prepareTarget() {
      getDisplay();
      await wait(TEXT_TARGET_FOCUS_DELAY_MS);
    },
    sendPaste() {
      const control = getKeycode("Control_L");
      const paste = getKeycode("v");
      sendKey(control, true);
      try {
        sendKey(paste, true);
        sendKey(paste, false);
      } finally {
        sendKey(control, false);
      }
    },
    async pressEnter() {
      sendKey(getKeycode("Return"), true);
      sendKey(getKeycode("Return"), false);
      await wait(MODIFIER_POLL_INTERVAL_MS);
    },
    dispose() {
      if (!display) return;
      XCloseDisplay(display);
      display = undefined;
    }
  };

  function getDisplay() {
    if (display) return display;
    display = XOpenDisplay(null);
    if (!display) throw new Error("Linux clipboard paste requires an available X11 display.");
    return display;
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

  function sendKey(keycode, isPressed) {
    if (!XTestFakeKeyEvent(getDisplay(), keycode, isPressed ? 1 : 0, 0)) {
      throw new Error("Linux rejected the requested paste input.");
    }
    XFlush(getDisplay());
  }
}

function createUnsupportedTextInput() {
  return {
    captureTarget() {
      return null;
    },
    async prepareTarget() {
      throw new Error(`Clipboard paste input is not available on ${process.platform}.`);
    },
    sendPaste() {
      throw new Error(`Clipboard paste input is not available on ${process.platform}.`);
    },
    async pressEnter() {
      throw new Error(`Clipboard paste input is not available on ${process.platform}.`);
    },
    dispose() {}
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
