import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// The browser modules are ES modules meant for a page. Each test evaluates one
// of them with its imports replaced by explicit stubs, so the behavior under
// test is the shipped source rather than a restatement of it.
function moduleSource(name) {
  return readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/^export /gm, "");
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} was not found`);
  const end = source.indexOf("\nfunction ", start);
  return source.slice(start, end < 0 ? undefined : end);
}

function runMediaSupport(overrides) {
  const context = vm.createContext({
    window: { isSecureContext: true, MediaRecorder: class {}, ...overrides.window },
    navigator: { mediaDevices: { getUserMedia: async () => ({}) }, ...overrides.navigator },
    MediaRecorder: overrides.MediaRecorder === undefined
      ? Object.assign(class {}, { isTypeSupported: () => true })
      : overrides.MediaRecorder
  });
  if (context.window.MediaRecorder === undefined) delete context.window.MediaRecorder;
  vm.runInContext(`${moduleSource("media-support.js")}\nglobalThis.result = getRecordingSupport();`, context);
  return context.result;
}

test("one capability check decides recording for Capture and voice prefixes alike", () => {
  const supported = runMediaSupport({});
  assert.equal(supported.supported, true);
  assert.equal(supported.mimeType, "audio/webm;codecs=opus");

  // Plain HTTP to a remote host is not a secure context, so both entry points
  // are turned off with the same explanation.
  const insecure = runMediaSupport({ window: { isSecureContext: false } });
  assert.equal(insecure.supported, false);
  assert.equal(insecure.reason, "insecure-context");
  assert.match(insecure.message, /HTTPS|localhost/);

  const noDevices = runMediaSupport({ navigator: { mediaDevices: undefined } });
  assert.equal(noDevices.reason, "no-media-devices");

  const noRecorder = runMediaSupport({
    window: { isSecureContext: true, MediaRecorder: undefined },
    MediaRecorder: undefined
  });
  assert.equal(noRecorder.reason, "no-recorder");

  const noFormat = runMediaSupport({
    MediaRecorder: Object.assign(class {}, { isTypeSupported: () => false })
  });
  assert.equal(noFormat.reason, "no-format");
  assert.match(noFormat.message, /recording format/);

  // A recorder without isTypeSupported falls back to the browser's own default.
  const defaultFormat = runMediaSupport({ MediaRecorder: class {} });
  assert.equal(defaultFormat.supported, true);
  assert.equal(defaultFormat.mimeType, "");
});

test("recording controls that are turned off never reach the microphone", () => {
  const captureSource = moduleSource("app.js");
  const started = extractFunction(captureSource, "async function startTranscription(");
  let microphoneRequests = 0;
  let loggedStage = "";
  const context = vm.createContext({
    activityGeneration: 0,
    recordingSupport: { supported: false, message: "Recording needs a secure connection." },
    navigator: { mediaDevices: { getUserMedia: async () => { microphoneRequests += 1; return {}; } } },
    logClientError: (stage) => { loggedStage = stage; },
    setStatus: (message, state) => { context.statusMessage = message; context.statusState = state; },
    updateTranscribeButtonLabel() {},
    updateActionButtons() {},
    getMicrophoneStream: async () => { microphoneRequests += 1; return {}; }
  });
  vm.runInContext(started, context);
  const finished = context.startTranscription({ playStartCue: true });

  return finished.then(() => {
    assert.equal(microphoneRequests, 0);
    assert.equal(loggedStage, "recording");
    assert.equal(context.statusState, "error");
    assert.match(context.statusMessage, /secure connection/);
    // Nothing was recorded, so no upload state was entered either.
    assert.equal(context.isTranscribing, undefined);
  });
});

test("voice prefix creation refuses to record when the browser cannot", () => {
  const settingsSource = moduleSource("settings.js");
  const start = extractFunction(settingsSource, "async function startPrefixRecording()");
  let microphoneRequests = 0;
  const context = vm.createContext({
    prefixRecorder: undefined,
    prefixDialog: { open: true },
    prefixFlowToken: 0,
    recordingSupport: { supported: false, message: "This browser cannot record audio." },
    prefixRecordStartButton: { disabled: false },
    prefixRecordStopButton: { hidden: true, disabled: false },
    prefixRecordStatus: { textContent: "", dataset: {} },
    prefixRecordOrb: { dataset: {} },
    bridge: { setStatus() {} },
    navigator: { mediaDevices: { getUserMedia: async () => { microphoneRequests += 1; return {}; } } },
    setPrefixRecordError(message) {
      context.prefixRecordStatus.textContent = message;
      context.prefixRecordStatus.dataset.state = "error";
    }
  });
  vm.runInContext(start, context);

  return context.startPrefixRecording().then(() => {
    assert.equal(microphoneRequests, 0);
    assert.equal(context.prefixRecordStartButton.disabled, true);
    assert.match(context.prefixRecordStatus.textContent, /cannot record audio/);
    assert.equal(context.prefixRecordStatus.dataset.state, "error");
  });
});

function createBrowserBridgeContext({ responses = {}, storage = new Map() } = {}) {
  const calls = [];
  const context = vm.createContext({
    console,
    FormData,
    Blob,
    window: {
      porvozDesktop: undefined,
      localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key)
      }
    },
    request: async (path, options = {}) => {
      calls.push({ path, ...options });
      const [route, query] = path.split("?");
      const responder = responses[path] ?? responses[route];
      if (typeof responder === "function") {
        return responder({ ...options, ...Object.fromEntries(new URLSearchParams(query || "")) });
      }
      return responder ?? {};
    },
    signOut: async () => { calls.push({ path: "signOut" }); }
  });
  vm.runInContext(
    `${moduleSource("app-bridge.js")}
globalThis.bridge = bridge;`,
    context);
  return { context, calls, storage, bridge: context.bridge };
}

test("the browser bridge reports desktop capabilities as unavailable instead of pretending", () => {
  const { bridge } = createBrowserBridgeContext();
  assert.equal(bridge.environment, "browser");
  assert.equal(bridge.isElectron, false);
  assert.equal(bridge.isAvailable, true);
  for (const capability of ["hotkeys", "sounds", "consoleSelection", "serverSwitching",
    "typing", "systemClipboard", "desktopStatus", "activityEvents"]) {
    assert.equal(bridge.features[capability], false, `${capability} should be unavailable`);
  }
  assert.equal(bridge.features.signOut, true);

  // Absent methods let the shared pages fall back to browser clipboard APIs and
  // skip desktop-only operations rather than call something that would fail.
  for (const method of ["writeClipboardText", "readClipboardText", "typeText", "getHotkey",
    "beginHotkeyCapture", "saveSoundVolume", "saveConsoleSelectionEnabled",
    "getBackendSettings", "saveBackendSettings"]) {
    assert.equal(bridge[method], undefined, `${method} should not exist in the browser`);
  }

  // Status reporting and event subscriptions are accepted and do nothing.
  assert.equal(bridge.setStatus({ state: "idle" }), undefined);
  assert.equal(typeof bridge.onLogsUpdated(() => {}), "function");
});

test("the browser remembers its own selected profile without changing the server's", async () => {
  const storage = new Map();
  const runtimeFor = (id) => ({ activeProfileId: id, profiles: [{ id }] });
  const { bridge, calls } = createBrowserBridgeContext({
    storage,
    responses: {
      "/v1/porvoz/runtime": (options) => runtimeFor(options.profileId || "server-default")
    }
  });

  await bridge.getRuntimeConfig();
  assert.equal(storage.get("porvoz.web.activeProfileId"), "server-default");

  const switched = await bridge.setActiveProfile({ id: "second-profile" });
  assert.equal(switched.activeProfileId, "second-profile");
  assert.equal(storage.get("porvoz.web.activeProfileId"), "second-profile");
  // Selecting a profile only reads the runtime for it; nothing writes the
  // server's own active profile, which other clients share.
  assert.deepEqual(calls.map((call) => `${call.method || "GET"} ${call.path}`), [
    "GET /v1/porvoz/runtime",
    "GET /v1/porvoz/runtime?profileId=second-profile"
  ]);
});

test("a profile deleted elsewhere falls back to the server's active profile", async () => {
  const storage = new Map([["porvoz.web.activeProfileId", "deleted-profile"]]);
  let attempted = 0;
  const { bridge, calls } = createBrowserBridgeContext({
    storage,
    responses: {
      "/v1/porvoz/runtime": () => {
        attempted += 1;
        if (attempted === 1) throw Object.assign(new Error("no such profile"), { status: 500 });
        return { activeProfileId: "still-here", profiles: [{ id: "still-here" }] };
      }
    }
  });

  const runtime = await bridge.getRuntimeConfig();
  assert.equal(runtime.activeProfileId, "still-here");
  assert.equal(storage.get("porvoz.web.activeProfileId"), "still-here");
  assert.equal(calls[0].path, "/v1/porvoz/runtime?profileId=deleted-profile");
  assert.equal(calls[1].path, "/v1/porvoz/runtime");
});

test("browser capture uploads audio without clipboard or selected-text context", async () => {
  const storage = new Map([["porvoz.web.activeProfileId", "chosen-profile"]]);
  const { bridge, calls } = createBrowserBridgeContext({
    storage,
    responses: {
      "/v1/audio/transcriptions": {
        text: "instruction result",
        porvoz: { raw_transcript: "raw dictation", instruction_applied: true, log_group_id: "group-1" }
      },
      "/v1/porvoz/prefixes/from-audio": { prefix: { name: "tidy" }, transcript: "make a tidy prefix" }
    }
  });

  const result = await bridge.transcribe({
    audio: new Uint8Array([1, 2, 3]).buffer,
    mimeType: "audio/webm;codecs=opus"
  });
  // The bridge builds this object inside the sandbox, so it is compared by
  // value rather than by prototype identity.
  assert.deepEqual({ ...result }, {
    transcript: "instruction result",
    rawTranscript: "raw dictation",
    instructionApplied: true,
    logGroupId: "group-1"
  });

  const upload = calls.find((call) => call.path === "/v1/audio/transcriptions");
  assert.equal(upload.method, "POST");
  assert.equal(upload.body.get("model"), "chosen-profile");
  assert.equal(upload.body.get("response_format"), "json");
  assert.equal(upload.body.get("file").name, "transcription.webm");
  // The page never reads the clipboard or the selection, so no context field
  // is sent at all — a prefix that permits clipboard context receives nothing.
  assert.equal(upload.body.get("porvoz_context"), null);

  await bridge.createPrefixFromVoice({ audio: new Uint8Array([4]).buffer, mimeType: "audio/mp4" });
  const prefixUpload = calls.find((call) => call.path === "/v1/porvoz/prefixes/from-audio");
  assert.equal(prefixUpload.body.get("model"), "chosen-profile");
  assert.equal(prefixUpload.body.get("file").name, "prefix-brief.mp4");
});

test("the same-origin client carries the request token and returns to sign-in when it expires", async () => {
  const requests = [];
  let assigned = "";
  const context = vm.createContext({
    console,
    URLSearchParams,
    document: { cookie: "other=1; porvoz_csrf=token%2Dvalue; porvoz_session=hidden" },
    window: { location: { pathname: "/settings.html", assign: (value) => { assigned = value; } } },
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === "/v1/porvoz/logs") {
        return { ok: false, status: 401, json: async () => ({ error: { message: "Signed out." } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
  });
  vm.runInContext(
    `${moduleSource("web-client.js")}
globalThis.request = request;
globalThis.readCsrfToken = readCsrfToken;`,
    context);

  assert.equal(context.readCsrfToken(), "token-value");
  await context.request("/v1/porvoz/runtime");
  assert.equal(requests[0].options.headers["x-porvoz-csrf"], "token-value");
  assert.equal(requests[0].options.credentials, "same-origin");

  await assert.rejects(context.request("/v1/porvoz/logs"), /Signed out/);
  assert.equal(assigned, "/?reason=expired&next=%2Fsettings.html");
});

function runEnvironmentChrome({ browser, withDialog = true } = {}) {
  const removed = [];
  const revealed = [];
  const element = (name, extra = {}) => ({
    name,
    hidden: true,
    dataset: {},
    remove() { removed.push(name); },
    addEventListener(type, handler) { this.handler = handler; },
    ...extra
  });
  const desktopOnly = [element("keyboard-card"), element("sound-card"), element("server-card")];
  const sharedCopy = [element("reset-copy", {
    textContent: "desktop wording",
    dataset: { sharedServerText: "This affects every client of this server." }
  })];
  const signOutButton = element("sign-out");
  const dialog = element("sign-out-dialog", { open: false, showModal() { this.open = true; } });
  // Both the control and its dialog belong to the website only.
  const webOnly = withDialog ? [element("sign-out-link"), dialog] : [element("sign-out-link")];
  const confirmButton = element("confirm-sign-out", { disabled: false });
  const cancelButton = element("cancel-sign-out", { disabled: false });
  const byId = withDialog
    ? {
        "#sign-out": signOutButton,
        "#sign-out-dialog": dialog,
        "#confirm-sign-out": confirmButton,
        "#cancel-sign-out": cancelButton
      }
    : { "#sign-out": signOutButton };
  const documentElement = { dataset: {} };
  const context = vm.createContext({
    document: {
      documentElement,
      querySelectorAll(selector) {
        if (selector === "[data-desktop-only]") return desktopOnly;
        if (selector === "[data-web-only]") return webOnly;
        if (selector === "[data-shared-server-text]") return sharedCopy;
        return [];
      },
      querySelector: (selector) => byId[selector] || null
    },
    bridge: {
      environment: browser ? "browser" : "desktop",
      signOut: async () => { context.signedOut = true; }
    },
    isBrowserAdministration: browser
  });
  vm.runInContext(moduleSource("environment-chrome.js"), context);
  webOnly.forEach((item) => { if (!item.hidden) revealed.push(item.name); });
  return {
    context, documentElement, removed, revealed, sharedCopy,
    signOutButton, dialog, confirmButton, cancelButton
  };
}

test("the website drops desktop-only surfaces and states what shared actions affect", () => {
  const web = runEnvironmentChrome({ browser: true });
  assert.equal(web.documentElement.dataset.environment, "browser");
  assert.deepEqual(web.removed, ["keyboard-card", "sound-card", "server-card"]);
  assert.deepEqual(web.revealed, ["sign-out-link", "sign-out-dialog"]);
  assert.equal(web.sharedCopy[0].textContent, "This affects every client of this server.");
  // The dialog is part of the website and is revealed with the rest of it.
  assert.equal(web.dialog.hidden, false);
});

test("logging out asks before it ends the session", async () => {
  const web = runEnvironmentChrome({ browser: true });

  web.signOutButton.handler({ preventDefault() {} });
  assert.equal(web.dialog.open, true);
  // Opening the question must not answer it.
  await Promise.resolve();
  assert.equal(web.context.signedOut, undefined);

  web.confirmButton.handler();
  await Promise.resolve();
  assert.equal(web.context.signedOut, true);
  // Both controls lock while the request is in flight.
  assert.equal(web.confirmButton.disabled, true);
  assert.equal(web.cancelButton.disabled, true);
});

test("a missing confirmation dialog leaves Log out working rather than dead", async () => {
  const web = runEnvironmentChrome({ browser: true, withDialog: false });
  web.signOutButton.handler({ preventDefault() {} });
  await Promise.resolve();
  assert.equal(web.context.signedOut, true);
});

test("the desktop drops the website's own controls and keeps its wording", () => {
  const desktop = runEnvironmentChrome({ browser: false });
  assert.equal(desktop.documentElement.dataset.environment, "desktop");
  assert.deepEqual(desktop.removed, ["sign-out-link", "sign-out-dialog"]);
  assert.equal(desktop.sharedCopy[0].textContent, "desktop wording");
  // Nothing was wired up, so the desktop never reaches a browser-only action.
  assert.equal(desktop.signOutButton.handler, undefined);
});

test("the desktop bridge forwards Electron's own methods and keeps its capabilities", () => {
  // contextBridge exposes a frozen object; the bridge must read through it
  // without needing to restate every method the preload provides.
  const invocations = [];
  const preload = Object.freeze({
    isElectron: true,
    getHotkey: () => { invocations.push("getHotkey"); return { label: "Right Ctrl" }; },
    typeText: (value) => { invocations.push(`typeText:${value.text}`); },
    writeClipboardText: () => { invocations.push("writeClipboardText"); },
    onHotkey: (callback) => { invocations.push("onHotkey"); return () => {}; }
  });
  const context = vm.createContext({
    console,
    window: { porvozDesktop: preload, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } },
    request: async () => ({}),
    signOut: async () => {}
  });
  vm.runInContext(
    `${moduleSource("app-bridge.js")}\nglobalThis.bridge = bridge;\nglobalThis.isBrowser = isBrowserAdministration;`,
    context);
  const bridge = context.bridge;

  assert.equal(context.isBrowser, false);
  assert.equal(bridge.environment, "desktop");
  assert.equal(bridge.isElectron, true);
  for (const capability of ["hotkeys", "sounds", "consoleSelection", "serverSwitching",
    "typing", "systemClipboard", "desktopStatus", "activityEvents"]) {
    assert.equal(bridge.features[capability], true, `${capability} should be available`);
  }
  // Signing out belongs to the website; the desktop has no session to end.
  assert.equal(bridge.features.signOut, false);
  assert.equal(bridge.signOut, undefined);

  assert.deepEqual({ ...bridge.getHotkey() }, { label: "Right Ctrl" });
  bridge.typeText({ text: "dictated" });
  bridge.writeClipboardText("copied");
  assert.equal(typeof bridge.onHotkey(() => {}), "function");
  assert.deepEqual(invocations, ["getHotkey", "typeText:dictated", "writeClipboardText", "onHotkey"]);
});
