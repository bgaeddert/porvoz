import { BrowserWindow, screen } from "electron";

const OVERLAY_WIDTH = 500;
const OVERLAY_HEIGHT = 78;
const OVERLAY_BOTTOM_MARGIN = 18;
const SUCCESS_DISPLAY_MS = 1600;
const ERROR_DISPLAY_MS = 4200;

/**
 * Creates the non-activating status pill shown above the active display's
 * work-area edge. The overlay is intentionally kept separate from the main
 * application window so it remains available while Porvoz is hidden to the
 * tray and can never become the typing target.
 */
export async function createStatusOverlay({ overlayPath, preloadPath, secureWindow } = {}) {
  if (typeof overlayPath !== "string" || !overlayPath) {
    throw new Error("The status overlay page path is required.");
  }
  if (typeof preloadPath !== "string" || !preloadPath) {
    throw new Error("The status overlay preload path is required.");
  }

  let overlayWindow;
  let isLoaded = false;
  let hideTimer;
  let currentStatus = { state: "idle", message: "" };

  overlayWindow = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    show: false,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath
    }
  });

  secureWindow?.(overlayWindow);
  overlayWindow.setAlwaysOnTop(true);
  overlayWindow.setIgnoreMouseEvents(true);
  try {
    overlayWindow.setFocusable(false);
  } catch {
    // Some Linux window managers do not expose this flag through Electron.
  }

  const reposition = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;

    let display;
    try {
      display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    } catch {
      display = screen.getPrimaryDisplay();
    }

    const workArea = display.workArea;
    const [width, height] = overlayWindow.getContentSize();
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + workArea.height - height - OVERLAY_BOTTOM_MARGIN);
    overlayWindow.setPosition(x, y, false);
  };

  const hide = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.hide();
  };

  const showCurrentStatus = () => {
    if (!isLoaded || !overlayWindow || overlayWindow.isDestroyed()) return;
    clearTimeout(hideTimer);
    reposition();
    overlayWindow.webContents.send("porvoz:overlay-status", currentStatus);
    overlayWindow.setAlwaysOnTop(true);
    overlayWindow.showInactive();

    if (currentStatus.state === "success" || currentStatus.state === "error") {
      const delay = currentStatus.state === "error" ? ERROR_DISPLAY_MS : SUCCESS_DISPLAY_MS;
      hideTimer = setTimeout(hide, delay);
      hideTimer.unref?.();
    }
  };

  const setStatus = (value = {}) => {
    const state = ["recording", "transcribing", "processing", "typing", "success", "error"].includes(value.state)
      ? value.state
      : "idle";
    const sourceMessage = typeof value.message === "string" ? value.message.trim() : "";
    const stage = typeof value.stage === "string" ? value.stage.trim().toLocaleLowerCase() : "";
    const message = compactStatusMessage(state, sourceMessage, stage);
    currentStatus = { state, message };

    if (state === "idle" || !message) {
      clearTimeout(hideTimer);
      hide();
      return;
    }
    showCurrentStatus();
  };

  const onDisplayChanged = () => {
    if (currentStatus.state !== "idle") reposition();
  };
  screen.on("display-added", onDisplayChanged);
  screen.on("display-removed", onDisplayChanged);
  screen.on("display-metrics-changed", onDisplayChanged);

  overlayWindow.on("closed", () => {
    clearTimeout(hideTimer);
    screen.off("display-added", onDisplayChanged);
    screen.off("display-removed", onDisplayChanged);
    screen.off("display-metrics-changed", onDisplayChanged);
    overlayWindow = undefined;
  });

  await overlayWindow.loadFile(overlayPath);
  isLoaded = true;

  return {
    setStatus,
    clear() {
      clearTimeout(hideTimer);
      currentStatus = { state: "idle", message: "" };
      hide();
    },
    destroy() {
      clearTimeout(hideTimer);
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
    }
  };
}

function compactStatusMessage(state, sourceMessage, stage) {
  if (!sourceMessage) return "";
  if (state === "recording") return "Recording…";
  if (state === "transcribing") return "Transcribing…";
  if (state === "processing") {
    return /instruction/i.test(sourceMessage) ? "Applying instructions…" : "Processing…";
  }
  if (state === "typing") return "Placing text…";
  if (state === "success") return "Done.";
  if (state === "error") return compactErrorMessage(sourceMessage, stage);
  return sourceMessage;
}

function compactErrorMessage(sourceMessage, stage) {
  if (stage === "recording") return "Recording failed.";
  if (stage === "transcription") return "Transcription failed.";
  if (stage === "instruction") return "Instruction failed.";
  if (stage === "typing") return "Could not place text.";
  if (stage === "models") return "Could not load models.";
  if (stage === "configuration") return "Setup needs attention.";
  if (/transcrib/i.test(sourceMessage)) return "Transcription failed.";
  if (/microphone|record|audio/i.test(sourceMessage)) return "Recording failed.";
  if (/instruction|model|prefix/i.test(sourceMessage)) return "Instruction failed.";
  if (/type|place|target|clipboard|hotkey/i.test(sourceMessage)) return "Could not place text.";
  return "Action failed.";
}
