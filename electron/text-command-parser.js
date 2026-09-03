const KEY_NOTATION_PATTERN = /\[([^\[\]\r\n]+)\]/g;
const KEY_SEPARATOR_PATTERN = /\s*\+\s*|\s+plus\s+/i;

const KEY_ALIASES = new Map([
  ["control", "Control"],
  ["ctrl", "Control"],
  ["controlleft", "Control"],
  ["controlright", "Control"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["altleft", "Alt"],
  ["altright", "Alt"],
  ["shift", "Shift"],
  ["shiftleft", "Shift"],
  ["shiftright", "Shift"],
  ["meta", "Meta"],
  ["super", "Meta"],
  ["superkey", "Meta"],
  ["win", "Meta"],
  ["windows", "Meta"],
  ["command", "Meta"],
  ["cmd", "Meta"],
  ["enter", "Enter"],
  ["return", "Enter"],
  ["escape", "Escape"],
  ["esc", "Escape"],
  ["tab", "Tab"],
  ["space", "Space"],
  ["spacebar", "Space"],
  ["backspace", "Backspace"],
  ["back", "Backspace"],
  ["delete", "Delete"],
  ["del", "Delete"],
  ["insert", "Insert"],
  ["ins", "Insert"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["page up", "PageUp"],
  ["pagedown", "PageDown"],
  ["page down", "PageDown"],
  ["arrowup", "ArrowUp"],
  ["up", "ArrowUp"],
  ["up arrow", "ArrowUp"],
  ["arrowdown", "ArrowDown"],
  ["down", "ArrowDown"],
  ["down arrow", "ArrowDown"],
  ["arrowleft", "ArrowLeft"],
  ["left", "ArrowLeft"],
  ["left arrow", "ArrowLeft"],
  ["arrowright", "ArrowRight"],
  ["right", "ArrowRight"],
  ["right arrow", "ArrowRight"],
  ["capslock", "CapsLock"],
  ["numlock", "NumLock"],
  ["scrolllock", "ScrollLock"],
  ["printscreen", "PrintScreen"],
  ["prtsc", "PrintScreen"],
  ["pause", "Pause"],
  ["break", "Pause"],
  ["contextmenu", "ContextMenu"],
  ["menu", "ContextMenu"],
  ["minus", "-"],
  ["comma", ","],
  ["period", "."],
  ["dot", "."],
  ["slash", "/"],
  ["backslash", "\\"],
  ["semicolon", ";"],
  ["apostrophe", "'"],
  ["quote", "'"],
  ["backtick", "`"],
  ["grave", "`"],
  ["equals", "="],
  ["leftbracket", "["],
  ["rightbracket", "]"]
]);

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);
const NAMED_ACTION_KEYS = new Set([
  "Enter",
  "Escape",
  "Tab",
  "Space",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "PrintScreen",
  "Pause",
  "ContextMenu"
]);
const PRINTABLE_COMBINATION_KEYS = new Set([";", "=", ",", "-", ".", "/", "`", "[", "\\", "]", "'"]);

export function parseTextCommands(text) {
  if (typeof text !== "string" || !text) return [];

  const commands = [];
  let cursor = 0;
  for (const match of text.matchAll(KEY_NOTATION_PATTERN)) {
    const start = match.index ?? cursor;
    const keyCommand = parseKeyNotation(match[1]);
    if (!keyCommand) continue;

    if (start > cursor) commands.push({ type: "text", value: text.slice(cursor, start) });
    commands.push(keyCommand);
    cursor = start + match[0].length;
  }
  if (cursor < text.length) commands.push({ type: "text", value: text.slice(cursor) });
  return commands;
}

export function parseKeyNotation(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const parts = value.split(KEY_SEPARATOR_PATTERN).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;

  const keys = parts.map(normalizeKeyToken);
  if (keys.some((key) => !key)) return null;
  if (keys.length === 1) {
    return isStandaloneActionKey(keys[0]) ? { type: "key", keys } : null;
  }
  if (!keys.slice(0, -1).every((key) => MODIFIER_KEYS.has(key))) return null;
  if (new Set(keys.slice(0, -1)).size !== keys.length - 1) return null;
  if (!isCombinationKey(keys.at(-1))) return null;
  return { type: "key", keys };
}

function normalizeKeyToken(value) {
  const normalized = value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (!normalized) return null;
  if (KEY_ALIASES.has(normalized)) return KEY_ALIASES.get(normalized);
  if (/^key[a-z]$/i.test(normalized)) return normalized.slice(-1).toUpperCase();
  if (/^digit[0-9]$/i.test(normalized)) return normalized.slice(-1);
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(normalized)) return normalized.toUpperCase();
  if (/^numpad(?:[0-9]|multiply|add|subtract|decimal|divide)$/i.test(normalized)) {
    return `Numpad${normalized.slice(6, 7).toUpperCase()}${normalized.slice(7).toLowerCase()}`;
  }
  if (normalized.length === 1) {
    if (/[a-z]/i.test(normalized)) return normalized.toUpperCase();
    if (/[0-9]/.test(normalized) || PRINTABLE_COMBINATION_KEYS.has(normalized)) return normalized;
  }
  return null;
}

function isStandaloneActionKey(key) {
  return NAMED_ACTION_KEYS.has(key)
    || /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)
    || /^Numpad(?:[0-9]|Multiply|Add|Subtract|Decimal|Divide)$/.test(key);
}

function isCombinationKey(key) {
  return isStandaloneActionKey(key)
    || /^[A-Z0-9]$/.test(key)
    || PRINTABLE_COMBINATION_KEYS.has(key);
}
