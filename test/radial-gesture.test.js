import assert from "node:assert/strict";
import test from "node:test";
import { createRadialGesture, RADIAL_MENU_HOLD_DELAY_MS } from "../electron/radial-gesture.js";

function createTimerHarness() {
  const timers = new Map();
  return {
    schedule(callback, delay) {
      const id = { delay };
      timers.set(id, callback);
      return id;
    },
    unschedule(id) {
      timers.delete(id);
    },
    flush() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
    getTimers: () => timers
  };
}

test("a release before 200 ms activates the center without opening the wheel", () => {
  const events = [];
  const timer = createTimerHarness();
  const gesture = createRadialGesture({
    onOpen: () => events.push("open"),
    onCenterRelease: () => events.push("center"),
    onSelectionRelease: () => events.push("selection"),
    schedule: timer.schedule,
    unschedule: timer.unschedule
  });

  assert.equal(gesture.press(), true);
  assert.equal(timer.getTimers().keys().next().value.delay, RADIAL_MENU_HOLD_DELAY_MS);
  assert.equal(gesture.release(), true);
  timer.flush();

  assert.deepEqual(events, ["center"]);
  assert.equal(gesture.isPressed(), false);
  assert.equal(gesture.isOpened(), false);
});

test("holding through the delay opens the wheel and release commits its selection", () => {
  const events = [];
  const timer = createTimerHarness();
  const gesture = createRadialGesture({
    onOpen: () => events.push("open"),
    onCenterRelease: () => events.push("center"),
    onSelectionRelease: () => events.push("selection"),
    schedule: timer.schedule,
    unschedule: timer.unschedule
  });

  gesture.press();
  timer.flush();
  assert.equal(gesture.isOpened(), true);
  gesture.release();

  assert.deepEqual(events, ["open", "selection"]);
});

test("cancel prevents a pending wheel and prevents a later center action", () => {
  const events = [];
  const timer = createTimerHarness();
  const gesture = createRadialGesture({
    onOpen: () => events.push("open"),
    onCenterRelease: () => events.push("center"),
    onSelectionRelease: () => events.push("selection"),
    schedule: timer.schedule,
    unschedule: timer.unschedule
  });

  gesture.press();
  assert.equal(gesture.cancel(), true);
  timer.flush();
  assert.equal(gesture.release(), false);
  assert.deepEqual(events, []);
});
