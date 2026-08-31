import koffi from "koffi";
import { parseTextCommands } from "./text-command-parser.js";

const TEXT_TYPING_DELAY_MS = 20;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;

let textInputForPlatform;

if (process.platform === "win32") {
  textInputForPlatform = createWindowsTextInput();
} else if (process.platform === "linux") {
  textInputForPlatform = createLinuxTextInput();
} else if (process.platform === "darwin") {
  textInputForPlatform = createMacTextInput();
}

export async function typeText(text) {
  if (typeof text !== "string" || !text) return;
  if (!textInputForPlatform) {
    throw new Error(`Literal text input is not available on ${process.platform}.`);
  }
  for (const command of parseTextCommands(text)) {
    if (command.type === "enter") {
      await textInputForPlatform.pressEnter();
    } else if (command.value) {
      await textInputForPlatform.typeText(command.value);
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
  const SendInput = user32.func(
    "unsigned int __stdcall SendInput(unsigned int cInputs, PorvozInput *pInputs, int cbSize)"
  );

  return {
    typeText: async (text) => {
    for (let index = 0; index < text.length; index += 1) {
      const codeUnit = text.charCodeAt(index);
      const inputs = [
        createWindowsUnicodeInput(INPUT_KEYBOARD, codeUnit, KEYEVENTF_UNICODE),
        createWindowsUnicodeInput(INPUT_KEYBOARD, codeUnit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
      ];
      sendWindowsInput(SendInput, INPUT, inputs);
      await wait(TEXT_TYPING_DELAY_MS);
    }
    },
    pressEnter: async () => {
      const inputs = [
        createWindowsKeyInput(INPUT_KEYBOARD, 0x0d, 0, 0),
        createWindowsKeyInput(INPUT_KEYBOARD, 0x0d, 0, KEYEVENTF_KEYUP)
      ];
      sendWindowsInput(SendInput, INPUT, inputs);
      await wait(TEXT_TYPING_DELAY_MS);
    }
  };
}

function createWindowsUnicodeInput(type, codeUnit, flags) {
  return createWindowsKeyInput(type, 0, codeUnit, flags);
}

function createWindowsKeyInput(type, virtualKey, scanCode, flags) {
  return {
    type,
    u: {
      ki: {
        wVk: virtualKey,
        wScan: scanCode,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0
      }
    }
  };
}

function sendWindowsInput(SendInput, INPUT, inputs) {
  const sent = SendInput(inputs.length, inputs, koffi.sizeof(INPUT));
  if (sent !== inputs.length) {
    throw new Error("Windows rejected the requested text input.");
  }
}

function createMacTextInput() {
  const coreGraphics = koffi.load(
    "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
  );
  const coreFoundation = koffi.load(
    "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
  );
  const CGEventCreateKeyboardEvent = coreGraphics.func(
    "void * CGEventCreateKeyboardEvent(void *source, uint16_t virtualKey, bool keyDown)"
  );
  const CGEventKeyboardSetUnicodeString = coreGraphics.func(
    "void CGEventKeyboardSetUnicodeString(void *event, size_t length, const uint16_t *string)"
  );
  const CGEventPost = coreGraphics.func(
    "void CGEventPost(uint32_t tap, void *event)"
  );
  const CFRelease = coreFoundation.func("void CFRelease(void *cf)");
  const HID_EVENT_TAP = 0;

  return {
    typeText: async (text) => {
    for (const character of text) {
      const keyDown = CGEventCreateKeyboardEvent(null, 0, true);
      if (!keyDown) throw new Error("macOS rejected literal text input.");
      CGEventKeyboardSetUnicodeString(keyDown, character.length, character);
      CGEventPost(HID_EVENT_TAP, keyDown);
      CFRelease(keyDown);

      const keyUp = CGEventCreateKeyboardEvent(null, 0, false);
      if (!keyUp) throw new Error("macOS rejected literal text input.");
      CGEventPost(HID_EVENT_TAP, keyUp);
      CFRelease(keyUp);
      await wait(TEXT_TYPING_DELAY_MS);
    }
    },
    pressEnter: async () => {
      const keyDown = CGEventCreateKeyboardEvent(null, 36, true);
      if (!keyDown) throw new Error("macOS rejected the Enter key press.");
      CGEventPost(HID_EVENT_TAP, keyDown);
      CFRelease(keyDown);

      const keyUp = CGEventCreateKeyboardEvent(null, 36, false);
      if (!keyUp) throw new Error("macOS rejected the Enter key press.");
      CGEventPost(HID_EVENT_TAP, keyUp);
      CFRelease(keyUp);
      await wait(TEXT_TYPING_DELAY_MS);
    }
  };
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
    "int XTestFakeKeyEvent(void *display, uint8_t keycode, int is_press, uint64_t delay"
      + ")"
  );
  const keycodes = new Map();
  let display;

  return {
    typeText: async (text) => {
      for (const character of text) {
        if (character === "\\n" || character === "\\r") {
          sendEnter();
        } else {
          sendUnicode(character);
        }
        await wait(TEXT_TYPING_DELAY_MS);
      }
    },
    pressEnter: async () => {
      sendEnter();
      await wait(TEXT_TYPING_DELAY_MS);
    }
  };

  function getDisplay() {
    if (display) return display;
    display = XOpenDisplay(null);
    if (!display) {
      throw new Error("Linux text input requires an available X11 display.");
    }
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

  function sendKey(name, isPressed) {
    const currentDisplay = getDisplay();
    if (!XTestFakeKeyEvent(currentDisplay, getKeycode(name), isPressed ? 1 : 0, 0)) {
      throw new Error("Linux rejected the requested text input.");
    }
    XFlush(currentDisplay);
  }

  function sendEnter() {
    sendKey("Return", true);
    sendKey("Return", false);
  }

  function sendUnicode(character) {
    const codePoint = character.codePointAt(0);
    const hex = codePoint.toString(16);
    sendKey("Control_L", true);
    sendKey("Shift_L", true);
    try {
      sendKey("u", true);
      sendKey("u", false);
      sendKey("Control_L", false);
      sendKey("Shift_L", false);
      for (const digit of hex) {
        sendKey(digit, true);
        sendKey(digit, false);
      }
      sendEnter();
    } finally {
      sendKey("Control_L", false);
      sendKey("Shift_L", false);
    }
  }

  function closeDisplay() {
    if (!display) return;
    XCloseDisplay(display);
    display = undefined;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
