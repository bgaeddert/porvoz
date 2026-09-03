import test from "node:test";
import assert from "node:assert/strict";
import { parseTextCommands } from "../electron/text-command-parser.js";

test("text command parser turns key notation into key commands", () => {
  assert.deepEqual(parseTextCommands("first[enter]second[Escape][Control+F][Control + Shift + F2]last"), [
    { type: "text", value: "first" },
    { type: "key", keys: ["Enter"] },
    { type: "text", value: "second" },
    { type: "key", keys: ["Escape"] },
    { type: "key", keys: ["Control", "F"] },
    { type: "key", keys: ["Control", "Shift", "F2"] },
    { type: "text", value: "last" }
  ]);
});

test("text command parser accepts spoken plus separators and key aliases", () => {
  assert.deepEqual(parseTextCommands("[control plus alt plus delete][super+shift+s][return][page up]"), [
    { type: "key", keys: ["Control", "Alt", "Delete"] },
    { type: "key", keys: ["Meta", "Shift", "S"] },
    { type: "key", keys: ["Enter"] },
    { type: "key", keys: ["PageUp"] }
  ]);
});

test("text command parser leaves ordinary bracketed text unchanged", () => {
  assert.deepEqual(parseTextCommands("use [returning], [not a key], and array[0] here"), [
    { type: "text", value: "use [returning], [not a key], and array[0] here" }
  ]);
});

test("text command parser rejects unknown keys and malformed combinations", () => {
  assert.deepEqual(parseTextCommands("[Control+Banana][Control+Control+F][F25]"), [
    { type: "text", value: "[Control+Banana][Control+Control+F][F25]" }
  ]);
});
