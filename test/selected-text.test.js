import assert from "node:assert/strict";
import test from "node:test";
import { createSelectedTextReader, normalizeSelectedText } from "../electron/selected-text.js";

test("selected text is read through the supplied clipboard copy transaction", async () => {
  let reads = 0;
  let suppliedOptions;
  const reader = createSelectedTextReader({
    async readSelection(options) {
      reads += 1;
      suppliedOptions = options;
      return "selected from the focused application";
    }
  });

  const options = { target: 123 };
  assert.equal(await reader.read(options), "selected from the focused application");
  assert.equal(reads, 1);
  assert.equal(suppliedOptions, options);
  reader.dispose();
});

test("selected text is normalized and bounded", async () => {
  const oversized = `\0  selected text  ${"x".repeat(210_000)}`;
  const reader = createSelectedTextReader({ readSelection: async () => oversized });

  const selected = await reader.read();
  assert.equal(selected.includes("\0"), false);
  assert.equal(selected.length, 200_000);
  assert.equal(normalizeSelectedText(null), "");
});

test("selected-text transaction failures fail closed", async () => {
  const reader = createSelectedTextReader({
    readSelection: async () => { throw new Error("copy unavailable"); }
  });

  assert.equal(await reader.read(), "");
});

test("a selected-text transaction is required", () => {
  assert.throws(
    () => createSelectedTextReader({ readSelection: null }),
    /selected-text transaction/
  );
});
