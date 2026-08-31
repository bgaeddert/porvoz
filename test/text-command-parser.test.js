import test from "node:test";
import assert from "node:assert/strict";
import { parseTextCommands } from "../electron/text-command-parser.js";

test("text command parser preserves text and turns Enter tokens into commands", () => {
  assert.deepEqual(parseTextCommands("first[enter]second[ENTER][enter]last"), [
    { type: "text", value: "first" },
    { type: "enter" },
    { type: "text", value: "second" },
    { type: "enter" },
    { type: "enter" },
    { type: "text", value: "last" }
  ]);
});

test("text command parser leaves ordinary bracketed text unchanged", () => {
  assert.deepEqual(parseTextCommands("use [return] here"), [
    { type: "text", value: "use [return] here" }
  ]);
});
