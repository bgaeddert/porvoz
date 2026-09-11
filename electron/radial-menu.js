export const RADIAL_SEGMENT_COUNT = 12;
export const RADIAL_SLOT_IDS = Object.freeze([
  ...Array.from({ length: RADIAL_SEGMENT_COUNT }, (_value, index) => String(index + 1)),
  "center"
]);

export const RADIAL_SLOT_DEFINITIONS = Object.freeze([
  { id: "1", number: 1, position: "12 o'clock" },
  { id: "2", number: 2, position: "1 o'clock" },
  { id: "3", number: 3, position: "2 o'clock" },
  { id: "4", number: 4, position: "3 o'clock" },
  { id: "5", number: 5, position: "4 o'clock" },
  { id: "6", number: 6, position: "5 o'clock" },
  { id: "7", number: 7, position: "6 o'clock" },
  { id: "8", number: 8, position: "7 o'clock" },
  { id: "9", number: 9, position: "8 o'clock" },
  { id: "10", number: 10, position: "9 o'clock" },
  { id: "11", number: 11, position: "10 o'clock" },
  { id: "12", number: 12, position: "11 o'clock" },
  { id: "center", number: 13, position: "Center" }
]);

const VALID_MODIFIERS = new Set(["CTRL", "ALT", "SHIFT", "META"]);
const VALID_NAVIGATION = new Set(["back", "forward"]);
const VALID_MOUSE_BUTTONS = new Set([1, 2, 3, 4, 5]);
const RECORDED_CODE_TO_ACTION_KEY = new Map([
  ["ControlLeft", "Control"], ["ControlRight", "Control"],
  ["AltLeft", "Alt"], ["AltRight", "Alt"],
  ["ShiftLeft", "Shift"], ["ShiftRight", "Shift"],
  ["MetaLeft", "Meta"], ["MetaRight", "Meta"],
  ["Enter", "Enter"], ["Escape", "Escape"], ["Tab", "Tab"], ["Space", "Space"],
  ["Backspace", "Backspace"], ["Delete", "Delete"], ["Insert", "Insert"],
  ["Home", "Home"], ["End", "End"], ["PageUp", "PageUp"], ["PageDown", "PageDown"],
  ["ArrowUp", "ArrowUp"], ["ArrowDown", "ArrowDown"],
  ["ArrowLeft", "ArrowLeft"], ["ArrowRight", "ArrowRight"],
  ["CapsLock", "CapsLock"], ["NumLock", "NumLock"], ["ScrollLock", "ScrollLock"],
  ["PrintScreen", "PrintScreen"], ["Pause", "Pause"], ["ContextMenu", "ContextMenu"],
  ["Backquote", "`"], ["Minus", "-"], ["Equal", "="],
  ["BracketLeft", "["], ["BracketRight", "]"], ["Backslash", "\\"],
  ["Semicolon", ";"], ["Quote", "'"], ["Comma", ","], ["Period", "."], ["Slash", "/"],
  ["NumpadMultiply", "NumpadMultiply"], ["NumpadAdd", "NumpadAdd"],
  ["NumpadSubtract", "NumpadSubtract"], ["NumpadDecimal", "NumpadDecimal"],
  ["NumpadDivide", "NumpadDivide"], ["NumpadEnter", "Enter"],
  ["NumpadEnd", "End"], ["NumpadArrowDown", "ArrowDown"],
  ["NumpadPageDown", "PageDown"], ["NumpadArrowLeft", "ArrowLeft"],
  ["NumpadArrowRight", "ArrowRight"], ["NumpadHome", "Home"],
  ["NumpadArrowUp", "ArrowUp"], ["NumpadPageUp", "PageUp"],
  ["NumpadInsert", "Insert"], ["NumpadDelete", "Delete"]
]);

for (let index = 0; index <= 9; index += 1) {
  RECORDED_CODE_TO_ACTION_KEY.set(`Digit${index}`, String(index));
  RECORDED_CODE_TO_ACTION_KEY.set(`Numpad${index}`, `Numpad${index}`);
}
for (let index = 0; index < 26; index += 1) {
  const letter = String.fromCharCode(65 + index);
  RECORDED_CODE_TO_ACTION_KEY.set(`Key${letter}`, letter);
}
for (let index = 1; index <= 24; index += 1) {
  RECORDED_CODE_TO_ACTION_KEY.set(`F${index}`, `F${index}`);
}
const VALID_ACTION_KEYS = new Set(RECORDED_CODE_TO_ACTION_KEY.values());

export function createDefaultRadialMenu() {
  return {
    enabled: false,
    trigger: null,
    slots: RADIAL_SLOT_IDS.map((id) => ({ id, label: "", action: null }))
  };
}

export function normalizeRadialMenu(value) {
  const defaults = createDefaultRadialMenu();
  const sourceSlots = Array.isArray(value?.slots) ? value.slots : [];
  const slotsById = new Map(sourceSlots
    .map((slot) => [String(slot?.id || ""), slot])
    .filter(([id]) => RADIAL_SLOT_IDS.includes(id)));

  return {
    enabled: value?.enabled === true,
    trigger: normalizeRadialTrigger(value?.trigger),
    slots: defaults.slots.map((slot) => {
      const source = slotsById.get(slot.id);
      return {
        id: slot.id,
        label: normalizeLabel(source?.label),
        action: normalizeRadialAction(source?.action)
      };
    })
  };
}

export function normalizeRadialTrigger(value) {
  if (!value || typeof value !== "object") return null;
  const kind = value.kind === "mouse" ? "mouse" : value.kind === "keyboard" ? "keyboard" : "";
  if (!kind) return null;

  const modifiers = Array.isArray(value.modifiers)
    ? [...new Set(value.modifiers.map((modifier) => String(modifier).toUpperCase())
      .filter((modifier) => VALID_MODIFIERS.has(modifier)))]
    : [];
  const label = normalizeLabel(value.label);

  if (kind === "mouse") {
    const button = Number(value.button);
    if (!VALID_MOUSE_BUTTONS.has(button)) return null;
    return { kind, button, modifiers, label: label || formatMouseButtonLabel(button) };
  }

  if (typeof value.code !== "string" || !RECORDED_CODE_TO_ACTION_KEY.has(value.code.trim())) return null;
  return {
    kind,
    code: value.code.trim(),
    modifiers,
    label: label || formatKeyboardCodeLabel(value.code.trim(), modifiers)
  };
}

export function normalizeRadialAction(value) {
  if (!value || typeof value !== "object") return null;
  if (value.type === "navigation") {
    const command = String(value.command || "").toLocaleLowerCase();
    return VALID_NAVIGATION.has(command)
      ? { type: "navigation", command, label: normalizeLabel(value.label) || formatNavigationLabel(command) }
      : null;
  }
  if (value.type !== "hotkey" || !Array.isArray(value.keys) || !value.keys.length) return null;
  const keys = [...new Set(value.keys.map((key) => typeof key === "string" ? key.trim() : "").filter(Boolean))];
  if (!keys.length || keys.length > 5 || keys.some((key) => !VALID_ACTION_KEYS.has(key))) return null;
  return {
    type: "hotkey",
    keys,
    label: normalizeLabel(value.label) || keys.join(" + ")
  };
}

export function isRadialMenuConfigured(menu) {
  return Boolean(menu?.enabled && normalizeRadialTrigger(menu?.trigger));
}

export function formatRadialActionLabel(action) {
  const normalized = normalizeRadialAction(action);
  return normalized?.label || "";
}

export function formatMouseButtonLabel(button) {
  return {
    1: "Mouse Left",
    2: "Mouse Right",
    3: "Mouse Middle",
    4: "Mouse Back",
    5: "Mouse Forward"
  }[button] || `Mouse ${button}`;
}

export function formatNavigationLabel(command) {
  return command === "forward" ? "Forward" : "Back";
}

export function formatKeyboardCodeLabel(code, modifiers = []) {
  const modifierLabels = { CTRL: "Ctrl", ALT: "Alt", SHIFT: "Shift", META: "Win" };
  const keyLabels = {
    ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl",
    AltLeft: "Left Alt", AltRight: "Right Alt",
    ShiftLeft: "Left Shift", ShiftRight: "Right Shift",
    MetaLeft: "Left Win", MetaRight: "Right Win"
  };
  const displayCode = code
    ? keyLabels[code] || code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ")
    : "";
  return [...modifiers.map((modifier) => modifierLabels[modifier] || modifier), displayCode].join(" + ");
}

export function domCodeToActionKey(code) {
  if (typeof code !== "string") return "";
  return RECORDED_CODE_TO_ACTION_KEY.get(code) || "";
}

export function captureToRadialHotkey(code, modifiers = []) {
  const key = domCodeToActionKey(code);
  if (!key) return null;
  const modifierKeys = [...new Set(modifiers
    .map((modifier) => ({ CTRL: "Control", ALT: "Alt", SHIFT: "Shift", META: "Meta" }[modifier]))
    .filter(Boolean))];
  return normalizeRadialAction({
    type: "hotkey",
    keys: [...modifierKeys, key],
    label: formatKeyboardCodeLabel(code, modifiers)
  });
}

function normalizeLabel(value) {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
}
