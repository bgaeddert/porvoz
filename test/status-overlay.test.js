import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createStatusOverlay } from "../electron/status-overlay.js";

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.size = [options.width, options.height];
    this.sent = [];
    this.visible = false;
    this.destroyed = false;
    this.webContents = { send: (...args) => this.sent.push(args) };
  }
  setAlwaysOnTop() {}
  setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
  setFocusable(value) { this.focusable = value; }
  getContentSize() { return this.size; }
  setContentSize(width, height) { this.size = [width, height]; }
  setPosition(x, y) { this.position = [x, y]; }
  isDestroyed() { return this.destroyed; }
  hide() { this.visible = false; this.hideCount = (this.hideCount || 0) + 1; }
  showInactive() { this.visible = true; this.showCount = (this.showCount || 0) + 1; }
  loadFile() { return Promise.resolve(); }
  destroy() { this.destroyed = true; this.emit("closed"); }
}

class FakeScreen extends EventEmitter {
  getCursorScreenPoint() { return { x: 100, y: 100 }; }
  getDisplayNearestPoint() { return this.getPrimaryDisplay(); }
  getPrimaryDisplay() { return { workArea: { x: 0, y: 0, width: 1200, height: 800 } }; }
}

test("hovering the pill can hold and dismiss the response panel", async () => {
  let browserWindow;
  class BrowserWindowFactory extends FakeWindow {
    constructor(options) {
      super(options);
      browserWindow = this;
    }
  }
  const overlay = await createStatusOverlay({
    overlayPath: "overlay.html",
    preloadPath: "preload.cjs",
    BrowserWindowImpl: BrowserWindowFactory,
    screenApi: new FakeScreen()
  });

  assert.equal(browserWindow.ignoresMouse, false);
  assert.equal(browserWindow.focusable, false);
  overlay.setStatus({ state: "recording", message: "Recording" });
  assert.equal(overlay.holdIfHovered(), false);
  overlay.setPointerOver(true);
  assert.deepEqual(browserWindow.size, [360, 238]);
  assert.equal(overlay.holdIfHovered(), true);
  overlay.setResponse("latest Porvoz output");
  assert.equal(overlay.getResponse(), "latest Porvoz output");
  assert.deepEqual(browserWindow.sent.at(-1), [
    "porvoz:overlay-response",
    { open: true, text: "latest Porvoz output" }
  ]);

  overlay.setStatus({ state: "idle" });
  assert.equal(browserWindow.visible, true);
  assert.ok(browserWindow.sent.some(([channel, value]) =>
    channel === "porvoz:overlay-status" && value.state === "waiting"));

  overlay.dismiss();
  assert.equal(browserWindow.visible, false);
  assert.deepEqual(browserWindow.size, [360, 44]);
  const showCount = browserWindow.showCount;
  overlay.setStatus({ state: "success", message: "Done" });
  assert.equal(browserWindow.showCount, showCount);
  overlay.setStatus({ state: "recording", message: "Recording" });
  assert.equal(browserWindow.visible, true);
  overlay.destroy();
});

test("hovering immediately opens the response panel during every visible status", async (context) => {
  const statuses = ["recording", "waiting", "transcribing", "processing", "typing", "success", "error"];

  for (const state of statuses) {
    await context.test(state, async () => {
      let browserWindow;
      class BrowserWindowFactory extends FakeWindow {
        constructor(options) {
          super(options);
          browserWindow = this;
        }
      }
      const overlay = await createStatusOverlay({
        overlayPath: "overlay.html",
        preloadPath: "preload.cjs",
        BrowserWindowImpl: BrowserWindowFactory,
        screenApi: new FakeScreen()
      });

      overlay.setStatus({ state, message: `${state} status` });
      overlay.setPointerOver(true);

      assert.deepEqual(browserWindow.size, [360, 238]);
      assert.ok(browserWindow.sent.some(([channel, value]) =>
        channel === "porvoz:overlay-response" && value.open === true));
      overlay.destroy();
    });
  }
});

test("the overlay renderer exposes copy and dismiss controls", () => {
  const html = readFileSync(new URL("../public/status-overlay.html", import.meta.url), "utf8");
  const preload = readFileSync(new URL("../electron/status-overlay-preload.cjs", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const overlayRenderer = readFileSync(new URL("../public/status-overlay.js", import.meta.url), "utf8");

  assert.match(html, /id="copy-response"/);
  assert.match(html, /id="dismiss-response"/);
  assert.match(html, /script type="module"/);
  assert.match(preload, /porvoz:overlay-copy/);
  assert.match(preload, /porvoz:overlay-open-external/);
  assert.match(preload, /porvoz:overlay-dismiss/);
  assert.match(overlayRenderer, /pill\.addEventListener\("mouseenter"/);
  assert.match(app, /mimeType: audio\.type,\s+captureId/);
});
