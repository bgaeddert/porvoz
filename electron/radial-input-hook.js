import koffi from "koffi";

const HOOK_KEYBOARD_LL = 13;
const HOOK_MOUSE_LL = 14;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_RBUTTONDOWN = 0x0204;
const WM_RBUTTONUP = 0x0205;
const WM_MBUTTONDOWN = 0x0207;
const WM_MBUTTONUP = 0x0208;
const WM_XBUTTONDOWN = 0x020b;
const WM_XBUTTONUP = 0x020c;
const LLKHF_INJECTED = 0x00000010;
const LLMHF_INJECTED = 0x00000001;

const VK_BY_CODE = new Map([
  ["ControlLeft", 0xa2], ["ControlRight", 0xa3],
  ["AltLeft", 0xa4], ["AltRight", 0xa5],
  ["ShiftLeft", 0xa0], ["ShiftRight", 0xa1],
  ["MetaLeft", 0x5b], ["MetaRight", 0x5c],
  ["Enter", 0x0d], ["Escape", 0x1b], ["Tab", 0x09], ["Space", 0x20],
  ["Backspace", 0x08], ["Delete", 0x2e], ["Insert", 0x2d],
  ["Home", 0x24], ["End", 0x23], ["PageUp", 0x21], ["PageDown", 0x22],
  ["ArrowUp", 0x26], ["ArrowDown", 0x28], ["ArrowLeft", 0x25], ["ArrowRight", 0x27],
  ["CapsLock", 0x14], ["NumLock", 0x90], ["ScrollLock", 0x91],
  ["PrintScreen", 0x2c], ["Pause", 0x13], ["ContextMenu", 0x5d],
  ["Backquote", 0xc0], ["Minus", 0xbd], ["Equal", 0xbb],
  ["BracketLeft", 0xdb], ["BracketRight", 0xdd], ["Backslash", 0xdc],
  ["Semicolon", 0xba], ["Quote", 0xde], ["Comma", 0xbc],
  ["Period", 0xbe], ["Slash", 0xbf],
  ["NumpadMultiply", 0x6a], ["NumpadAdd", 0x6b], ["NumpadSubtract", 0x6d],
  ["NumpadDecimal", 0x6e], ["NumpadDivide", 0x6f], ["NumpadEnter", 0x0d],
  ["NumpadEnd", 0x23], ["NumpadArrowDown", 0x28], ["NumpadPageDown", 0x22],
  ["NumpadArrowLeft", 0x25], ["NumpadArrowRight", 0x27], ["NumpadHome", 0x24],
  ["NumpadArrowUp", 0x26], ["NumpadPageUp", 0x21], ["NumpadInsert", 0x2d],
  ["NumpadDelete", 0x2e]
]);

for (let index = 0; index <= 9; index += 1) VK_BY_CODE.set(`Digit${index}`, 0x30 + index);
for (let index = 0; index < 26; index += 1) VK_BY_CODE.set(`Key${String.fromCharCode(65 + index)}`, 0x41 + index);
for (let index = 1; index <= 24; index += 1) VK_BY_CODE.set(`F${index}`, 0x6f + index);
for (let index = 0; index <= 9; index += 1) VK_BY_CODE.set(`Numpad${index}`, 0x60 + index);

const MODIFIER_FOR_VK = new Map([
  [0x10, "SHIFT"], [0xa0, "SHIFT"], [0xa1, "SHIFT"],
  [0x11, "CTRL"], [0xa2, "CTRL"], [0xa3, "CTRL"],
  [0x12, "ALT"], [0xa4, "ALT"], [0xa5, "ALT"],
  [0x5b, "META"], [0x5c, "META"]
]);

const MOUSE_MESSAGE_BUTTONS = new Map([
  [WM_LBUTTONDOWN, { button: 1, pressed: true }],
  [WM_LBUTTONUP, { button: 1, pressed: false }],
  [WM_RBUTTONDOWN, { button: 2, pressed: true }],
  [WM_RBUTTONUP, { button: 2, pressed: false }],
  [WM_MBUTTONDOWN, { button: 3, pressed: true }],
  [WM_MBUTTONUP, { button: 3, pressed: false }]
]);

let hookInstanceId = 0;

export function createRadialInputHook({
  onPress,
  onRelease,
  consumeRequiredModifier = modifier => modifier === "META"
} = {}) {
  if (process.platform !== "win32") {
    return {
      supported: false,
      setTrigger() { return false; },
      setCaptureHandler() { return false; },
      start() { return false; },
      stop() {}
    };
  }

  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const typeSuffix = ++hookInstanceId;
  const KBDLLHOOKSTRUCT = koffi.struct(`PorvozRadialKeyboardHook${typeSuffix}`, {
    vkCode: "uint32_t",
    scanCode: "uint32_t",
    flags: "uint32_t",
    time: "uint32_t",
    dwExtraInfo: "uintptr_t"
  });
  const MSLLHOOKSTRUCT = koffi.struct(`PorvozRadialMouseHook${typeSuffix}`, {
    pt: koffi.struct(`PorvozRadialPoint${typeSuffix}`, { x: "long", y: "long" }),
    mouseData: "uint32_t",
    flags: "uint32_t",
    time: "uint32_t",
    dwExtraInfo: "uintptr_t"
  });
  const hookProcName = `PorvozRadialHookProc${typeSuffix}`;
  const HookProc = koffi.proto(`intptr_t __stdcall ${hookProcName}(int nCode, uintptr_t wParam, void *lParam)`);
  const SetWindowsHookEx = user32.func(
    `void * __stdcall SetWindowsHookExW(int idHook, ${hookProcName} *lpfn, void *hMod, uint32_t dwThreadId)`
  );
  const UnhookWindowsHookEx = user32.func("int __stdcall UnhookWindowsHookEx(void *hook)");
  const CallNextHookEx = user32.func("intptr_t __stdcall CallNextHookEx(void *hook, int nCode, uintptr_t wParam, void *lParam)");
  const GetModuleHandle = kernel32.func("void * __stdcall GetModuleHandleW(const char16_t *name)");

  let trigger;
  let keyboardHook;
  let mouseHook;
  let registeredCallback;
  let captureHandler;
  let active = false;
  let activeTrigger = false;
  let releasePending = false;
  const pressedModifiers = new Set();
  const pressedVirtualKeys = new Set();
  const consumedVirtualKeys = new Set();
  let callbackQueue = [];
  let callbackFlushScheduled = false;

  const callback = (nCode, wParam, lParam) => {
    try {
      if (nCode >= 0) {
        if (captureHandler && (
          handleCaptureKeyboardEvent(Number(wParam), lParam)
          || handleCaptureMouseEvent(Number(wParam), lParam)
        )) return 1;
        if (handleKeyboardEvent(Number(wParam), lParam)) return 1;
        if (handleMouseEvent(Number(wParam), lParam)) return 1;
      }
    } catch (error) {
      console.error("Radial input hook failed:", error);
    }
    return CallNextHookEx(null, nCode, wParam, lParam);
  };

  return {
    supported: true,
    setTrigger(value) {
      trigger = value && typeof value === "object" ? structuredClone(value) : null;
      activeTrigger = false;
      releasePending = false;
      pressedModifiers.clear();
      pressedVirtualKeys.clear();
      consumedVirtualKeys.clear();
      return Boolean(trigger);
    },
    setCaptureHandler(value) {
      captureHandler = value && typeof value === "object" ? value : undefined;
      releasePending = false;
      pressedModifiers.clear();
      pressedVirtualKeys.clear();
      consumedVirtualKeys.clear();
      return Boolean(captureHandler);
    },
    start() {
      if (active || (!trigger && !captureHandler)) return Boolean(active);
      registeredCallback = koffi.register(callback, koffi.pointer(HookProc));
      const moduleHandle = GetModuleHandle(null);
      keyboardHook = SetWindowsHookEx(HOOK_KEYBOARD_LL, registeredCallback, moduleHandle, 0);
      mouseHook = SetWindowsHookEx(HOOK_MOUSE_LL, registeredCallback, moduleHandle, 0);
      if (!keyboardHook || !mouseHook) {
        if (keyboardHook) UnhookWindowsHookEx(keyboardHook);
        if (mouseHook) UnhookWindowsHookEx(mouseHook);
        koffi.unregister(registeredCallback);
        keyboardHook = undefined;
        mouseHook = undefined;
        registeredCallback = undefined;
        throw new Error("Windows could not install the radial input hook.");
      }
      active = true;
      return true;
    },
    stop() {
      if (keyboardHook) UnhookWindowsHookEx(keyboardHook);
      if (mouseHook) UnhookWindowsHookEx(mouseHook);
      if (registeredCallback) koffi.unregister(registeredCallback);
      keyboardHook = undefined;
      mouseHook = undefined;
      registeredCallback = undefined;
      active = false;
      activeTrigger = false;
      releasePending = false;
      pressedModifiers.clear();
      pressedVirtualKeys.clear();
      consumedVirtualKeys.clear();
      callbackQueue = [];
      callbackFlushScheduled = false;
    },
    isTriggerPressed() {
      return getTriggerVirtualKeys().some((key) => pressedVirtualKeys.has(key));
    }
  };

  function handleCaptureKeyboardEvent(message, pointer) {
    const isDown = message === WM_KEYDOWN || message === WM_SYSKEYDOWN;
    const isUp = message === WM_KEYUP || message === WM_SYSKEYUP;
    if (!isDown && !isUp) return false;

    const event = koffi.decode(pointer, KBDLLHOOKSTRUCT);
    if (Number(event.flags) & LLKHF_INJECTED) return false;
    const vk = Number(event.vkCode);
    const wasPressed = pressedVirtualKeys.has(vk);
    const modifier = MODIFIER_FOR_VK.get(vk);
    if (isDown) {
      pressedVirtualKeys.add(vk);
      if (modifier) pressedModifiers.add(modifier);
    }

    const input = {
      type: isDown ? "keyDown" : "keyUp",
      code: getCodeFromVirtualKey(vk),
      isAutoRepeat: isDown && wasPressed,
      control: pressedModifiers.has("CTRL"),
      alt: pressedModifiers.has("ALT"),
      shift: pressedModifiers.has("SHIFT"),
      meta: pressedModifiers.has("META")
    };
    const handler = captureHandler;
    enqueueCallback(() => handler?.onKeyboardEvent?.(input));

    if (isUp) {
      pressedVirtualKeys.delete(vk);
      if (modifier) pressedModifiers.delete(modifier);
    }
    return true;
  }

  function handleCaptureMouseEvent(message, pointer) {
    const mouseInput = getMouseInput(message, pointer);
    if (!mouseInput) return false;
    const handler = captureHandler;
    enqueueCallback(() => handler?.onMouseEvent?.({
      type: mouseInput.isDown ? "mouseDown" : "mouseUp",
      button: mouseInput.button
    }));
    // Let capture clicks reach the Settings window so its Cancel control stays
    // usable. The configured trigger is consumed after capture is complete.
    return false;
  }

  function handleKeyboardEvent(message, pointer) {
    const isDown = message === WM_KEYDOWN || message === WM_SYSKEYDOWN;
    const isUp = message === WM_KEYUP || message === WM_SYSKEYUP;
    if (!isDown && !isUp || !trigger || trigger.kind !== "keyboard") return false;

    const event = koffi.decode(pointer, KBDLLHOOKSTRUCT);
    if (Number(event.flags) & LLKHF_INJECTED) return false;
    const vk = Number(event.vkCode);
    const wasPressed = pressedVirtualKeys.has(vk);
    const modifier = MODIFIER_FOR_VK.get(vk);
    if (isDown) pressedVirtualKeys.add(vk);
    if (isUp) pressedVirtualKeys.delete(vk);
    if (isDown && modifier) pressedModifiers.add(modifier);
    if (isUp && modifier) pressedModifiers.delete(modifier);

    const triggerVk = getVirtualKey(trigger.code);
    const modifierIsRequired = modifier && trigger.modifiers?.includes(modifier);
    const triggerKey = triggerVk !== undefined && vk === triggerVk;
    let shouldConsume = false;

    if (isDown && triggerKey && modifiersMatch(trigger.modifiers, modifier)) {
      activeTrigger = true;
      releasePending = false;
      enqueueCallback(() => onPress?.({
        kind: "keyboard", code: trigger.code, modifiers: [...(trigger.modifiers || [])]
      }));
      shouldConsume = true;
    } else if (isUp && activeTrigger && triggerKey) {
      activeTrigger = false;
      releasePending = true;
      const allReleased = !triggerKeysArePressed();
      enqueueCallback(() => onRelease?.({
        kind: "keyboard",
        code: trigger.code,
        modifiers: [...(trigger.modifiers || [])],
        allReleased
      }));
      if (allReleased) releasePending = false;
      shouldConsume = true;
    } else if (isUp && releasePending && modifierIsRequired) {
      const allReleased = !triggerKeysArePressed();
      if (allReleased) {
        releasePending = false;
        enqueueCallback(() => onRelease?.({
          kind: "keyboard",
          code: trigger.code,
          modifiers: [...(trigger.modifiers || [])],
          allReleased: true
        }));
      }
      shouldConsume = consumeRequiredModifier(modifier);
    } else if (isDown && modifier && triggerVk !== undefined && pressedVirtualKeys.has(triggerVk)
      && MODIFIER_FOR_VK.get(triggerVk)
      && modifiersMatch(trigger.modifiers, modifier)) {
      activeTrigger = true;
      releasePending = false;
      enqueueCallback(() => onPress?.({
        kind: "keyboard", code: trigger.code, modifiers: [...(trigger.modifiers || [])]
      }));
      shouldConsume = true;
    } else if (activeTrigger && (triggerKey || modifierIsRequired)) {
      shouldConsume = true;
    } else if (modifierIsRequired && consumeRequiredModifier(modifier)) {
      shouldConsume = true;
    }
    return matchKeyboardEventConsumption(vk, isDown, wasPressed, shouldConsume);
  }

  function matchKeyboardEventConsumption(vk, isDown, wasPressed, shouldConsume) {
    if (isDown) {
      if (!wasPressed) {
        if (shouldConsume) consumedVirtualKeys.add(vk);
        else consumedVirtualKeys.delete(vk);
      }
      return consumedVirtualKeys.has(vk);
    }
    const consumed = consumedVirtualKeys.has(vk);
    consumedVirtualKeys.delete(vk);
    return consumed;
  }

  function handleMouseEvent(message, pointer) {
    if (!trigger || trigger.kind !== "mouse") return false;
    const mouseInput = getMouseInput(message, pointer);
    if (!mouseInput || mouseInput.button !== Number(trigger.button)) return false;
    if (mouseInput.isDown && !activeTrigger) {
      activeTrigger = true;
      enqueueCallback(() => onPress?.({ kind: "mouse", button: mouseInput.button }));
    } else if (!mouseInput.isDown && activeTrigger) {
      activeTrigger = false;
      enqueueCallback(() => onRelease?.({ kind: "mouse", button: mouseInput.button }));
    }
    return true;
  }

  function getMouseInput(message, pointer) {
    const base = MOUSE_MESSAGE_BUTTONS.get(message);
    const isXButton = message === WM_XBUTTONDOWN || message === WM_XBUTTONUP;
    if (!base && !isXButton) return null;
    const event = koffi.decode(pointer, MSLLHOOKSTRUCT);
    if (Number(event.flags) & LLMHF_INJECTED) return null;
    return {
      button: base?.button || (Math.floor(Number(event.mouseData) / 0x10000) === 1 ? 4 : 5),
      isDown: base?.pressed ?? message === WM_XBUTTONDOWN
    };
  }

  function modifiersMatch(required = [], triggerModifier) {
    if (triggerModifier && required.includes(triggerModifier)) {
      return required.every((modifier) => modifier === triggerModifier || pressedModifiers.has(modifier));
    }
    return required.every((modifier) => pressedModifiers.has(modifier));
  }

  function triggerKeysArePressed() {
    return getTriggerVirtualKeys().some((key) => pressedVirtualKeys.has(key));
  }

  function getTriggerVirtualKeys() {
    if (!trigger || trigger.kind !== "keyboard") return [];
    const key = getVirtualKey(trigger.code);
    const modifiers = [...(trigger.modifiers || [])].flatMap((requiredModifier) =>
      [...MODIFIER_FOR_VK.entries()]
        .filter(([, modifier]) => modifier === requiredModifier)
        .map(([virtualKey]) => virtualKey)
    );
    return [key, ...modifiers].filter((value, index, values) =>
      value !== undefined && values.indexOf(value) === index
    );
  }

  function enqueueCallback(callback) {
    callbackQueue.push(callback);
    if (callbackFlushScheduled) return;
    callbackFlushScheduled = true;
    setImmediate(flushCallbacks);
  }

  function flushCallbacks() {
    callbackFlushScheduled = false;
    const callbacks = callbackQueue;
    callbackQueue = [];
    for (const callback of callbacks) {
      try {
        callback();
      } catch (error) {
        console.error("Radial input callback failed:", error);
      }
    }
    if (callbackQueue.length && !callbackFlushScheduled) {
      callbackFlushScheduled = true;
      setImmediate(flushCallbacks);
    }
  }
}

function getVirtualKey(code) {
  if (VK_BY_CODE.has(code)) return VK_BY_CODE.get(code);
  if (typeof code === "string" && /^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (typeof code === "string" && /^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  return undefined;
}

function getCodeFromVirtualKey(value) {
  for (const [code, vk] of VK_BY_CODE) {
    if (vk === value) return code;
  }
  return undefined;
}
