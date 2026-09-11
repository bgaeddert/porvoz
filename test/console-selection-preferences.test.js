import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createDesktopPreferences } from "../electron/desktop-preferences.js";

test("console selection defaults off for new and existing desktops, persists, and resets off", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "porvoz-console-preferences-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const preferencesPath = path.join(directory, "preferences.json");
  const load = () => createDesktopPreferences({ preferencesPath });
  let preferences = load();
  assert.equal(preferences.getConsoleSelectionEnabled(), false);
  writeFileSync(preferencesPath, JSON.stringify({ soundVolume: 0.7, hotkey: { key: "F9", modifiers: [], label: "F9" } }));
  preferences = load();
  assert.equal(preferences.getConsoleSelectionEnabled(), false);
  assert.equal(preferences.saveConsoleSelectionEnabled(true), true);
  preferences = load();
  assert.equal(preferences.getConsoleSelectionEnabled(), true);
  assert.equal(preferences.getSoundVolume(), 0.7);
  assert.equal(preferences.getHotkey().key, "F9");
  const radialMenu = {
    enabled: true,
    trigger: { kind: "mouse", button: 4 },
    slots: [{ id: "1", label: "Back", action: { type: "navigation", command: "back" } }]
  };
  preferences.saveRadialMenu(radialMenu);
  assert.equal(load().getRadialMenu().trigger.button, 4);
  assert.equal(load().getRadialMenu().slots[0].action.command, "back");
  assert.throws(() => preferences.saveConsoleSelectionEnabled("false"), /on or off/);
  assert.equal(preferences.getConsoleSelectionEnabled(), true);
  preferences.resetCaptureSettings();
  assert.equal(load().getConsoleSelectionEnabled(), false);
  assert.equal(load().getRadialMenu().enabled, false);
  assert.equal(load().getRadialMenu().trigger, null);
});
