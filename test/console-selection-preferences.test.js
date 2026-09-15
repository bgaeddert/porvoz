import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createDesktopPreferences } from "../electron/desktop-preferences.js";

test("capture preferences keep terminal copy separate from selection capture", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "porvoz-console-preferences-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const preferencesPath = path.join(directory, "preferences.json");
  const load = () => createDesktopPreferences({ preferencesPath });
  let preferences = load();
  assert.equal(preferences.getConsoleSelectionEnabled(), false);
  assert.equal(preferences.getSelectionCaptureEnabled(), true);
  writeFileSync(preferencesPath, JSON.stringify({ soundVolume: 0.7, hotkey: { key: "F9", modifiers: [], label: "F9" } }));
  preferences = load();
  assert.equal(preferences.getConsoleSelectionEnabled(), false);
  assert.equal(preferences.getSelectionCaptureEnabled(), true);
  assert.equal(preferences.saveConsoleSelectionEnabled(true), true);
  assert.equal(preferences.saveSelectionCaptureEnabled(false), false);
  preferences = load();
  assert.equal(preferences.getConsoleSelectionEnabled(), true);
  assert.equal(preferences.getSelectionCaptureEnabled(), false);
  assert.equal(preferences.getSoundVolume(), 0.7);
  assert.equal(preferences.getHotkey().key, "F9");
  const radialMenu = {
    enabled: true,
    trigger: { kind: "mouse", button: 4 },
    scale: 0.5,
    slots: [{ id: "1", label: "Back", action: { type: "navigation", command: "back" } }]
  };
  preferences.saveRadialMenu(radialMenu);
  assert.equal(load().getRadialMenu().trigger.button, 4);
  assert.equal(load().getRadialMenu().scale, 0.5);
  assert.equal(load().getRadialMenu().slots[0].action.command, "back");
  assert.throws(() => preferences.saveConsoleSelectionEnabled("false"), /on or off/);
  assert.throws(() => preferences.saveSelectionCaptureEnabled("false"), /on or off/);
  assert.equal(preferences.getConsoleSelectionEnabled(), true);
  assert.equal(preferences.getSelectionCaptureEnabled(), false);
  preferences.resetCaptureSettings();
  assert.equal(load().getConsoleSelectionEnabled(), false);
  assert.equal(load().getSelectionCaptureEnabled(), true);
  assert.equal(load().getRadialMenu().enabled, false);
  assert.equal(load().getRadialMenu().trigger, null);
});
