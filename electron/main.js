import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  nativeImage,
  session,
  ipcMain,
  safeStorage,
  shell
} from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { uIOhook, UiohookKey } from "uiohook-napi";
import { createSettingsStore } from "./settings-store.js";
import { createBackendManager } from "./backend-manager.js";
import { createDesktopPreferences } from "./desktop-preferences.js";
import { createStatusOverlay } from "./status-overlay.js";
import { createHotkeyGesture } from "./hotkey-gesture.js";
import { createRadialGesture } from "./radial-gesture.js";
import { createRadialOverlay } from "./radial-overlay.js";
import { createRadialInputHook } from "./radial-input-hook.js";
import {
  captureToRadialHotkey,
  isRadialMenuConfigured,
  normalizeRadialAction,
  normalizeRadialMenu,
  normalizeRadialTrigger
} from "./radial-menu.js";
import { createSelectedTextReader } from "./selected-text.js";
import {
  captureTextInputTarget,
  disposeTextInput,
  isSyntheticCopyActive,
  isSyntheticEscapeActive,
  isSyntheticRadialInputActive,
  readSelectedTextFromClipboard,
  sendRadialAction,
  typeText
} from "./text-input.js";
import {
  createOperationCanceledError,
  isCancellationError,
  throwIfAborted
} from "./operation-cancellation.js";

if (process.platform === "linux") {
  // Electron may otherwise select an unavailable wallet when launched from
  // an SSH/TTY session even when GNOME Keyring's Secret Service is running.
  app.commandLine.appendSwitch("password-store", "gnome-libsecret");
}

const appIconPath = fileURLToPath(new URL("./assets/icon.png", import.meta.url));
const windowIconPath = process.platform === "win32"
  ? fileURLToPath(new URL("./assets/icon.ico", import.meta.url))
  : appIconPath;
const allowedRendererPaths = new Set([
  "index.html",
  "logs.html",
  "settings.html",
  "status-overlay.html",
  "radial-overlay.html"
].map((page) => fileURLToPath(new URL(`../public/${page}`, import.meta.url))));

const MODIFIER_KEYCODES = {
  CTRL: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  ALT: [UiohookKey.Alt, UiohookKey.AltRight],
  SHIFT: [UiohookKey.Shift, UiohookKey.ShiftRight],
  META: [UiohookKey.Meta, UiohookKey.MetaRight]
};
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight"
]);
const MODIFIER_FOR_CODE = new Map([
  ["ControlLeft", "CTRL"],
  ["ControlRight", "CTRL"],
  ["AltLeft", "ALT"],
  ["AltRight", "ALT"],
  ["ShiftLeft", "SHIFT"],
  ["ShiftRight", "SHIFT"],
  ["MetaLeft", "META"],
  ["MetaRight", "META"]
]);
const SINGLE_MODIFIER_HOTKEY_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight"
]);
const CAPTURE_ATTEMPT_MAX_AGE_MS = 120_000;
const ACTIVE_ACTIVITY_STATES = new Set(["recording", "transcribing", "processing", "typing"]);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
const selectedTextReader = createSelectedTextReader({
  readSelection: options => readSelectedTextFromClipboard({
    ...options,
    consoleSelectionEnabled: desktopPreferences?.getConsoleSelectionEnabled() === true
  })
});

let appService;
let mainWindow;
let captureWindow;
let statusOverlay;
let radialOverlay;
let tray;
let isQuitting = false;
let isHotkeyRecording = false;
let hotkeyIntentGeneration = 0;
const hotkeyGesture = createHotkeyGesture({
  onHold: startHotkeyRecording,
  onRelease: stopHotkeyRecording,
  onDoubleTap: () => {
    statusOverlay?.setLastTargetWindow(captureTextInputTarget());
    statusOverlay?.openResponse();
  }
});
let isCapturingHotkey = false;
let hookStarted = false;
let backendManager;
let desktopPreferences;
let currentHotkey;
let currentRadialMenu;
let radialInputHook;
let voiceInputHook;
let radialNativeHookActive = false;
let radialNativeCaptureActive = false;
let voiceNativeHookActive = false;
let radialTargetWindow;
let radialOpenPoint;
let latestLinuxCursorPoint;
let isCapturingRadialTrigger = false;
let isCapturingRadialSlot = false;
let hotkeyCaptureMode = "";
let radialCaptureSlotId;
let suppressedHotkeyKeyCode;
let hotkeyCaptureTimer;
let textTypingQueue = Promise.resolve();
const captureAttempts = new Map();
const activeOperations = new Set();
const rendererActivities = new Set();
const pressedKeys = new Set();
const capturePressedCodes = new Set();
const captureSeenCodes = new Set();
let captureTriggerCode;
let captureTriggerModifiers = [];
let captureTriggerButton;
let captureSeenButton;
const radialGesture = createRadialGesture({
  onOpen: () => {
    if (!radialGesture.isPressed() || !isRadialMenuConfigured(currentRadialMenu)) return;
    const cursorPoint = radialOpenPoint;
    radialOpenPoint = undefined;
    radialOverlay?.open(currentRadialMenu, cursorPoint);
  },
  onCenterRelease: () => {
    radialOpenPoint = undefined;
    const target = radialTargetWindow;
    radialTargetWindow = undefined;
    const slot = currentRadialMenu?.slots?.find((candidate) => candidate.id === "center");
    const action = normalizeRadialAction(slot?.action);
    if (action) void dispatchRadialAction(action, target);
  },
  onSelectionRelease: () => {
    const slotId = radialOverlay?.commit();
    const target = radialTargetWindow;
    radialTargetWindow = undefined;
    if (!slotId || slotId === "outside") return;
    const slot = currentRadialMenu?.slots?.find((candidate) => candidate.id === slotId);
    const action = normalizeRadialAction(slot?.action);
    if (action) void dispatchRadialAction(action, target);
  }
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
  app.whenReady().then(startApplication).catch(handleStartupError);
  app.on("before-quit", shutdownApplication);
  app.on("window-all-closed", (event) => event.preventDefault());
}

async function startApplication() {
  app.setAppUserModelId("com.porvoz.desktop");
  if (app.isPackaged) Menu.setApplicationMenu(null);
  const userDataPath = app.getPath("userData");
  const defaultsPath = fileURLToPath(new URL("./defaults.json", import.meta.url));
  const legacySettingsStore = createSettingsStore({
    defaultsPath,
    settingsPath: path.join(userDataPath, "settings.json"),
    credentialsPath: path.join(userDataPath, "credentials.bin")
  });
  const legacySettings = legacySettingsStore.getSettings();
  const legacyProviderKeys = {};
  for (const profile of legacySettings.profiles) {
    if (!legacySettingsStore.hasApiKey(profile.id)) continue;
    legacyProviderKeys[profile.id] = legacySettingsStore.getApiKey(profile.id);
  }
  desktopPreferences = createDesktopPreferences({
    preferencesPath: path.join(userDataPath, "desktop-preferences.json"),
    safeStorage,
    legacySettings
  });
  backendManager = createBackendManager({
    app,
    safeStorage,
    preferences: desktopPreferences,
    userDataPath,
    legacyConfiguration: { settings: legacySettings, providerKeys: legacyProviderKeys }
  });
  await backendManager.start();
  appService = backendManager.getClient();
  currentHotkey = loadHotkey();
  currentRadialMenu = loadRadialMenu();

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const rendererPath = getRendererFilePath(webContents.getURL());
    callback(permission === "media" && (
      rendererPath?.endsWith(`${path.sep}index.html`)
      || rendererPath?.endsWith(`${path.sep}settings.html`)
    ));
  });

  registerIpcHandlers();
  createTray();
  await createMainWindow();
  await createCaptureWindow();
  statusOverlay = await createStatusOverlay({
    overlayPath: fileURLToPath(new URL("../public/status-overlay.html", import.meta.url)),
    preloadPath: fileURLToPath(new URL("./status-overlay-preload.cjs", import.meta.url)),
    secureWindow: secureRendererWindow
  });
  radialOverlay = await createRadialOverlay({
    overlayPath: fileURLToPath(new URL("../public/radial-overlay.html", import.meta.url)),
    preloadPath: fileURLToPath(new URL("./radial-overlay-preload.cjs", import.meta.url)),
    secureWindow: secureRendererWindow
  });
  registerGlobalHotkey();
  if (!app.isPackaged && process.env.PORVOZ_SHOW_WINDOW_FOR_TESTS === "1") showMainWindow();
}

function loadHotkey() {
  if (!desktopPreferences) throw new Error("The desktop preferences are not initialized.");
  const hotkey = normalizeHotkey(desktopPreferences.getHotkey());
  if (!hotkey) throw new Error("The saved hotkey is invalid.");
  return hotkey;
}

function loadRadialMenu() {
  if (!desktopPreferences) throw new Error("The desktop preferences are not initialized.");
  return normalizeRadialMenu(desktopPreferences.getRadialMenu());
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 720,
    minHeight: 600,
    icon: windowIconPath,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#0c0f13",
    title: "Porvoz",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url))
    }
  });

  secureRendererWindow(mainWindow);
  mainWindow.webContents.on("before-input-event", handleSettingsHotkeyInput);
  mainWindow.on("blur", () => {
    if ((isCapturingHotkey || isCapturingRadialTrigger || isCapturingRadialSlot)
      && !capturePressedCodes.size && !captureSeenButton) {
      cancelHotkeyCapture("Hotkey capture canceled because Porvoz lost focus.");
    }
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  registerContextMenu(mainWindow);
  await mainWindow.loadFile(fileURLToPath(new URL("../public/index.html", import.meta.url)));
}

async function createCaptureWindow() {
  captureWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url))
    }
  });

  secureRendererWindow(captureWindow);
  captureWindow.on("closed", () => {
    captureWindow = undefined;
  });
  await captureWindow.loadFile(fileURLToPath(new URL("../public/index.html", import.meta.url)));
}

async function openSettingsPage() {
  const settingsPath = fileURLToPath(new URL("../public/settings.html", import.meta.url));
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadFile(settingsPath);
  mainWindow.show();
  mainWindow.focus();
}

function registerContextMenu(browserWindow) {
  browserWindow.webContents.on("context-menu", (_event, params) => {
    const editFlags = params.editFlags || {};
    const contextMenu = Menu.buildFromTemplate([
      { role: "undo", enabled: Boolean(editFlags.canUndo) },
      { role: "redo", enabled: Boolean(editFlags.canRedo) },
      { type: "separator" },
      { role: "cut", enabled: Boolean(editFlags.canCut) },
      { role: "copy", enabled: Boolean(editFlags.canCopy) },
      { role: "paste", enabled: Boolean(editFlags.canPaste) },
      { role: "selectAll", enabled: Boolean(editFlags.canSelectAll) }
    ]);
    contextMenu.popup({ window: browserWindow });
  });
}

function secureRendererWindow(browserWindow) {
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedRendererUrl(targetUrl)) event.preventDefault();
  });
}

function isAllowedRendererUrl(targetUrl) {
  const rendererPath = getRendererFilePath(targetUrl);
  return Boolean(rendererPath && allowedRendererPaths.has(rendererPath));
}

function getRendererFilePath(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === "file:" ? fileURLToPath(parsed) : "";
  } catch {
    return "";
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(`Porvoz · Hold ${currentHotkey.label} to transcribe`);
  updateTrayMenu();
  tray.on("click", () => openSettingsPage().catch(handleWindowError));
  tray.on("double-click", () => openSettingsPage().catch(handleWindowError));
}

function createTrayIcon() {
  return nativeImage.createFromPath(windowIconPath).resize({ width: 16, height: 16, quality: "best" });
}

function registerGlobalHotkey() {
  uIOhook.on("keydown", handleGlobalKeyDown);
  uIOhook.on("keyup", handleGlobalKeyUp);
  uIOhook.on("mousedown", handleGlobalMouseDown);
  uIOhook.on("mouseup", handleGlobalMouseUp);
  uIOhook.on("mousemove", handleGlobalMouseMove);
  uIOhook.start();
  hookStarted = true;
  radialInputHook = createRadialInputHook({
    onPress: handleRadialTriggerPress,
    onRelease: handleRadialTriggerRelease
  });
  // Keep the radial and voice hooks separate so both modifier-only shortcuts
  // can be consumed when they are configured at the same time. The voice
  // hook only blocks the matching events; uIOhook still owns the gesture.
  voiceInputHook = createRadialInputHook({
    onPress: handleVoiceNativeHotkeyPress,
    onRelease: handleVoiceNativeHotkeyRelease
  });
  configureInputHooks();
}

function handleSettingsHotkeyInput(event, input) {
  if (!isAnyCaptureActive() || !["keyDown", "keyUp"].includes(input.type)) return;

  event.preventDefault();

  if (input.type === "keyDown") {
    if (input.code === "Escape" && getCaptureMode() === "voice") {
      cancelHotkeyCapture("Hotkey capture canceled.");
      return;
    }
    if (typeof input.code !== "string" || !input.code) {
      notifyCaptureStatus("waiting", "That key is not supported for recording.");
      return;
    }
    if (input.isAutoRepeat || capturePressedCodes.has(input.code)) return;
    if (input.code === "Space" && getCaptureMode() === "voice") {
      notifyHotkeyCaptureStatus("waiting", "Space is not available because it inserts a character.");
      return;
    }

    capturePressedCodes.add(input.code);
    captureSeenCodes.add(input.code);
    if (MODIFIER_CODES.has(input.code)) {
      notifyCaptureStatus("waiting", "Keep holding the modifiers and press the trigger key, or release a modifier or modifier combination to use it alone.");
      return;
    }

    captureTriggerCode = input.code;
    captureTriggerModifiers = getCaptureModifiers(input);
    notifyCaptureStatus("waiting", "Release the trigger key to save this shortcut.");
    return;
  }

  // A keyup can arrive after capture mode starts even when its keydown was
  // handled by the global hook. It must not clear the new capture session.
  if (!captureSeenCodes.has(input.code)) return;

  capturePressedCodes.delete(input.code);
  if (captureTriggerCode && input.code === captureTriggerCode) {
    const captureMode = getCaptureMode();
    const nextValue = captureMode === "radial"
      ? normalizeRadialTrigger({ kind: "keyboard", code: captureTriggerCode, modifiers: captureTriggerModifiers })
      : captureMode === "radial-slot"
        ? captureToRadialHotkey(captureTriggerCode, captureTriggerModifiers)
        : normalizeHotkey({ key: captureTriggerCode, modifiers: captureTriggerModifiers });
    if (nextValue) {
      if (captureMode === "radial") saveRadialTrigger(nextValue);
      else if (captureMode === "radial-slot") saveRadialSlotAction(radialCaptureSlotId, nextValue);
      else saveHotkey(nextValue);
    } else {
      notifyCaptureStatus("waiting", "Choose a supported non-modifier key.");
      clearHotkeyCaptureState();
    }
    return;
  }

  if (captureTriggerCode || capturePressedCodes.size) return;

  const captureMode = getCaptureMode();
  const modifierOnlyValue = captureMode === "radial"
    ? normalizeModifierOnlyRadialTrigger([...captureSeenCodes])
    : captureMode === "radial-slot"
      ? normalizeModifierOnlyRadialAction([...captureSeenCodes])
      : normalizeModifierOnlyHotkey([...captureSeenCodes]);
  if (modifierOnlyValue) {
    if (captureMode === "radial") {
      saveRadialTrigger(modifierOnlyValue);
    } else if (captureMode === "radial-slot") {
      saveRadialSlotAction(radialCaptureSlotId, modifierOnlyValue);
    } else {
      saveHotkey(modifierOnlyValue);
    }
    return;
  }

  clearHotkeyCaptureState();
  notifyCaptureStatus("waiting", "Press a key, hold modifiers and press a trigger key, or use a modifier combination.");
}

function isAnyCaptureActive() {
  return isCapturingHotkey
    || (typeof isCapturingRadialTrigger !== "undefined" && isCapturingRadialTrigger)
    || (typeof isCapturingRadialSlot !== "undefined" && isCapturingRadialSlot);
}

function getCaptureMode() {
  return typeof hotkeyCaptureMode === "string" && hotkeyCaptureMode ? hotkeyCaptureMode : "voice";
}

function getCaptureModifiers(input) {
  const modifiers = new Set();
  for (const code of capturePressedCodes) {
    const modifier = MODIFIER_FOR_CODE.get(code);
    if (modifier) modifiers.add(modifier);
  }
  for (const [modifier, pressed] of [
    ["CTRL", input.control],
    ["ALT", input.alt],
    ["SHIFT", input.shift],
    ["META", input.meta]
  ]) {
    if (pressed) modifiers.add(modifier);
  }
  return [...modifiers];
}

function clearHotkeyCaptureState() {
  capturePressedCodes.clear();
  captureSeenCodes.clear();
  captureTriggerCode = undefined;
  captureTriggerModifiers = [];
  captureTriggerButton = undefined;
  captureSeenButton = undefined;
}

function normalizeModifierOnlyHotkey(codes) {
  if (!codes.length || codes.some((code) => !MODIFIER_CODES.has(code))) return null;
  const key = codes.find((code) => SINGLE_MODIFIER_HOTKEY_CODES.has(code));
  if (!key) return null;
  const modifiers = codes
    .filter((code) => code !== key)
    .map((code) => MODIFIER_FOR_CODE.get(code))
    .filter(Boolean);
  return normalizeHotkey({ key, modifiers });
}

function normalizeModifierOnlyRadialTrigger(codes) {
  if (!codes.length || codes.some((code) => !MODIFIER_CODES.has(code))) return null;
  const key = codes[0];
  const modifiers = codes
    .filter((code) => code !== key)
    .map((code) => MODIFIER_FOR_CODE.get(code))
    .filter(Boolean);
  return normalizeRadialTrigger({ kind: "keyboard", code: key, modifiers });
}

function normalizeModifierOnlyRadialAction(codes) {
  if (!codes.length || codes.some((code) => !MODIFIER_CODES.has(code))) return null;
  const key = codes[0];
  const modifiers = codes
    .slice(1)
    .map((code) => MODIFIER_FOR_CODE.get(code))
    .filter(Boolean);
  return captureToRadialHotkey(key, modifiers);
}

function notifyCaptureStatus(state, message) {
  const captureMode = getCaptureMode();
  if (captureMode === "radial"
    && typeof notifyRadialTriggerCaptureStatus === "function") {
    notifyRadialTriggerCaptureStatus(state, message);
  } else if (captureMode === "radial-slot"
    && typeof notifyRadialSlotCaptureStatus === "function") {
    notifyRadialSlotCaptureStatus(state, message);
  } else if (typeof notifyHotkeyCaptureStatus === "function") {
    notifyHotkeyCaptureStatus(state, message);
  }
}

async function handleGlobalKeyDown(event) {
  if (isSyntheticRadialInputActive()) return;
  if (isGlobalCaptureActive()) {
    if (!radialNativeCaptureActive) handleGlobalHotkeyInput("keyDown", event);
    return;
  }
  if (isSyntheticCopyActive()) return;
  if (event.keycode === UiohookKey.Escape) {
    if (isSyntheticEscapeActive()) return;
    if (radialGesture.isPressed() || radialGesture.isOpened()) {
      cancelRadialMenuGesture();
      return;
    }
    hotkeyGesture.cancel();
    cancelActiveActivity();
    statusOverlay?.dismiss();
    return;
  }
  if (shouldBypassUiohookHotkey(event)) return;
  if (isGlobalCaptureActive()) return;
  if (event.keycode === suppressedHotkeyKeyCode) return;
  pressedKeys.add(event.keycode);
  if (radialFallbackEnabled() && isConfiguredRadialKeyboardPressed(event)) {
    handleRadialTriggerPress();
    return;
  }
  if (isConfiguredHotkeyPressed(event)) hotkeyGesture.press();
}

async function startHotkeyRecording() {
  if (!isHotkeyRecording && !activeOperations.size && !rendererActivities.size) {
    statusOverlay?.prepareForCapture();
    isHotkeyRecording = true;
    const intentGeneration = ++hotkeyIntentGeneration;
    const isCurrentIntent = () => isHotkeyRecording && intentGeneration === hotkeyIntentGeneration;
    let attempt;
    try {
      attempt = beginCaptureAttempt();
      const setupStatus = await appService.getSetupStatus();
      if (!isCurrentIntent()) return;
      if (setupStatus.ready) {
        if (!isCurrentIntent()) {
          captureAttempts.delete(attempt.id);
          return;
        }
        sendHotkeyAction("start", { captureId: attempt.id });
      } else {
        captureAttempts.delete(attempt.id);
        isHotkeyRecording = false;
        sendHotkeyAction("configuration-needed", { message: setupStatus.hotkeyMessage });
      }
    } catch (error) {
      captureAttempts.delete(attempt?.id);
      if (!isCurrentIntent()) return;
      isHotkeyRecording = false;
      sendHotkeyAction("configuration-needed", {
        message: error.message || "The Porvoz backend is unavailable."
      });
    } finally {
      if (!isCurrentIntent()) captureAttempts.delete(attempt?.id);
    }
  }
}

function handleGlobalKeyUp(event) {
  if (isSyntheticRadialInputActive()) return;
  if (isGlobalCaptureActive()) {
    if (!radialNativeCaptureActive) handleGlobalHotkeyInput("keyUp", event);
    return;
  }
  if (shouldBypassUiohookHotkey(event)) return;
  if (event.keycode === suppressedHotkeyKeyCode) {
    pressedKeys.delete(event.keycode);
    suppressedHotkeyKeyCode = undefined;
    return;
  }
  pressedKeys.delete(event.keycode);
  if (radialFallbackEnabled() && isConfiguredRadialKeyboardTriggerKey(event)) {
    handleRadialTriggerRelease();
    return;
  }
  const chord = getConfiguredHotkeyKeyCodes();
  if (chord.includes(event.keycode)) {
    hotkeyGesture.release(chord.every((keycode) => !pressedKeys.has(keycode)));
  }
}

function isGlobalCaptureActive() {
  return isCapturingHotkey
    || (typeof isCapturingRadialTrigger !== "undefined" && isCapturingRadialTrigger)
    || (typeof isCapturingRadialSlot !== "undefined" && isCapturingRadialSlot);
}

function radialFallbackEnabled() {
  return typeof radialNativeHookActive !== "undefined"
    && typeof currentRadialMenu !== "undefined"
    && radialNativeHookActive !== true;
}

function handleGlobalMouseDown(event) {
  if (isSyntheticRadialInputActive()) return;
  if (isCapturingRadialTrigger) {
    captureMouseTrigger("down", event);
    return;
  }
  if (radialFallbackEnabled() && isConfiguredRadialMouseEvent(event)) {
    handleRadialTriggerPress(getPhysicalCursorPoint(event));
  }
}

function handleGlobalMouseUp(event) {
  if (isSyntheticRadialInputActive()) return;
  if (isCapturingRadialTrigger) {
    captureMouseTrigger("up", event);
    return;
  }
  if (radialFallbackEnabled() && isConfiguredRadialMouseEvent(event)) {
    handleRadialTriggerRelease();
  }
}

function handleGlobalMouseMove(event) {
  if (process.platform !== "linux") return;
  latestLinuxCursorPoint = getPhysicalCursorPoint(event);
}

function getPhysicalCursorPoint(event) {
  const x = Number(event?.x);
  const y = Number(event?.y);
  return Number.isFinite(x) && Number.isFinite(y)
    ? { x, y, physical: true }
    : undefined;
}

function handleRadialTriggerPress(cursorPoint) {
  if (!isRadialMenuConfigured(currentRadialMenu) || radialOverlay?.isOpen()) return;
  if (isCapturingHotkey || isCapturingRadialTrigger || isHotkeyRecording || activeOperations.size) return;
  radialTargetWindow = captureTextInputTarget();
  radialOpenPoint = cursorPoint || latestLinuxCursorPoint;
  radialGesture.press();
}

function handleRadialTriggerRelease() {
  radialOpenPoint = undefined;
  radialGesture.release();
}

function cancelRadialMenuGesture() {
  radialOpenPoint = undefined;
  radialGesture.cancel();
  radialTargetWindow = undefined;
  radialOverlay?.cancel();
}

function handleVoiceNativeHotkeyPress() {
  if (!voiceNativeHookActive || isGlobalCaptureActive()) return;
  hotkeyGesture.press();
}

function handleVoiceNativeHotkeyRelease(event = {}) {
  if (!voiceNativeHookActive || isGlobalCaptureActive()) return;
  hotkeyGesture.release(event.allReleased === true);
}

function dispatchRadialAction(action, target) {
  const operation = textTypingQueue.then(() => sendRadialAction(action, { target }));
  textTypingQueue = operation.catch(() => {});
  void operation.catch(async (error) => {
    console.error("Could not send radial action:", error);
    await appService?.logError?.({ stage: "typing", error });
  });
}

function configureRadialInputHook() {
  if (!radialInputHook) return;
  radialNativeCaptureActive = false;
  radialInputHook.setCaptureHandler(null);
  const configured = isRadialMenuConfigured(currentRadialMenu);
  if (!configured) {
    radialInputHook.setTrigger(null);
    radialInputHook.stop();
    radialNativeHookActive = false;
    return;
  }
  radialInputHook.setTrigger(currentRadialMenu.trigger);
  if (radialInputHook.supported) {
    try {
      radialInputHook.start();
      radialNativeHookActive = true;
    } catch (error) {
      radialNativeHookActive = false;
      console.error("Could not enable the radial input hook:", error.message);
    }
  }
}

function configureInputHooks() {
  configureRadialInputHook();
  configureVoiceHotkeyInputHook();
}

function configureVoiceHotkeyInputHook() {
  if (!voiceInputHook) return;
  voiceNativeHookActive = false;
  voiceInputHook.setCaptureHandler(null);
  if (!isModifierOnlyHotkey(currentHotkey)) {
    voiceInputHook.setTrigger(null);
    voiceInputHook.stop();
    return;
  }

  voiceInputHook.setTrigger({
    kind: "keyboard",
    code: currentHotkey.key,
    modifiers: [...(currentHotkey.modifiers || [])],
    label: currentHotkey.label
  });
  if (!voiceInputHook.supported) return;
  try {
    voiceInputHook.start();
    voiceNativeHookActive = true;
  } catch (error) {
    voiceNativeHookActive = false;
    console.error("Could not enable the voice hotkey input hook:", error.message);
  }
}

function enableNativeCaptureHook() {
  if (!radialInputHook?.supported) return false;
  radialInputHook.setTrigger(null);
  radialInputHook.setCaptureHandler({
    onKeyboardEvent: (input) => handleSettingsHotkeyInput({ preventDefault() {} }, input),
    onMouseEvent: (input) => captureMouseTrigger(
      input.type === "mouseDown" ? "down" : "up",
      input
    )
  });
  try {
    radialInputHook.start();
    radialNativeCaptureActive = true;
    return true;
  } catch (error) {
    radialInputHook.setCaptureHandler(null);
    radialNativeCaptureActive = false;
    console.error("Could not enable the shortcut capture hook:", error.message);
    return false;
  }
}

function isConfiguredRadialKeyboardPressed(event) {
  const trigger = currentRadialMenu?.trigger;
  if (!isRadialMenuConfigured(currentRadialMenu) || trigger.kind !== "keyboard") return false;
  const keycode = getUiohookKeyCode(trigger.code);
  if (keycode === undefined) return false;
  if (MODIFIER_CODES.has(trigger.code) && trigger.modifiers.length) {
    const keyModifier = MODIFIER_FOR_CODE.get(trigger.code);
    return event.keycode === keycode
      && [keyModifier, ...trigger.modifiers].every((modifier) => isModifierPressed(modifier, event));
  }
  return event.keycode === keycode
    && trigger.modifiers.every((modifier) => isModifierPressed(modifier, event));
}

function isConfiguredRadialKeyboardTriggerKey(event) {
  const trigger = currentRadialMenu?.trigger;
  return Boolean(isRadialMenuConfigured(currentRadialMenu)
    && trigger.kind === "keyboard"
    && event.keycode === getUiohookKeyCode(trigger.code));
}

function isConfiguredRadialMouseEvent(event) {
  return isRadialMenuConfigured(currentRadialMenu)
    && currentRadialMenu.trigger.kind === "mouse"
    && Number(event?.button) === Number(currentRadialMenu.trigger.button);
}

function captureMouseTrigger(type, event) {
  if (!isCapturingRadialTrigger) return;
  const button = Number(event?.button);
  if (![1, 2, 3, 4, 5].includes(button)) return;
  if (type === "down") {
    if (captureSeenButton) return;
    captureSeenButton = button;
    captureTriggerButton = button;
    notifyRadialTriggerCaptureStatus("waiting", "Release the mouse button to save this trigger.");
    return;
  }
  if (captureTriggerButton !== button || captureSeenButton !== button) return;
  saveRadialTrigger({
    kind: "mouse",
    button,
    modifiers: [],
    label: ""
  });
}

function stopHotkeyRecording() {
  if (isHotkeyRecording) {
    isHotkeyRecording = false;
    const hotkeyReleasedAt = Date.now();
    for (const attempt of captureAttempts.values()) {
      if (attempt.state === "recording") {
        attempt.state = "processing";
        attempt.hotkeyReleasedAt = hotkeyReleasedAt;
        attempt.selectedTextPromise = selectedTextReader.read({ target: attempt.targetWindow });
      }
    }
    sendHotkeyAction("stop", { hotkeyReleasedAt });
  }
}

function handleGlobalHotkeyInput(type, event) {
  const code = getCodeFromUiohookKeyCode(event.keycode);
  if (!code) return;
  handleSettingsHotkeyInput({ preventDefault() {} }, {
    type,
    code,
    isAutoRepeat: event.isAutoRepeat === true || event.autoRepeat === true,
    control: event.ctrlKey === true,
    alt: event.altKey === true,
    shift: event.shiftKey === true,
    meta: event.metaKey === true
  });
  // When the global hook handled the final keyup, the capture handler has
  // just installed the usual one-event suppression. This keyup is that event.
  if (type === "keyUp" && !isCapturingHotkey && event.keycode === suppressedHotkeyKeyCode) {
    suppressedHotkeyKeyCode = undefined;
  }
}

function getCodeFromUiohookKeyCode(keycode) {
  const modifierCodes = new Map([
    [UiohookKey.Ctrl, "ControlLeft"],
    [UiohookKey.CtrlRight, "ControlRight"],
    [UiohookKey.Alt, "AltLeft"],
    [UiohookKey.AltRight, "AltRight"],
    [UiohookKey.Shift, "ShiftLeft"],
    [UiohookKey.ShiftRight, "ShiftRight"],
    [UiohookKey.Meta, "MetaLeft"],
    [UiohookKey.MetaRight, "MetaRight"]
  ]);
  const modifierCode = modifierCodes.get(keycode);
  if (modifierCode) return modifierCode;

  const digitName = Object.keys(UiohookKey).find((name) =>
    /^\d$/.test(name) && UiohookKey[name] === keycode
  );
  if (digitName) return `Digit${digitName}`;

  const keyName = Object.keys(UiohookKey).find((name) =>
    !/^\d+$/.test(name) && UiohookKey[name] === keycode
  );
  if (!keyName) return undefined;
  if (/^[A-Z]$/.test(keyName)) return `Key${keyName}`;
  return keyName;
}

function isConfiguredHotkeyPressed(event) {
  const hotkeyKeyCode = getUiohookKeyCode(currentHotkey.key);
  if (!isModifierOnlyHotkey(currentHotkey)) {
    return event.keycode === hotkeyKeyCode
      && currentHotkey.modifiers.every((modifier) => isModifierPressed(modifier, event));
  }

  const keyModifier = MODIFIER_FOR_CODE.get(currentHotkey.key);
  const requiredModifiers = [keyModifier, ...currentHotkey.modifiers];
  return getConfiguredHotkeyKeyCodes().includes(event.keycode)
    && requiredModifiers.every((modifier) => isModifierPressed(modifier, event));
}

function isModifierOnlyHotkey(hotkey) {
  return Boolean(hotkey
    && SINGLE_MODIFIER_HOTKEY_CODES.has(hotkey.key)
    && Array.isArray(hotkey.modifiers)
    && hotkey.modifiers.length);
}

function getConfiguredHotkeyKeyCodes() {
  return [
    getUiohookKeyCode(currentHotkey?.key),
    ...(currentHotkey?.modifiers || []).flatMap((modifier) => MODIFIER_KEYCODES[modifier] || [])
  ].filter((code) => code !== undefined);
}

function shouldBypassUiohookHotkey(event) {
  return typeof voiceNativeHookActive !== "undefined"
    && voiceNativeHookActive
    && isModifierOnlyHotkey(currentHotkey)
    && getConfiguredHotkeyKeyCodes().includes(event.keycode);
}

function isModifierPressed(modifier, event) {
  const keycodes = MODIFIER_KEYCODES[modifier] || [];
  const eventModifier = modifier === "CTRL"
    ? event.ctrlKey
    : modifier === "ALT"
      ? event.altKey
      : modifier === "SHIFT"
        ? event.shiftKey
        : event.metaKey;
  return keycodes.some((keycode) => pressedKeys.has(keycode)) || eventModifier;
}

function getUiohookKeyCode(code) {
  if (typeof code !== "string") return undefined;
  if (code.startsWith("Key")) return UiohookKey[code.slice(3)];
  if (code.startsWith("Digit")) return UiohookKey[code.slice(5)];
  if (code === "ControlLeft" || code === "ControlRight") return code === "ControlRight" ? UiohookKey.CtrlRight : UiohookKey.Ctrl;
  if (code === "ShiftLeft" || code === "ShiftRight") return code === "ShiftRight" ? UiohookKey.ShiftRight : UiohookKey.Shift;
  if (code === "AltLeft" || code === "AltRight") return code === "AltRight" ? UiohookKey.AltRight : UiohookKey.Alt;
  if (code === "MetaLeft" || code === "MetaRight") return code === "MetaRight" ? UiohookKey.MetaRight : UiohookKey.Meta;
  return UiohookKey[code];
}

function normalizeHotkey(value) {
  if (!value || typeof value.key !== "string" || !getUiohookKeyCode(value.key)) return null;
  const modifiers = Array.isArray(value.modifiers)
    ? [...new Set(value.modifiers.filter((modifier) => Object.hasOwn(MODIFIER_KEYCODES, modifier)))]
    : [];
  const keyModifier = MODIFIER_FOR_CODE.get(value.key);
  if (keyModifier && (!SINGLE_MODIFIER_HOTKEY_CODES.has(value.key) || modifiers.includes(keyModifier))) return null;
  return {
    key: value.key,
    modifiers,
    label: formatHotkeyLabel(value.key, modifiers)
  };
}

function formatHotkeyLabel(key, modifiers) {
  const modifierLabels = { CTRL: "Ctrl", ALT: "Alt", SHIFT: "Shift", META: "Meta" };
  const keyLabels = {
    ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl",
    AltLeft: "Left Alt",
    AltRight: "Right Alt"
  };
  const displayKey = key.startsWith("Key")
    ? key.slice(3)
    : key.startsWith("Digit")
      ? key.slice(5)
      : keyLabels[key] || key;
  return [...modifiers.map((modifier) => modifierLabels[modifier]), displayKey].join(" + ");
}

function sendHotkeyAction(action, value) {
  if (action === "start") {
    setOverlayStatus({ message: "Recording…", state: "recording", stage: "recording" });
  } else if (action === "stop") {
    setOverlayStatus(value?.responseHeld
      ? { message: "Waiting for response…", state: "waiting", stage: "recording" }
      : { message: "Finishing recording…", state: "processing", stage: "recording" });
  } else if (action === "configuration-needed") {
    setOverlayStatus({
      message: value?.message || "Setup is required before recording.",
      state: "error",
      stage: "configuration"
    });
  }
  const targetWindow = getCaptureRendererWindow();
  if (targetWindow) {
    targetWindow.webContents.send("porvoz:hotkey", action, value);
  }
}

function cancelActiveActivity() {
  const hasCapture = [...captureAttempts.values()].some((attempt) => attempt.state !== "complete");
  if (!activeOperations.size && !rendererActivities.size && !hasCapture && !isHotkeyRecording) return false;

  const cancellation = createOperationCanceledError();
  for (const controller of activeOperations) controller.abort(cancellation);
  for (const attempt of captureAttempts.values()) attempt.state = "canceled";
  captureAttempts.clear();
  isHotkeyRecording = false;
  rendererActivities.clear();
  setOverlayStatus({ state: "idle" });
  notifyActivityCanceled(cancellation.message);
  return true;
}

function notifyActivityCanceled(message = "Canceled by user.") {
  for (const browserWindow of getRendererWindows()) {
    browserWindow.webContents.send("porvoz:activity-canceled", { message });
  }
}

function getRendererWindows() {
  return [mainWindow, captureWindow]
    .filter((browserWindow, index, windows) =>
      browserWindow
      && !browserWindow.isDestroyed()
      && windows.indexOf(browserWindow) === index);
}

function getCaptureRendererWindow() {
  const visibleRenderer = getRendererWindows().find((browserWindow) => {
    const rendererPath = getRendererFilePath(browserWindow.webContents.getURL());
    return browserWindow.isVisible()
      && rendererPath?.endsWith(`${path.sep}index.html`);
  });
  if (visibleRenderer) return visibleRenderer;
  return getRendererWindows().find((browserWindow) => browserWindow === captureWindow)
    || getRendererWindows()[0];
}

async function runActiveOperation(operation) {
  const controller = new AbortController();
  activeOperations.add(controller);
  try {
    return await operation(controller.signal);
  } finally {
    activeOperations.delete(controller);
  }
}

function setOverlayStatus(value) {
  statusOverlay?.setStatus(value);
}

function registerIpcHandlers() {
  ipcMain.handle("porvoz:get-app-version", () => app.getVersion());
  ipcMain.handle("porvoz:get-runtime-config", async () => ({
    ...(await appService.getRuntimeConfig()),
    soundVolume: desktopPreferences.getSoundVolume(),
    consoleSelectionEnabled: desktopPreferences.getConsoleSelectionEnabled()
  }));
  ipcMain.handle("porvoz:get-backend-settings", () => backendManager.getSettings());
  ipcMain.handle("porvoz:save-backend-settings", async (_event, value) => {
    const result = await backendManager.saveSettings(value);
    appService = backendManager.getClient();
    notifySetupUpdated();
    return result;
  });
  ipcMain.handle("porvoz:get-connection-settings", () => appService.getConnectionSettings());
  ipcMain.handle("porvoz:get-setup-status", () => appService.getSetupStatus());
  ipcMain.handle("porvoz:save-connection", async (_event, value) => {
    const result = await appService.saveConnection(value);
    notifySetupUpdated();
    return result;
  });
  ipcMain.handle("porvoz:populate-models", () => runActiveOperation(async (signal) => {
    try {
      const result = await appService.populateModels({ signal });
      notifySetupUpdated();
      return result;
    } catch (error) {
      if (!isCancellationError(error)) notifyLogsUpdated();
      throw error;
    }
  }));
  ipcMain.handle("porvoz:save-model-selections", async (_event, value) => {
    const result = await appService.saveModelSelections(value);
    notifySetupUpdated();
    return result;
  });
  ipcMain.handle("porvoz:create-profile", async (_event, value) => {
    const result = await appService.createProfile(value);
    notifySetupUpdated();
    return result;
  });
  ipcMain.handle("porvoz:rename-profile", (_event, value) => appService.renameProfile(value));
  ipcMain.handle("porvoz:delete-profile", async (_event, value) => {
    const result = await appService.deleteProfile(value);
    notifySetupUpdated();
    return result;
  });
  ipcMain.handle("porvoz:set-active-profile", async (_event, value) => {
    const result = await appService.setActiveProfile(value);
    notifySetupUpdated();
    return result;
  });
  ipcMain.handle("porvoz:save-prefix-settings", (_event, value) => appService.savePrefixSettings(value));
  ipcMain.handle("porvoz:get-inference-key", () => appService.getInferenceKey());
  ipcMain.handle("porvoz:rotate-inference-key", () => appService.rotateInferenceKey());
  ipcMain.handle("porvoz:write-clipboard-text", (_event, value) => {
    if (typeof value !== "string") throw new Error("Clipboard content must be text.");
    clipboard.writeText(value);
  });
  ipcMain.handle("porvoz:read-clipboard-text", () => clipboard.readText());
  ipcMain.handle("porvoz:get-logs", () => appService.getLogs());
  ipcMain.handle("porvoz:log-error", async (_event, value) => {
    const result = await appService.logError(value);
    notifyLogsUpdated();
    return result;
  });
  ipcMain.handle("porvoz:update-log-timing", async (_event, value) => {
    const result = await appService.updateLogTiming(value);
    notifyLogsUpdated();
    return result;
  });
  ipcMain.handle("porvoz:clear-logs", async () => {
    const logs = await appService.clearLogs();
    notifyLogsUpdated(logs);
    return logs;
  });
  ipcMain.handle("porvoz:reset-to-defaults", async () => {
    const runtimeConfig = await appService.resetToDefaults();
    const defaults = JSON.parse(await import("node:fs/promises").then(({ readFile }) =>
      readFile(fileURLToPath(new URL("./defaults.json", import.meta.url)), "utf8")));
    desktopPreferences.resetCaptureSettings(defaults);
    currentHotkey = loadHotkey();
    currentRadialMenu = loadRadialMenu();
    cancelRadialMenuGesture();
    configureInputHooks();
    suppressedHotkeyKeyCode = undefined;
    tray?.setToolTip(`Porvoz · Hold ${currentHotkey.label} to transcribe`);
    notifyHotkeyUpdated();
    notifyRadialMenuUpdated();
    notifySetupUpdated();
    updateTrayMenu();
    return { ...runtimeConfig, soundVolume: desktopPreferences.getSoundVolume(),
      consoleSelectionEnabled: desktopPreferences.getConsoleSelectionEnabled() };
  });
  ipcMain.handle("porvoz:transcribe", (_event, value) => runActiveOperation(async (signal) => {
    setOverlayStatus({ message: "Transcribing…", state: "transcribing", stage: "transcription" });
    try {
      const attempt = getCaptureAttempt(value?.captureId);
      const selectedText = await (attempt?.selectedTextPromise || selectedTextReader.read());
      const hotkeyReleasedAt = attempt?.hotkeyReleasedAt || value?.timing?.hotkeyReleasedAt || value?.hotkeyReleasedAt;
      const transcriptionRequestedAt = Date.now();
      const preTranscriptionMs = hotkeyReleasedAt
        ? Math.max(0, transcriptionRequestedAt - hotkeyReleasedAt)
        : (value?.timing?.preTranscriptionMs ?? null);
      const timing = {
        ...(value?.timing || {}),
        ...(hotkeyReleasedAt ? { hotkeyReleasedAt } : {}),
        ...(preTranscriptionMs !== null ? { preTranscriptionMs } : {})
      };
      const result = await appService.transcribe({
        ...value,
        clipboardText: await clipboard.readText(),
        ...(selectedText ? { selectedText } : {}),
        timing
      }, { signal });
      if (attempt) {
        attempt.webSearchUsed = result?.webSearchUsed === true;
        attempt.logGroupId = result?.logGroupId || attempt.logGroupId;
        attempt.timing = result?.timing || timing;
      }
      notifyLogsUpdated();
      return result;
    } catch (error) {
      if (isCancellationError(error)) {
        setOverlayStatus({ state: "idle" });
        throw error;
      }
      notifyLogsUpdated();
      setOverlayStatus({
        message: error.message || "Could not transcribe the audio.",
        state: "error",
        stage: "transcription"
      });
      throw error;
    }
  }));
  ipcMain.handle("porvoz:create-prefix-from-voice", (_event, value) => runActiveOperation((signal) =>
    appService.createPrefixFromVoice(value, { signal })));
  ipcMain.handle("porvoz:get-hotkey", () => currentHotkey);
  ipcMain.handle("porvoz:begin-hotkey-capture", () => {
    hotkeyGesture.cancel();
    hotkeyGesture.release(true);
    cancelRadialMenuGesture();
    isCapturingHotkey = true;
    isCapturingRadialTrigger = false;
    isCapturingRadialSlot = false;
    hotkeyCaptureMode = "voice";
    isHotkeyRecording = false;
    radialInputHook?.stop();
    voiceInputHook?.stop();
    radialNativeHookActive = false;
    pressedKeys.clear();
    clearHotkeyCaptureState();
    enableNativeCaptureHook();
    startHotkeyCaptureWatchdog();
    return currentHotkey;
  });
  ipcMain.handle("porvoz:cancel-hotkey-capture", () => {
    cancelHotkeyCapture("Hotkey capture canceled.");
    return currentHotkey;
  });
  ipcMain.handle("porvoz:set-hotkey", (_event, value) => {
    const nextHotkey = normalizeHotkey(value);
    if (!nextHotkey) throw new Error("Choose a supported non-modifier key.");
    return saveHotkey(nextHotkey);
  });
  ipcMain.handle("porvoz:get-radial-menu", () => currentRadialMenu);
  ipcMain.handle("porvoz:save-radial-menu", (_event, value) => saveRadialMenu(value));
  ipcMain.handle("porvoz:begin-radial-trigger-capture", () => beginRadialCapture("radial"));
  ipcMain.handle("porvoz:begin-radial-slot-capture", (_event, slotId) => {
    if (!currentRadialMenu?.slots?.some((slot) => slot.id === slotId)) {
      throw new Error("Choose a valid radial menu slot.");
    }
    return beginRadialCapture("radial-slot", slotId);
  });
  ipcMain.handle("porvoz:cancel-radial-capture", () => {
    cancelHotkeyCapture("Radial shortcut capture canceled.");
    return currentRadialMenu;
  });
  ipcMain.handle("porvoz:save-sound-volume", (_event, value) => {
    const soundVolume = desktopPreferences.saveSoundVolume(value);
    notifySoundVolumeUpdated(soundVolume);
    return soundVolume;
  });
  ipcMain.handle("porvoz:save-console-selection", (_event, value) =>
    desktopPreferences.saveConsoleSelectionEnabled(value));
  ipcMain.on("porvoz:status", (_event, value) => {
    if (!value || typeof value !== "object") return;
    if (ACTIVE_ACTIVITY_STATES.has(value.state)) rendererActivities.add(_event.sender.id);
    else rendererActivities.delete(_event.sender.id);
    setOverlayStatus(value);
  });
  ipcMain.on("porvoz:overlay-dismiss", (event) => {
    if (statusOverlay?.isSender(event.sender)) statusOverlay.dismiss();
  });
  ipcMain.on("porvoz:overlay-hover", (event) => {
    if (statusOverlay?.isSender(event.sender)) statusOverlay.onHover();
  });
  ipcMain.on("porvoz:radial-selection", (event, slotId) => {
    if (radialOverlay?.isSender(event.sender)) radialOverlay.select(slotId);
  });
  ipcMain.handle("porvoz:overlay-copy", (event) => {
    if (!statusOverlay?.isSender(event.sender)) return false;
    const response = statusOverlay.getResponse();
    if (!response) return false;
    clipboard.writeText(response);
    return true;
  });
  ipcMain.handle("porvoz:overlay-open-external", async (event, value) => {
    if (!statusOverlay?.isSender(event.sender) || typeof value !== "string") return false;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") return false;
      await shell.openExternal(url.href);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle("porvoz:type-text", (_event, value) => runActiveOperation(async (signal) => {
    const request = normalizeTypingRequest(value);
    const responseText = sanitizeText(request.text);
    if (!responseText) return false;
    statusOverlay?.setResponse(responseText);
    setOverlayStatus({ message: "Placing text…", state: "typing", stage: "typing" });
    const attempt = getCaptureAttempt(request.captureId);
    try {
      const pasteStart = Date.now();
      await typeTextAtCursor(request, signal);
      const textPastedAt = Date.now();
      const pasteMs = Math.max(1, textPastedAt - pasteStart);
      const hotkeyReleasedAt = attempt?.hotkeyReleasedAt || request.timing?.hotkeyReleasedAt;
      const stageSum = (
        (request.timing?.preTranscriptionMs || 0) +
        (request.timing?.transcriptionMs || 0) +
        (request.timing?.instructionPrepMs || 0) +
        (request.timing?.instructionMs || 0) +
        pasteMs
      );
      const measuredTotal = (hotkeyReleasedAt && textPastedAt > hotkeyReleasedAt)
        ? textPastedAt - hotkeyReleasedAt
        : null;
      const totalMs = measuredTotal
        || (request.timing?.totalMs && request.timing.totalMs > 0 ? request.timing.totalMs : null)
        || (stageSum > 0 ? stageSum : pasteMs);
      const logGroupId = request.logGroupId || attempt?.logGroupId;
      if (logGroupId) {
        const timingPatch = {
          ...(attempt?.timing || request.timing || {}),
          textPastedAt,
          pasteMs,
          totalMs
        };
        await appService.updateLogTiming({ logGroupId, timing: timingPatch });
        notifyLogsUpdated();
      }
      const webSearchUsed = request.webSearchUsed || attempt?.webSearchUsed === true;
      if (webSearchUsed) {
        statusOverlay?.showWebSearchResponse();
      } else {
        setOverlayStatus({ message: "Text placed.", state: "success", stage: "typing" });
      }
      return true;
    } catch (error) {
      if (isCancellationError(error)) {
        setOverlayStatus({ state: "idle" });
        throw error;
      }
      await appService.logError({ stage: "typing", error });
      notifyLogsUpdated();
      setOverlayStatus({
        message: error.message || "Could not place the text.",
        state: "error",
        stage: "typing"
      });
      throw error;
    }
  }));
}

function saveHotkey(nextHotkey) {
  clearHotkeyCaptureWatchdog();
  hotkeyGesture.cancel();
  hotkeyGesture.release(true);
  currentHotkey = nextHotkey;
  desktopPreferences.saveHotkey(currentHotkey);
  isCapturingHotkey = false;
  isCapturingRadialTrigger = false;
  isCapturingRadialSlot = false;
  hotkeyCaptureMode = "";
  radialCaptureSlotId = undefined;
  isHotkeyRecording = false;
  pressedKeys.clear();
  clearHotkeyCaptureState();
  configureInputHooks();
  suppressedHotkeyKeyCode = isModifierOnlyHotkey(currentHotkey)
    ? undefined
    : getUiohookKeyCode(currentHotkey.key);
  tray?.setToolTip(`Porvoz · Hold ${currentHotkey.label} to transcribe`);
  notifyHotkeyUpdated();
  updateTrayMenu();
  return currentHotkey;
}

function saveRadialMenu(value) {
  cancelRadialMenuGesture();
  currentRadialMenu = normalizeRadialMenu(value);
  desktopPreferences.saveRadialMenu(currentRadialMenu);
  configureRadialInputHook();
  notifyRadialMenuUpdated();
  return currentRadialMenu;
}

function beginRadialCapture(mode, slotId) {
  hotkeyGesture.cancel();
  hotkeyGesture.release(true);
  cancelRadialMenuGesture();
  isCapturingHotkey = false;
  isCapturingRadialTrigger = mode === "radial";
  isCapturingRadialSlot = mode === "radial-slot";
  hotkeyCaptureMode = mode;
  radialCaptureSlotId = slotId;
  isHotkeyRecording = false;
  radialInputHook?.stop();
  voiceInputHook?.stop();
  radialNativeHookActive = false;
  pressedKeys.clear();
  clearHotkeyCaptureState();
  enableNativeCaptureHook();
  startHotkeyCaptureWatchdog();
  notifyCaptureStatus("waiting", mode === "radial"
    ? "Press the key or mouse button that should open the radial menu, then release it to save."
    : "Press the shortcut for this slot, then release it to save. Click Cancel to stop recording.");
  return mode === "radial" ? currentRadialMenu?.trigger : currentRadialMenu?.slots
    ?.find((slot) => slot.id === slotId)?.action || null;
}

function saveRadialTrigger(nextTrigger) {
  if (nextTrigger?.kind === "keyboard" && getUiohookKeyCode(nextTrigger.code) === undefined) {
    notifyRadialTriggerCaptureStatus("waiting", "That key is not supported as a global trigger.");
    clearHotkeyCaptureState();
    return null;
  }
  currentRadialMenu = normalizeRadialMenu({
    ...currentRadialMenu,
    trigger: normalizeRadialTrigger(nextTrigger)
  });
  desktopPreferences.saveRadialMenu(currentRadialMenu);
  finishRadialCapture();
  notifyRadialMenuUpdated();
  notifyRadialTriggerCaptureStatus("saved", `Radial trigger saved: ${currentRadialMenu.trigger.label}.`);
  return currentRadialMenu.trigger;
}

function saveRadialSlotAction(slotId, action) {
  const normalizedAction = normalizeRadialAction(action);
  if (!normalizedAction || !currentRadialMenu?.slots?.some((slot) => slot.id === slotId)) {
    notifyRadialSlotCaptureStatus("waiting", "Choose a supported key or key combination.", slotId);
    clearHotkeyCaptureState();
    return null;
  }
  finishRadialCapture();
  notifyRadialSlotCaptureStatus("saved", `Shortcut recorded: ${normalizedAction.label}.`, slotId, normalizedAction);
  return normalizedAction;
}

function finishRadialCapture() {
  clearHotkeyCaptureWatchdog();
  isCapturingRadialTrigger = false;
  isCapturingRadialSlot = false;
  hotkeyCaptureMode = "";
  radialCaptureSlotId = undefined;
  pressedKeys.clear();
  clearHotkeyCaptureState();
  configureRadialInputHook();
  configureVoiceHotkeyInputHook();
}

function updateTrayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Porvoz", click: () => openSettingsPage().catch(handleWindowError) },
    { label: `Hold ${currentHotkey.label} to record`, enabled: false },
    { type: "separator" },
    { label: "Exit Porvoz", click: () => app.quit() }
  ]));
}

function cancelHotkeyCapture(message) {
  const mode = hotkeyCaptureMode;
  clearHotkeyCaptureWatchdog();
  isCapturingHotkey = false;
  isCapturingRadialTrigger = false;
  isCapturingRadialSlot = false;
  hotkeyCaptureMode = "";
  const slotId = radialCaptureSlotId;
  radialCaptureSlotId = undefined;
  isHotkeyRecording = false;
  pressedKeys.clear();
  clearHotkeyCaptureState();
  configureInputHooks();
  if (mode === "radial") notifyRadialTriggerCaptureStatus("canceled", message);
  else if (mode === "radial-slot") notifyRadialSlotCaptureStatus("canceled", message, slotId);
  else notifyHotkeyCaptureStatus("canceled", message);
}

function startHotkeyCaptureWatchdog() {
  clearHotkeyCaptureWatchdog();
  hotkeyCaptureTimer = setTimeout(() => {
    if (isCapturingHotkey || isCapturingRadialTrigger || isCapturingRadialSlot) {
      cancelHotkeyCapture("Shortcut capture timed out.");
    }
  }, 15000);
  hotkeyCaptureTimer.unref?.();
}

function clearHotkeyCaptureWatchdog() {
  if (!hotkeyCaptureTimer) return;
  clearTimeout(hotkeyCaptureTimer);
  hotkeyCaptureTimer = undefined;
}

function notifyHotkeyUpdated() {
  for (const browserWindow of getRendererWindows()) {
    browserWindow.webContents.send("porvoz:hotkey-updated", currentHotkey);
  }
}

function notifySoundVolumeUpdated(soundVolume) {
  for (const browserWindow of getRendererWindows()) {
    browserWindow.webContents.send("porvoz:sound-volume-updated", soundVolume);
  }
}

function notifyLogsUpdated(logs) {
  const payload = { count: Array.isArray(logs) ? logs.length : undefined };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("porvoz:logs-updated", payload);
}

function notifySetupUpdated() {
  for (const browserWindow of getRendererWindows()) {
    browserWindow.webContents.send("porvoz:setup-updated");
  }
}

function notifyHotkeyCaptureStatus(state, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("porvoz:hotkey-capture-status", { state, message });
  }
}

function notifyRadialMenuUpdated() {
  for (const browserWindow of getRendererWindows()) {
    browserWindow.webContents.send("porvoz:radial-menu-updated", currentRadialMenu);
  }
}

function notifyRadialTriggerCaptureStatus(state, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("porvoz:radial-trigger-capture-status", { state, message });
  }
}

function notifyRadialSlotCaptureStatus(state, message, slotId = radialCaptureSlotId, action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("porvoz:radial-slot-capture-status", {
      state, message, slotId, ...(action ? { action } : {})
    });
  }
}

async function typeTextAtCursor(value, signal) {
  const request = normalizeTypingRequest(value);
  if (!request.text) return;
  if (typeof request.text !== "string") {
    throw new Error("The response text must be a string.");
  }
  const textToType = sanitizeText(request.text);
  if (!textToType) return;

  const attempt = request.purpose === "transcription"
    ? getCaptureAttempt(request.captureId)
    : undefined;

  // Queue text injection so concurrent responses cannot interleave. Every
  // platform uses the same clipboard transaction followed by simulated paste.
  const typeOperation = textTypingQueue.then(async () => {
    throwIfAborted(signal);
    if (request.purpose === "transcription") {
      if (!attempt || attempt.state !== "processing") {
        throw new Error("The typing request is no longer associated with an active capture.");
      }
      if (Date.now() - attempt.createdAt > CAPTURE_ATTEMPT_MAX_AGE_MS) {
        throw new Error("The typing request expired before the response was ready.");
      }
    }
    await waitForRecordingHotkeyRelease(signal);
    if (attempt) attempt.state = "typing";
    await typeText(textToType, { target: attempt?.targetWindow || null, signal });
    if (attempt) attempt.state = "complete";
  });
  textTypingQueue = typeOperation.catch(() => {});
  try {
    await typeOperation;
  } finally {
    if (attempt) captureAttempts.delete(attempt.id);
  }
}

function normalizeTypingRequest(value) {
  if (!value || typeof value !== "object") {
    return { text: "", captureId: "", logGroupId: "", purpose: "transcription", webSearchUsed: false, timing: null };
  }
  return {
    text: typeof value.text === "string" ? value.text : "",
    captureId: typeof value.captureId === "string" ? value.captureId : "",
    logGroupId: typeof value.logGroupId === "string" ? value.logGroupId : "",
    purpose: value.purpose === "configuration-warning" ? "configuration-warning" : "transcription",
    webSearchUsed: value.webSearchUsed === true,
    timing: value.timing && typeof value.timing === "object" ? value.timing : null
  };
}

function beginCaptureAttempt() {
  const targetWindow = captureTextInputTarget();
  statusOverlay?.setLastTargetWindow(targetWindow);
  const attempt = {
    id: randomUUID(),
    createdAt: Date.now(),
    state: "recording",
    targetWindow,
    selectedTextPromise: undefined,
    webSearchUsed: false,
    hotkeyReleasedAt: null,
    logGroupId: null,
    timing: null
  };
  captureAttempts.set(attempt.id, attempt);
  const cleanupTimer = setTimeout(() => {
    if (captureAttempts.get(attempt.id)?.state !== "typing") captureAttempts.delete(attempt.id);
  }, CAPTURE_ATTEMPT_MAX_AGE_MS);
  cleanupTimer.unref?.();
  return attempt;
}

function getCaptureAttempt(captureId) {
  if (!captureId) return undefined;
  return captureAttempts.get(captureId);
}

async function waitForRecordingHotkeyRelease(signal) {
  const deadline = Date.now() + 1500;
  while (isRecordingHotkeyPressed()) {
    throwIfAborted(signal);
    if (Date.now() >= deadline) {
      throw new Error("Release the recording hotkey before typing the response.");
    }
    await wait(10, signal);
  }
}

function isRecordingHotkeyPressed() {
  if (voiceNativeHookActive && isModifierOnlyHotkey(currentHotkey)) {
    return voiceInputHook?.isTriggerPressed?.() === true;
  }
  return getConfiguredHotkeyKeyCodes().some((code) => pressedKeys.has(code));
}

function sanitizeText(value) {
  if (typeof value !== "string") return "";
  const text = value;
  let sanitized = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = text.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        sanitized += text[index] + text[index + 1];
        index += 1;
      } else {
        sanitized += "�";
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      sanitized += "�";
      continue;
    }
    sanitized += text[index];
  }
  return sanitized;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shutdownApplication() {
  isQuitting = true;
  cancelRadialMenuGesture();
  radialInputHook?.stop();
  radialInputHook = undefined;
  voiceInputHook?.stop();
  voiceInputHook = undefined;
  voiceNativeHookActive = false;
  radialNativeHookActive = false;
  if (hookStarted) {
    uIOhook.off?.("mousemove", handleGlobalMouseMove);
    uIOhook.stop();
    hookStarted = false;
  }
  disposeTextInput();
  selectedTextReader.dispose();
  captureAttempts.clear();
  statusOverlay?.destroy();
  statusOverlay = undefined;
  radialOverlay?.destroy();
  radialOverlay = undefined;
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
  captureWindow = undefined;
  void backendManager?.stop();
}

function handleWindowError(error) {
  console.error("Could not open the Porvoz window:", error.message);
}

function handleStartupError(error) {
  console.error("Could not start Porvoz:", error);
  dialog.showErrorBox("Porvoz could not start", error.message || "An unexpected startup error occurred.");
  app.quit();
}
