import { MINIMUM_RECORDING_DURATION_MS } from "../public/capture-policy.js";

// A tap never starts recording. Require the entire chord to be released before
// accepting another press, including modifier-only hotkeys in either order.
export function createHotkeyGesture({ onHold, onRelease, onDoubleTap,
  now = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let timer;
  let pressed = false;
  let ready = true;
  let held = false;
  let previousTap;
  let secondTap = false;

  return {
    press() {
      if (!ready) return;
      ready = false;
      pressed = true;
      secondTap = previousTap !== undefined && now() - previousTap <= 400;
      timer = schedule(() => {
        timer = undefined;
        held = true;
        previousTap = undefined;
        return onHold();
      }, MINIMUM_RECORDING_DURATION_MS);
    },
    release(allReleased) {
      if (pressed) {
        pressed = false;
        unschedule(timer);
        timer = undefined;
        if (held) {
          held = false;
          onRelease();
        } else if (secondTap) {
          previousTap = undefined;
          onDoubleTap();
        } else {
          previousTap = now();
        }
      }
      if (allReleased) ready = true;
    },
    cancel() {
      unschedule(timer);
      timer = undefined;
      pressed = false;
      held = false;
      previousTap = undefined;
      // A canceled chord must still be released before it can be used again.
    }
  };
}
