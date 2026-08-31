const ENTER_COMMAND_PATTERN = /\[enter\]/gi;

export function parseTextCommands(text) {
  if (typeof text !== "string" || !text) return [];

  const commands = [];
  let cursor = 0;
  for (const match of text.matchAll(ENTER_COMMAND_PATTERN)) {
    const start = match.index ?? cursor;
    if (start > cursor) {
      commands.push({ type: "text", value: text.slice(cursor, start) });
    }
    commands.push({ type: "enter" });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    commands.push({ type: "text", value: text.slice(cursor) });
  }
  return commands;
}
