import electron from "electron";
import { normalizeRadialScale } from "./radial-menu.js";

const { BrowserWindow, screen } = electron;

export const RADIAL_OVERLAY_SIZE = 552;
const RADIAL_OVERLAY_MARGIN = 8;

export async function createRadialOverlay({
  overlayPath,
  preloadPath,
  secureWindow,
  BrowserWindowImpl = BrowserWindow,
  screenApi = screen,
  onSelection
} = {}) {
  if (typeof overlayPath !== "string" || !overlayPath) {
    throw new Error("The radial overlay page path is required.");
  }
  if (typeof preloadPath !== "string" || !preloadPath) {
    throw new Error("The radial overlay preload path is required.");
  }

  let overlayWindow;
  let isLoaded = false;
  let isOpen = false;
  let selectedSlot = "center";
  let currentMenu;
  let currentSize = RADIAL_OVERLAY_SIZE;

  overlayWindow = new BrowserWindowImpl({
    width: RADIAL_OVERLAY_SIZE,
    height: RADIAL_OVERLAY_SIZE,
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
      backgroundThrottling: false,
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

  const positionAtCursor = (cursorPoint) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    let point;
    let display;
    try {
      point = toDipPoint(cursorPoint, screenApi) || screenApi.getCursorScreenPoint();
      display = screenApi.getDisplayNearestPoint(point);
    } catch {
      point = { x: 0, y: 0 };
      display = screenApi.getPrimaryDisplay();
    }
    const workArea = display.workArea;
    const [width, height] = [currentSize, currentSize];
    const x = clamp(Math.round(point.x - width / 2), workArea.x + RADIAL_OVERLAY_MARGIN,
      workArea.x + workArea.width - width - RADIAL_OVERLAY_MARGIN);
    const y = clamp(Math.round(point.y - height / 2), workArea.y + RADIAL_OVERLAY_MARGIN,
      workArea.y + workArea.height - height - RADIAL_OVERLAY_MARGIN);
    overlayWindow.setPosition(x, y, false);
  };

  const send = (channel, value) => {
    if (!isLoaded || !overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.send(channel, value);
  };

  const close = (reason = "cancel") => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    isOpen = false;
    selectedSlot = "center";
    overlayWindow.setIgnoreMouseEvents(true);
    send("porvoz:radial-close", { reason });
  };

  const open = (menu, cursorPoint) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return false;
    currentMenu = structuredClone(menu || {});
    const scale = normalizeRadialScale(currentMenu.scale);
    const size = Math.round(RADIAL_OVERLAY_SIZE * scale);
    currentSize = size;
    if (typeof overlayWindow.setContentSize === "function") {
      overlayWindow.setContentSize(size, size, false);
    }
    selectedSlot = "center";
    isOpen = true;
    positionAtCursor(cursorPoint);
    overlayWindow.setIgnoreMouseEvents(false);
    overlayWindow.setAlwaysOnTop(true);
    send("porvoz:radial-open", { menu: currentMenu, selectedSlot, scale });
    return true;
  };

  const select = (slotId) => {
    if (!isOpen || typeof slotId !== "string") return false;
    const nextSlot = slotId === "outside" || slotId === "center" || /^([1-9]|1[0-2])$/.test(slotId)
      ? slotId
      : "outside";
    if (nextSlot === selectedSlot) return true;
    selectedSlot = nextSlot;
    send("porvoz:radial-selection", { slotId: selectedSlot });
    onSelection?.(selectedSlot);
    return true;
  };

  const commit = () => {
    if (!isOpen) return null;
    const result = selectedSlot;
    close(result === "outside" ? "outside" : "commit");
    return result;
  };

  const cancel = () => {
    if (!isOpen) return false;
    close("cancel");
    return true;
  };

  const onDisplayChanged = () => {
    if (isOpen) positionAtCursor();
  };
  screenApi.on("display-added", onDisplayChanged);
  screenApi.on("display-removed", onDisplayChanged);
  screenApi.on("display-metrics-changed", onDisplayChanged);

  overlayWindow.on("closed", () => {
    screenApi.off("display-added", onDisplayChanged);
    screenApi.off("display-removed", onDisplayChanged);
    screenApi.off("display-metrics-changed", onDisplayChanged);
    overlayWindow = undefined;
    isOpen = false;
  });

  await overlayWindow.loadFile(overlayPath);
  isLoaded = true;
  // Keep the transparent native surface registered with the compositor. On
  // Windows, repeatedly hiding and showing a transparent BrowserWindow can
  // flash its rectangular backing surface even when the page has no motion.
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.showInactive();

  return {
    open,
    select,
    commit,
    cancel,
    isOpen: () => isOpen,
    getSelectedSlot: () => selectedSlot,
    isSender(sender) {
      return Boolean(overlayWindow && !overlayWindow.isDestroyed() && sender === overlayWindow.webContents);
    },
    destroy() {
      close("destroy");
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
    }
  };
}

function toDipPoint(point, screenApi) {
  if (!point || point.physical !== true
    || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
  const physicalPoint = { x: Number(point.x), y: Number(point.y) };
  if (typeof screenApi?.screenToDipPoint === "function") {
    return screenApi.screenToDipPoint(physicalPoint);
  }
  return null;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
