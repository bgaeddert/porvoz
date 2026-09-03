import assert from "node:assert/strict";
import test from "node:test";
import { getUniquePrefixName, parsePrefix, serializePrefix } from "../public/prefix-transfer.js";

test("prefix JSON is portable and excludes its internal id", () => {
  const serialized = serializePrefix({
    id: "prefix-7",
    name: "  tidy ",
    instruction: "  Make it concise. ",
    allowSearch: true,
    allowClipboard: false
  });

  assert.deepEqual(JSON.parse(serialized), {
    name: "tidy",
    instruction: "Make it concise.",
    allowSearch: true,
    allowClipboard: false
  });
});

test("prefix JSON accepts the copied shape and creates a new entry", () => {
  assert.deepEqual(parsePrefix(JSON.stringify({
    name: "tidy",
    instruction: "Make it concise.",
    allowSearch: true,
    allowClipboard: false
  })), {
    state: "valid",
    prefix: {
      id: "",
      name: "tidy",
      instruction: "Make it concise.",
      allowSearch: true,
      allowClipboard: false
    }
  });
});

test("prefix JSON rejects malformed fields and unknown fields", () => {
  assert.equal(parsePrefix("{not json}").state, "invalid");
  assert.equal(parsePrefix(JSON.stringify({ name: "tidy" })).state, "invalid");
  assert.equal(parsePrefix(JSON.stringify({
    name: "tidy",
    instruction: "Make it concise.",
    allowSearch: "yes"
  })).state, "invalid");
  assert.equal(parsePrefix(JSON.stringify({
    name: "tidy",
    instruction: "Make it concise.",
    extra: true
  })).state, "invalid");
  assert.equal(parsePrefix("ordinary text").state, "not-prefix");
});

test("duplicate prefix names get a readable unique suffix", () => {
  const prefixes = [{ name: "tidy" }, { name: "tidy duplicate" }];

  assert.equal(getUniquePrefixName("tidy", prefixes), "tidy duplicate 2");
  assert.equal(getUniquePrefixName("other", prefixes), "other");
});

test("duplicate names stay within the configured name limit", () => {
  assert.equal(getUniquePrefixName("a very long prefix", [{ name: "a very long prefix" }], 20), "a very lon duplicate");
});
