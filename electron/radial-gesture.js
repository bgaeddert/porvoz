export const RADIAL_MENU_HOLD_DELAY_MS = 200;

// Separates the trigger's physical hold from the overlay lifecycle. A release
// before the delay is the center action; a release after the delay commits the
// selection reported by the overlay.
export function createRadialGesture({
  onOpen,
  onCenterRelease,
  onSelectionRelease,
  delayMs = RADIAL_MENU_HOLD_DELAY_MS,
  schedule = setTimeout,
  unschedule = clearTimeout
} = {}) {
  let pressed = false;
  let opened = false;
  let timer;

  const clearTimer = () => {
    if (timer === undefined) return;
    unschedule(timer);
    timer = undefined;
  };

  return {
    press() {
      if (pressed) return false;
      pressed = true;
      opened = false;
      clearTimer();
      timer = schedule(() => {
        timer = undefined;
        if (!pressed || opened) return;
        opened = true;
        onOpen?.();
      }, delayMs);
      return true;
    },
    release() {
      if (!pressed) return false;
      pressed = false;
      clearTimer();
      const wasOpened = opened;
      opened = false;
      if (wasOpened) onSelectionRelease?.();
      else onCenterRelease?.();
      return true;
    },
    cancel() {
      const wasActive = pressed || opened || timer !== undefined;
      pressed = false;
      opened = false;
      clearTimer();
      return wasActive;
    },
    isPressed: () => pressed,
    isOpened: () => opened
  };
}
