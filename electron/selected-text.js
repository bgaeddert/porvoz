const MAX_SELECTED_TEXT_CHARACTERS = 200_000;

export function createSelectedTextReader({
  readSelection = async () => ""
} = {}) {
  if (typeof readSelection !== "function") {
    throw new TypeError("A selected-text transaction is required.");
  }
  return {
    async read(options) {
      try {
        return normalizeSelectedText(await readSelection(options));
      } catch {
        return "";
      }
    },
    dispose() {}
  };
}

export function normalizeSelectedText(value) {
  if (typeof value !== "string") return "";
  const text = value.replaceAll("\0", "").slice(0, MAX_SELECTED_TEXT_CHARACTERS);
  return text.trim() ? text : "";
}
