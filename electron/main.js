import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  nativeImage,
  session,
  ipcMain
} from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { uIOhook, UiohookKey } from "uiohook-napi";
import { createAppService } from "./app-service.js";
import { createLogStore } from "./log-store.js";
import { createSettingsStore } from "./settings-store.js";
import { createStatusOverlay } from "./status-overlay.js";
import {
  captureTextInputTarget,
  disposeTextInput,
  isSyntheticEscapeActive,
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
const allowedRendererPaths = new Set([
  "index.html",
  "logs.html",
  "settings.html",
  "status-overlay.html"
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

let appService;
let mainWindow;
let captureWindow;
let statusOverlay;
let tray;
let isQuitting = false;
let isHotkeyRecording = false;
let isCapturingHotkey = false;
let hookStarted = false;
let settingsStore;
let logStore;
let currentHotkey;
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
  settingsStore = createSettingsStore({
    defaultsPath: fileURLToPath(new URL("./defaults.json", import.meta.url)),
    settingsPath: path.join(app.getPath("userData"), "settings.json"),
    credentialsPath: path.join(app.getPath("userData"), "credentials.bin")
  });
  logStore = createLogStore({
    logsPath: path.join(app.getPath("userData"), "logs.json"),
    maxEntries: settingsStore.getLimits().maxLogEntries
  });
  currentHotkey = loadHotkey();
  appService = createAppService(settingsStore, logStore);

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
  registerGlobalHotkey();
}

function loadHotkey() {
  if (!settingsStore) throw new Error("The settings store is not initialized.");
  const hotkey = normalizeHotkey(settingsStore.getHotkey());
  if (!hotkey) throw new Error("The saved hotkey is invalid.");
  return hotkey;
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 720,
    minHeight: 600,
    icon: appIconPath,
    show: false,
    backgroundColor: "#0d1117",
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
    if (isCapturingHotkey) cancelHotkeyCapture("Hotkey capture canceled because Porvoz lost focus.");
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
  return nativeImage.createFromPath(appIconPath).resize({ width: 16, height: 16 });
}

function registerGlobalHotkey() {
  uIOhook.on("keydown", handleGlobalKeyDown);
  uIOhook.on("keyup", handleGlobalKeyUp);
  uIOhook.start();
  hookStarted = true;
}

function handleSettingsHotkeyInput(event, input) {
  if (!isCapturingHotkey || !["keyDown", "keyUp"].includes(input.type)) return;

  event.preventDefault();

  if (input.type === "keyDown") {
    if (input.code === "Escape") {
      cancelHotkeyCapture("Hotkey capture canceled.");
      return;
    }
    if (input.isAutoRepeat || capturePressedCodes.has(input.code)) return;
    if (input.code === "Space") {
      notifyHotkeyCaptureStatus("waiting", "Space is not available because it inserts a character.");
      return;
    }

    capturePressedCodes.add(input.code);
    captureSeenCodes.add(input.code);
    if (MODIFIER_CODES.has(input.code)) {
      notifyHotkeyCaptureStatus("waiting", "Keep holding the modifiers and press the trigger key, or release one Control/Alt key to use it alone.");
      return;
    }

    captureTriggerCode = input.code;
    captureTriggerModifiers = getCaptureModifiers(input);
    notifyHotkeyCaptureStatus("waiting", "Release the trigger key to save this hotkey.");
    return;
  }

  // A keyup can arrive after capture mode starts even when its keydown was
  // handled by the global hook. It must not clear the new capture session.
  if (!captureSeenCodes.has(input.code)) return;

  capturePressedCodes.delete(input.code);
  if (captureTriggerCode && input.code === captureTriggerCode) {
    const nextHotkey = normalizeHotkey({
      key: captureTriggerCode,
      modifiers: captureTriggerModifiers
    });
    if (nextHotkey) {
      saveHotkey(nextHotkey);
    } else {
      notifyHotkeyCaptureStatus("waiting", "Choose a supported non-modifier key.");
      clearHotkeyCaptureState();
    }
    return;
  }

  if (captureTriggerCode || capturePressedCodes.size) return;

  const onlyCode = captureSeenCodes.size === 1 ? [...captureSeenCodes][0] : undefined;
  if (onlyCode && SINGLE_MODIFIER_HOTKEY_CODES.has(onlyCode)) {
    saveHotkey(normalizeHotkey({ key: onlyCode, modifiers: [] }));
    return;
  }

  clearHotkeyCaptureState();
  notifyHotkeyCaptureStatus("waiting", "Press one Control/Alt key or hold modifiers and press a trigger key.");
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
}

function handleGlobalKeyDown(event) {
  if (event.keycode === UiohookKey.Escape) {
    if (isSyntheticEscapeActive()) return;
    if (!isCapturingHotkey) cancelActiveActivity();
    return;
  }
  if (isCapturingHotkey) return;
  if (event.keycode === suppressedHotkeyKeyCode) return;
  const hotkeyKeyCode = getUiohookKeyCode(currentHotkey.key);
  pressedKeys.add(event.keycode);
  const requiredModifiersPressed = currentHotkey.modifiers.every((modifier) => isModifierPressed(modifier, event));
  if (event.keycode === hotkeyKeyCode
    && requiredModifiersPressed
    && !isHotkeyRecording) {
    isHotkeyRecording = true;
    const setupStatus = appService.getSetupStatus();
    if (setupStatus.ready) {
      const attempt = beginCaptureAttempt();
      sendHotkeyAction("start", { captureId: attempt.id });
    } else {
      sendHotkeyAction("configuration-needed", { message: setupStatus.hotkeyMessage });
    }
  }
}

function handleGlobalKeyUp(event) {
  if (event.keycode === suppressedHotkeyKeyCode) {
    pressedKeys.delete(event.keycode);
    suppressedHotkeyKeyCode = undefined;
    return;
  }
  pressedKeys.delete(event.keycode);
  const hotkeyKeyCode = getUiohookKeyCode(currentHotkey.key);
  const modifierKeyCodes = currentHotkey.modifiers.flatMap((modifier) => MODIFIER_KEYCODES[modifier] || []);
  if (isHotkeyRecording && (event.keycode === hotkeyKeyCode || modifierKeyCodes.includes(event.keycode))) {
    isHotkeyRecording = false;
    for (const attempt of captureAttempts.values()) {
      if (attempt.state === "recording") attempt.state = "processing";
    }
    sendHotkeyAction("stop");
  }
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
  if (MODIFIER_CODES.has(value.key) && !SINGLE_MODIFIER_HOTKEY_CODES.has(value.key)) {
    return null;
  }
  if (SINGLE_MODIFIER_HOTKEY_CODES.has(value.key) && modifiers.length) return null;
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
    setOverlayStatus({ message: "Finishing recording…", state: "processing", stage: "recording" });
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
  ipcMain.handle("porvoz:get-runtime-config", () => appService.getRuntimeConfig());
  ipcMain.handle("porvoz:get-connection-settings", () => appService.getConnectionSettings());
  ipcMain.handle("porvoz:get-setup-status", () => appService.getSetupStatus());
  ipcMain.handle("porvoz:save-connection", (_event, value) => {
    const result = appService.saveConnection(value);
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
  ipcMain.handle("porvoz:save-model-selections", (_event, value) => {
    const result = appService.saveModelSelections(value);
    notifySetupUpdated();
    return result;
  });
  ipcMain.handle("porvoz:save-prompt", (_event, value) => appService.savePrompt(value));
  ipcMain.handle("porvoz:reset-prompt", () => appService.resetPrompt());
  ipcMain.handle("porvoz:save-prefix-settings", (_event, value) => appService.savePrefixSettings(value));
  ipcMain.handle("porvoz:get-logs", () => appService.getLogs());
  ipcMain.handle("porvoz:log-error", (_event, value) => {
    const result = appService.logError(value);
    notifyLogsUpdated();
    return result;
  });
  ipcMain.handle("porvoz:clear-logs", () => {
    const logs = appService.clearLogs();
    notifyLogsUpdated(logs);
    return logs;
  });
  ipcMain.handle("porvoz:reset-to-defaults", () => {
    const runtimeConfig = appService.resetToDefaults();
    currentHotkey = loadHotkey();
    suppressedHotkeyKeyCode = undefined;
    tray?.setToolTip(`Porvoz · Hold ${currentHotkey.label} to transcribe`);
    notifyHotkeyUpdated();
    notifySetupUpdated();
    updateTrayMenu();
    return runtimeConfig;
  });
  ipcMain.handle("porvoz:transcribe", (_event, value) => runActiveOperation(async (signal) => {
    setOverlayStatus({ message: "Transcribing…", state: "transcribing", stage: "transcription" });
    try {
      const result = await appService.transcribe(value, { signal });
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
  ipcMain.handle("porvoz:instruct", (_event, value) => runActiveOperation(async (signal) => {
    setOverlayStatus({ message: "Applying instructions…", state: "processing", stage: "instruction" });
    try {
      const result = await appService.instruct(value, {
        readClipboard: () => clipboard.readText(),
        signal
      });
      notifyLogsUpdated();
      return result;
    } catch (error) {
      if (isCancellationError(error)) {
        setOverlayStatus({ state: "idle" });
        throw error;
      }
      notifyLogsUpdated();
      setOverlayStatus({
        message: error.message || "Could not apply the instructions.",
        state: "error",
        stage: "instruction"
      });
      throw error;
    }
  }));
  ipcMain.handle("porvoz:create-prefix-from-voice", (_event, value) => runActiveOperation((signal) =>
    appService.createPrefixFromVoice(value, { signal })));
  ipcMain.handle("porvoz:get-hotkey", () => currentHotkey);
  ipcMain.handle("porvoz:begin-hotkey-capture", () => {
    isCapturingHotkey = true;
    isHotkeyRecording = false;
    pressedKeys.clear();
    clearHotkeyCaptureState();
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
  ipcMain.handle("porvoz:save-sound-volume", (_event, value) => {
    const soundVolume = appService.saveSoundVolume(value);
    notifySoundVolumeUpdated(soundVolume);
    return soundVolume;
  });
  ipcMain.on("porvoz:status", (_event, value) => {
    if (!value || typeof value !== "object") return;
    if (ACTIVE_ACTIVITY_STATES.has(value.state)) rendererActivities.add(_event.sender.id);
    else rendererActivities.delete(_event.sender.id);
    setOverlayStatus(value);
  });
  ipcMain.handle("porvoz:type-text", (_event, value) => runActiveOperation(async (signal) => {
    const request = normalizeTypingRequest(value);
    if (!request.text) return false;
    setOverlayStatus({ message: "Placing text…", state: "typing", stage: "typing" });
    try {
      await typeTextAtCursor(request, signal);
      setOverlayStatus({ message: "Text placed.", state: "success", stage: "typing" });
      return true;
    } catch (error) {
      if (isCancellationError(error)) {
        setOverlayStatus({ state: "idle" });
        throw error;
      }
      appService.logError({ stage: "typing", error });
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
  currentHotkey = nextHotkey;
  settingsStore.saveHotkey(currentHotkey);
  isCapturingHotkey = false;
  isHotkeyRecording = false;
  pressedKeys.clear();
  clearHotkeyCaptureState();
  suppressedHotkeyKeyCode = getUiohookKeyCode(currentHotkey.key);
  tray?.setToolTip(`Porvoz · Hold ${currentHotkey.label} to transcribe`);
  notifyHotkeyUpdated();
  updateTrayMenu();
  return currentHotkey;
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
  clearHotkeyCaptureWatchdog();
  isCapturingHotkey = false;
  isHotkeyRecording = false;
  pressedKeys.clear();
  clearHotkeyCaptureState();
  notifyHotkeyCaptureStatus("canceled", message);
}

function startHotkeyCaptureWatchdog() {
  clearHotkeyCaptureWatchdog();
  hotkeyCaptureTimer = setTimeout(() => {
    if (isCapturingHotkey) cancelHotkeyCapture("Hotkey capture timed out.");
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
  const payload = { count: Array.isArray(logs) ? logs.length : appService.getLogs().length };
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
    return { text: "", captureId: "", purpose: "transcription" };
  }
  return {
    text: typeof value.text === "string" ? value.text : "",
    captureId: typeof value.captureId === "string" ? value.captureId : "",
    purpose: value.purpose === "configuration-warning" ? "configuration-warning" : "transcription"
  };
}

function beginCaptureAttempt() {
  const attempt = {
    id: randomUUID(),
    createdAt: Date.now(),
    state: "recording",
    targetWindow: captureTextInputTarget()
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
  const hotkeyCodes = [
    getUiohookKeyCode(currentHotkey?.key),
    ...(currentHotkey?.modifiers || []).flatMap((modifier) => MODIFIER_KEYCODES[modifier] || [])
  ].filter((code) => code !== undefined);
  return hotkeyCodes.some((code) => pressedKeys.has(code));
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
  if (hookStarted) {
    uIOhook.stop();
    hookStarted = false;
  }
  disposeTextInput();
  captureAttempts.clear();
  statusOverlay?.destroy();
  statusOverlay = undefined;
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
  captureWindow = undefined;
}

function handleWindowError(error) {
  console.error("Could not open the Porvoz window:", error.message);
}

function handleStartupError(error) {
  console.error("Could not start Porvoz:", error);
  dialog.showErrorBox("Porvoz could not start", error.message || "An unexpected startup error occurred.");
  app.quit();
}
