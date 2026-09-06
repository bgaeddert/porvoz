import assert from "node:assert/strict";
import test from "node:test";
import { createHotkeyGesture } from "../electron/hotkey-gesture.js";

function harness() {
  let time = 0;
  let nextId = 0;
  const timers = new Map();
  const events = [];
  const gesture = createHotkeyGesture({
    onHold: () => events.push("record"),
    onRelease: () => events.push("copy-and-stop"),
    onDoubleTap: () => events.push("open"),
    now: () => time,
    schedule(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, due: time + delay });
      return id;
    },
    unschedule: (id) => timers.delete(id)
  });
  return { gesture, events, advance(ms) {
    time += ms;
    for (const [id, timer] of timers) {
      if (timer.due <= time) {
        timers.delete(id);
        timer.callback();
      }
    }
  } };
}

test("holds start at 300 ms and release exactly once after key repeats", () => {
  const { gesture, events, advance } = harness();
  gesture.press();
  advance(299);
  assert.deepEqual(events, []);
  gesture.press();
  advance(1);
  assert.deepEqual(events, ["record"]);
  gesture.release(false);
  gesture.press();
  advance(500);
  gesture.release(true);
  assert.deepEqual(events, ["record", "copy-and-stop"]);
});

test("double taps require two short presses and complete chord release", () => {
  const { gesture, events, advance } = harness();
  gesture.press();
  advance(70);
  gesture.release(false);
  gesture.press(); // One modifier remains down: this is not a second tap.
  advance(70);
  gesture.release(true);
  assert.deepEqual(events, []);
  gesture.press();
  advance(70);
  gesture.release(true);
  advance(500);
  assert.deepEqual(events, ["open"]);
});

test("a second press held to record does not open the panel", () => {
  const { gesture, events, advance } = harness();
  gesture.press();
  advance(50);
  gesture.release(true);
  gesture.press();
  advance(300);
  gesture.release(true);
  assert.deepEqual(events, ["record", "copy-and-stop"]);
});

test("isolated taps expire and Escape cancels pending hold and double tap", () => {
  const { gesture, events, advance } = harness();
  gesture.press();
  advance(50);
  gesture.release(true);
  advance(401);
  gesture.press();
  advance(50);
  gesture.release(true);
  assert.deepEqual(events, []);
  gesture.press();
  gesture.cancel();
  advance(500);
  gesture.release(true);
  gesture.press();
  advance(50);
  gesture.release(true);
  assert.deepEqual(events, []);
});
