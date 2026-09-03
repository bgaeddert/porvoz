const PREFIX_FIELDS = new Set([
  "id",
  "name",
  "instruction",
  "allowSearch",
  "allowClipboard"
]);

export function serializePrefix(prefix) {
  // IDs are local registry metadata; an import should always create a new entry.
  return JSON.stringify({
    name: typeof prefix?.name === "string" ? prefix.name.trim() : "",
    instruction: typeof prefix?.instruction === "string" ? prefix.instruction.trim() : "",
    allowSearch: prefix?.allowSearch === true,
    allowClipboard: prefix?.allowClipboard === true
  }, null, 2);
}

export function parsePrefix(text) {
  if (typeof text !== "string") return { state: "not-prefix" };

  const trimmedText = text.trim();
  if (!trimmedText.startsWith("{")) return { state: "not-prefix" };

  let value;
  try {
    value = JSON.parse(trimmedText);
  } catch {
    return { state: "invalid", message: "The pasted text is not valid prefix JSON." };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { state: "invalid", message: "Paste one prefix JSON object at a time." };
  }

  if (Object.keys(value).some((key) => !PREFIX_FIELDS.has(key))) {
    return { state: "invalid", message: "That JSON has fields Porvoz cannot use for a prefix." };
  }

  if (typeof value.name !== "string" || typeof value.instruction !== "string") {
    return { state: "invalid", message: "A prefix needs a text name and text instruction." };
  }

  if (("id" in value && typeof value.id !== "string")
    || ("allowSearch" in value && typeof value.allowSearch !== "boolean")
    || ("allowClipboard" in value && typeof value.allowClipboard !== "boolean")) {
    return { state: "invalid", message: "Prefix access fields must be boolean values." };
  }

  return {
    state: "valid",
    prefix: {
      id: "",
      name: value.name.trim(),
      instruction: value.instruction.trim(),
      allowSearch: value.allowSearch === true,
      allowClipboard: value.allowClipboard === true
    }
  };
}

export function getUniquePrefixName(name, prefixes, maxCharacters = Infinity) {
  const usedNames = new Set((Array.isArray(prefixes) ? prefixes : [])
    .map((prefix) => typeof prefix?.name === "string" ? prefix.name.trim().toLocaleLowerCase() : "")
    .filter(Boolean));
  const normalizedName = name.trim().toLocaleLowerCase();
  if (!usedNames.has(normalizedName)) return name.trim();

  for (let duplicateNumber = 1; duplicateNumber < 10_000; duplicateNumber += 1) {
    const suffix = duplicateNumber === 1 ? " duplicate" : ` duplicate ${duplicateNumber}`;
    const availableCharacters = Number.isFinite(maxCharacters)
      ? Math.max(0, maxCharacters - suffix.length)
      : Infinity;
    const baseName = Number.isFinite(availableCharacters)
      ? name.trim().slice(0, availableCharacters).trimEnd()
      : name.trim();
    const candidate = `${baseName}${suffix}`.trim();
    if (!usedNames.has(candidate.toLocaleLowerCase())) return candidate;
  }

  return name.trim();
}
