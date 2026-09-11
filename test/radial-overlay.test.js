import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRadialOverlay, RADIAL_OVERLAY_SIZE } from "../electron/radial-overlay.js";

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.webContents = { send: (...args) => (this.sent ||= []).push(args) };
    this.visible = false;
    this.destroyed = false;
    this.size = [options.width, options.height];
  }
  setAlwaysOnTop(value) { this.alwaysOnTop = value; }
  setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
  setFocusable(value) { this.focusable = value; }
  getContentSize() { return this.size; }
  setPosition(x, y) { this.position = [x, y]; }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; }
  loadFile() { return Promise.resolve(); }
  destroy() { this.destroyed = true; this.emit("closed"); }
}

class FakeScreen extends EventEmitter {
  getCursorScreenPoint() { return { x: 100, y: 100 }; }
  getDisplayNearestPoint() { return this.getPrimaryDisplay(); }
  getPrimaryDisplay() { return { workArea: { x: 0, y: 0, width: 1200, height: 800 } }; }
}

test("the radial overlay opens at the cursor, tracks a slot, and commits on release", async () => {
  let browserWindow;
  class BrowserWindowFactory extends FakeWindow {
    constructor(options) {
      super(options);
      browserWindow = this;
    }
  }
  const screen = new FakeScreen();
  const overlay = await createRadialOverlay({
    overlayPath: "radial-overlay.html",
    preloadPath: "radial-overlay-preload.cjs",
    BrowserWindowImpl: BrowserWindowFactory,
    screenApi: screen,
    secureWindow: () => {}
  });

  const menu = { enabled: true, trigger: { kind: "keyboard", code: "F9" }, slots: [] };
  assert.equal(browserWindow.visible, true);
  assert.equal(browserWindow.ignoresMouse, true);
  assert.equal(overlay.open(menu), true);
  assert.equal(overlay.isOpen(), true);
  assert.equal(browserWindow.visible, true);
  assert.equal(browserWindow.ignoresMouse, false);
  assert.deepEqual(browserWindow.size, [RADIAL_OVERLAY_SIZE, RADIAL_OVERLAY_SIZE]);
  assert.deepEqual(browserWindow.position, [8, 8]);
  assert.equal(overlay.isSender(browserWindow.webContents), true);
  assert.equal(overlay.select("4"), true);
  assert.equal(overlay.getSelectedSlot(), "4");
  assert.equal(overlay.commit(), "4");
  assert.equal(overlay.isOpen(), false);
  assert.equal(browserWindow.visible, true);
  assert.equal(browserWindow.ignoresMouse, true);
  assert.ok(browserWindow.sent.some(([channel, value]) => channel === "porvoz:radial-open"
    && JSON.stringify(value.menu) === JSON.stringify(menu)));
  assert.ok(browserWindow.sent.some(([channel, value]) => channel === "porvoz:radial-selection" && value.slotId === "4"));
  assert.equal(browserWindow.options.webPreferences.backgroundThrottling, false);

  overlay.open(menu);
  overlay.select("outside");
  assert.equal(overlay.commit(), "outside");
  overlay.open(menu);
  assert.equal(overlay.cancel(), true);
  assert.equal(overlay.isOpen(), false);
  overlay.destroy();
});
