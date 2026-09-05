import electron from "electron";

const { BrowserWindow, screen } = electron;

const OVERLAY_WIDTH = 360;
const PILL_HEIGHT = 44;
const PANEL_HEIGHT = 238;
const OVERLAY_BOTTOM_MARGIN = 12;
const SUCCESS_DISPLAY_MS = 500;
const ERROR_DISPLAY_MS = 4200;
const FADE_OUT_MS = 100;

/**
 * Creates the non-activating status pill and its optional response panel. The
 * window accepts pointer input but never focus, so hovering or copying a held
 * response does not replace the application that owns the typing target.
 */
export async function createStatusOverlay({
  overlayPath,
  preloadPath,
  secureWindow,
  BrowserWindowImpl = BrowserWindow,
  screenApi = screen
} = {}) {
  if (typeof overlayPath !== "string" || !overlayPath) {
    throw new Error("The status overlay page path is required.");
  }
  if (typeof preloadPath !== "string" || !preloadPath) {
    throw new Error("The status overlay preload path is required.");
  }

  let overlayWindow;
  let isLoaded = false;
  let hideTimer;
  let fadeTimer;
  let currentStatus = { state: "idle", message: "" };
  let lastResponse = "";
  let isPointerOver = false;
  let isResponseHeld = false;
  let suppressUntilNextRecording = false;

  overlayWindow = new BrowserWindowImpl({
    width: OVERLAY_WIDTH,
    height: PILL_HEIGHT,
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
  overlayWindow.setIgnoreMouseEvents(false);
  try {
    overlayWindow.setFocusable(false);
  } catch {
    // Some Linux window managers do not expose this flag through Electron.
  }

  const reposition = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    let display;
    try {
      display = screenApi.getDisplayNearestPoint(screenApi.getCursorScreenPoint());
    } catch {
      display = screenApi.getPrimaryDisplay();
    }
    const workArea = display.workArea;
    const [width, height] = overlayWindow.getContentSize();
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + workArea.height - height - OVERLAY_BOTTOM_MARGIN);
    overlayWindow.setPosition(x, y, false);
  };

  const resize = (expanded) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.setContentSize(OVERLAY_WIDTH, expanded ? PANEL_HEIGHT : PILL_HEIGHT, false);
    reposition();
  };

  const sendPanelState = () => {
    if (!isLoaded || !overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.send("porvoz:overlay-response", {
      open: isResponseHeld,
      text: lastResponse
    });
  };

  const hide = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    clearTimeout(fadeTimer);
    overlayWindow.hide();
  };

  const fadeAndHide = () => {
    if (!overlayWindow || overlayWindow.isDestroyed() || isResponseHeld) return;
    overlayWindow.webContents.send("porvoz:overlay-hide");
    fadeTimer = setTimeout(hide, FADE_OUT_MS);
    fadeTimer.unref?.();
  };

  const showCurrentStatus = () => {
    if (!isLoaded || !overlayWindow || overlayWindow.isDestroyed() || suppressUntilNextRecording) return;
    clearTimeout(hideTimer);
    clearTimeout(fadeTimer);
    reposition();
    overlayWindow.webContents.send("porvoz:overlay-status", currentStatus);
    sendPanelState();
    overlayWindow.setAlwaysOnTop(true);
    overlayWindow.showInactive();

    if (!isResponseHeld && (currentStatus.state === "success" || currentStatus.state === "error")) {
      const delay = currentStatus.state === "error" ? ERROR_DISPLAY_MS : SUCCESS_DISPLAY_MS;
      hideTimer = setTimeout(fadeAndHide, delay);
      hideTimer.unref?.();
    }
  };

  const setStatus = (value = {}) => {
    const state = ["recording", "waiting", "transcribing", "processing", "typing", "success", "error"]
      .includes(value.state) ? value.state : "idle";
    const sourceMessage = typeof value.message === "string" ? value.message.trim() : "";
    const stage = typeof value.stage === "string" ? value.stage.trim().toLocaleLowerCase() : "";

    if (state === "recording") suppressUntilNextRecording = false;
    currentStatus = { state, message: compactStatusMessage(state, sourceMessage, stage) };
    if (suppressUntilNextRecording) return;

    if (state === "idle" || !currentStatus.message) {
      clearTimeout(hideTimer);
      if (isResponseHeld) {
        currentStatus = { state: "waiting", message: "Waiting…" };
        showCurrentStatus();
      } else {
        hide();
      }
      return;
    }
    showCurrentStatus();
  };

  const holdResponsePanel = () => {
    if (!isPointerOver
      || suppressUntilNextRecording
      || currentStatus.state === "idle"
      || !currentStatus.message
      || !overlayWindow
      || overlayWindow.isDestroyed()) return false;
    isResponseHeld = true;
    clearTimeout(hideTimer);
    clearTimeout(fadeTimer);
    resize(true);
    showCurrentStatus();
    return true;
  };

  const onDisplayChanged = () => {
    if (currentStatus.state !== "idle" || isResponseHeld) reposition();
  };
  screenApi.on("display-added", onDisplayChanged);
  screenApi.on("display-removed", onDisplayChanged);
  screenApi.on("display-metrics-changed", onDisplayChanged);

  overlayWindow.on("closed", () => {
    clearTimeout(hideTimer);
    clearTimeout(fadeTimer);
    screenApi.off("display-added", onDisplayChanged);
    screenApi.off("display-removed", onDisplayChanged);
    screenApi.off("display-metrics-changed", onDisplayChanged);
    overlayWindow = undefined;
  });

  await overlayWindow.loadFile(overlayPath);
  isLoaded = true;

  return {
    setStatus,
    setResponse(value) {
      if (typeof value !== "string" || !value.trim()) return;
      lastResponse = value;
      sendPanelState();
    },
    getResponse: () => lastResponse,
    setPointerOver(value) {
      isPointerOver = value === true;
      if (isPointerOver) holdResponsePanel();
    },
    isPointerOver: () => isPointerOver,
    isSender(sender) {
      return Boolean(overlayWindow && !overlayWindow.isDestroyed() && sender === overlayWindow.webContents);
    },
    holdIfHovered() {
      return holdResponsePanel();
    },
    prepareForCapture() {
      suppressUntilNextRecording = false;
      if (!isResponseHeld || isPointerOver) return;
      isResponseHeld = false;
      resize(false);
      hide();
    },
    dismiss() {
      isResponseHeld = false;
      isPointerOver = false;
      suppressUntilNextRecording = true;
      currentStatus = { state: "idle", message: "" };
      clearTimeout(hideTimer);
      clearTimeout(fadeTimer);
      resize(false);
      sendPanelState();
      hide();
    },
    clear() {
      isResponseHeld = false;
      isPointerOver = false;
      suppressUntilNextRecording = false;
      clearTimeout(hideTimer);
      clearTimeout(fadeTimer);
      currentStatus = { state: "idle", message: "" };
      resize(false);
      sendPanelState();
      hide();
    },
    destroy() {
      clearTimeout(hideTimer);
      clearTimeout(fadeTimer);
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
    }
  };
}

function compactStatusMessage(state, sourceMessage, stage) {
  if (state === "waiting") return sourceMessage || "Waiting for response…";
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
