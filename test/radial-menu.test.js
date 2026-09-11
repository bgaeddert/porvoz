import assert from "node:assert/strict";
import test from "node:test";
import {
  RADIAL_SLOT_DEFINITIONS,
  captureToRadialHotkey,
  createDefaultRadialMenu,
  domCodeToActionKey,
  normalizeRadialAction,
  normalizeRadialMenu,
  normalizeRadialTrigger
} from "../electron/radial-menu.js";

test("the default radial menu has twelve clockwise slots and a center slot", () => {
  const menu = createDefaultRadialMenu();
  assert.equal(menu.enabled, false);
  assert.equal(menu.trigger, null);
  assert.equal(menu.scale, 1);
  assert.equal(menu.slots.length, 13);
  assert.deepEqual(RADIAL_SLOT_DEFINITIONS[0], { id: "1", number: 1, position: "12 o'clock" });
  assert.deepEqual(RADIAL_SLOT_DEFINITIONS.at(-1), { id: "center", number: 13, position: "Center" });
  assert.ok(menu.slots.every((slot) => slot.action === null && slot.label === ""));
});

test("radial settings normalize trigger, labels, keyboard shortcuts, and navigation", () => {
  const menu = normalizeRadialMenu({
    enabled: true,
    trigger: { kind: "keyboard", code: "MetaLeft", modifiers: ["ctrl", "META"], label: "" },
    slots: [
      { id: "1", label: "  Copy  ", action: { type: "hotkey", keys: ["Control", "C", "C"] } },
      { id: "center", action: { type: "navigation", command: "FORWARD" } },
      { id: "not-a-slot", label: "ignored", action: { type: "navigation", command: "back" } }
    ]
  });

  assert.equal(menu.trigger.label, "Ctrl + Win + Left Win");
  assert.deepEqual(menu.slots[0], {
    id: "1", label: "Copy", action: { type: "hotkey", keys: ["Control", "C"], label: "Control + C" }
  });
  assert.deepEqual(menu.slots.at(-1).action, { type: "navigation", command: "forward", label: "Forward" });
  assert.equal(menu.slots[1].action, null);
});

test("radial menu size is constrained to the supported scale range", () => {
  assert.equal(normalizeRadialMenu({ scale: 0.25 }).scale, 0.5);
  assert.equal(normalizeRadialMenu({ scale: 0.75 }).scale, 0.75);
  assert.equal(normalizeRadialMenu({ scale: 2 }).scale, 1);
  assert.equal(normalizeRadialMenu({ scale: "invalid" }).scale, 1);
});

test("recorded DOM codes become sendable key combinations, including Windows", () => {
  assert.equal(domCodeToActionKey("KeyR"), "R");
  assert.equal(domCodeToActionKey("Space"), "Space");
  assert.equal(domCodeToActionKey("MetaLeft"), "Meta");
  assert.deepEqual(captureToRadialHotkey("KeyR", ["CTRL", "META"]), {
    type: "hotkey",
    keys: ["Control", "Meta", "R"],
    label: "Ctrl + Win + R"
  });
  assert.equal(captureToRadialHotkey("UnknownKey", []), null);
  assert.deepEqual(normalizeRadialAction({ type: "navigation", command: "back" }), {
    type: "navigation", command: "back", label: "Back"
  });
  assert.equal(normalizeRadialAction({ type: "hotkey", keys: ["NotAKey"] }), null);
});

test("radial triggers accept keyboard and mouse buttons without enabling them implicitly", () => {
  assert.deepEqual(normalizeRadialTrigger({ kind: "mouse", button: 4 }), {
    kind: "mouse", button: 4, modifiers: [], label: "Mouse Back"
  });
  assert.equal(normalizeRadialTrigger({ kind: "mouse", button: 9 }), null);
  assert.equal(normalizeRadialTrigger({ kind: "keyboard", code: "NotAKey" }), null);
  assert.equal(normalizeRadialMenu({ enabled: true }).trigger, null);
});
