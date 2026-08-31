import { loadRuntimeConfig } from "./runtime-config.js";
import { isRecordingTooShort } from "./capture-policy.js";

const baseUrlInput = document.querySelector("#base-url");
const apiKeyInput = document.querySelector("#api-key");
const verifyCertificateInput = document.querySelector("#verify-certificate");
const connectionForm = document.querySelector("#connection-form");
const connectionStatus = document.querySelector("#connection-status");
const transcriptionModel = document.querySelector("#transcription-model");
const instructionModel = document.querySelector("#instruction-model");
const populateModelsButton = document.querySelector("#populate-models");
const modelStatus = document.querySelector("#model-status");
const instructionPrompt = document.querySelector("#instruction-prompt");
const promptStatus = document.querySelector("#prompt-status");
const resetPromptButton = document.querySelector("#reset-prompt");
const addPrefixButton = document.querySelector("#add-prefix");
const prefixList = document.querySelector("#prefix-list");
const prefixEmpty = document.querySelector("#prefix-empty");
const prefixStatus = document.querySelector("#prefix-status");
const prefixDialog = document.querySelector("#prefix-dialog");
const closePrefixDialogButton = document.querySelector("#close-prefix-dialog");
const prefixChoiceView = document.querySelector("#prefix-choice-view");
const prefixRecordView = document.querySelector("#prefix-record-view");
const prefixPreviewView = document.querySelector("#prefix-preview-view");
const voicePrefixOption = document.querySelector("#voice-prefix-option");
const manualPrefixOption = document.querySelector("#manual-prefix-option");
const prefixRecordOrb = document.querySelector("#prefix-record-orb");
const prefixRecordStatus = document.querySelector("#prefix-record-status");
const prefixRecordCancelButton = document.querySelector("#prefix-record-cancel");
const prefixRecordStartButton = document.querySelector("#prefix-record-start");
const prefixRecordStopButton = document.querySelector("#prefix-record-stop");
const prefixPreviewTranscript = document.querySelector("#prefix-preview-transcript");
const prefixPreviewName = document.querySelector("#prefix-preview-name");
const prefixPreviewInstruction = document.querySelector("#prefix-preview-instruction");
const prefixPreviewStatus = document.querySelector("#prefix-preview-status");
const prefixPreviewCancelButton = document.querySelector("#prefix-preview-cancel");
const prefixPreviewAddButton = document.querySelector("#prefix-preview-add");
const resetDefaultsButton = document.querySelector("#reset-defaults");
const resetDialog = document.querySelector("#reset-dialog");
const confirmResetButton = document.querySelector("#confirm-reset");
const cancelResetButton = document.querySelector("#cancel-reset");
const resetStatus = document.querySelector("#reset-status");
const promptResetDialog = document.querySelector("#prompt-reset-dialog");
const confirmPromptResetButton = document.querySelector("#confirm-prompt-reset");
const captureHotkeyButton = document.querySelector("#capture-hotkey");
const cancelHotkeyButton = document.querySelector("#cancel-hotkey");
const hotkeyDisplay = document.querySelector("#hotkey-display");
const hotkeyStatus = document.querySelector("#hotkey-status");
const soundVolumeInput = document.querySelector("#sound-volume");
const soundVolumeValue = document.querySelector("#sound-volume-value");
const soundVolumeStatus = document.querySelector("#sound-volume-status");
const desktopBridge = window.porvozDesktop;

let runtimeConfig = await loadRuntimeConfig();
let prefixConfig = runtimeConfig.prefixes.map(normalizePrefix);
let isCapturingHotkey = false;
let promptSaveTimer;
let prefixSaveTimer;
let prefixSaveQueue = Promise.resolve();
let modelSaveQueue = Promise.resolve();
let soundVolumeSaveTimer;
let prefixRecorder;
let prefixRecordingStream;
let prefixRecordedChunks = [];
let prefixRecordingStartedAt = 0;
let prefixRecordingDiscarded = false;
let prefixFlowToken = 0;

baseUrlInput.maxLength = 2048;
apiKeyInput.maxLength = 4096;
instructionPrompt.maxLength = runtimeConfig.limits.maxInstructionPromptCharacters;

loadConnectionSettings();
renderModels();
initializeInstructionPrompt();
renderPrefixes();
renderSoundVolume(runtimeConfig.soundVolume);
await initializeHotkey();

connectionForm.addEventListener("submit", saveConnection);
populateModelsButton.addEventListener("click", populateModels);
transcriptionModel.addEventListener("change", saveModelSelections);
instructionModel.addEventListener("change", saveModelSelections);
instructionPrompt.addEventListener("input", handlePromptInput);
resetPromptButton.addEventListener("click", () => promptResetDialog.showModal());
addPrefixButton.addEventListener("click", openPrefixDialog);
closePrefixDialogButton.addEventListener("click", () => prefixDialog.close());
voicePrefixOption.addEventListener("click", showVoicePrefixRecorder);
manualPrefixOption.addEventListener("click", addPrefixManually);
prefixRecordCancelButton.addEventListener("click", returnToPrefixChoices);
prefixRecordStartButton.addEventListener("click", startPrefixRecording);
prefixRecordStopButton.addEventListener("click", stopPrefixRecording);
prefixPreviewCancelButton.addEventListener("click", () => prefixDialog.close());
prefixPreviewAddButton.addEventListener("click", addPreviewPrefix);
prefixDialog.addEventListener("close", resetPrefixDialog);
resetDefaultsButton.addEventListener("click", () => resetDialog.showModal());
confirmResetButton.addEventListener("click", resetToDefaults);
confirmPromptResetButton.addEventListener("click", resetPromptToDefault);
cancelResetButton.addEventListener("click", () => resetDialog.close());
captureHotkeyButton.addEventListener("click", beginHotkeyCapture);
cancelHotkeyButton.addEventListener("click", cancelHotkeyCapture);
soundVolumeInput.addEventListener("input", updateSoundVolumePreview);
soundVolumeInput.addEventListener("change", saveSoundVolume);

if (desktopBridge?.isElectron) {
  desktopBridge.onHotkeyUpdated(handleHotkeyUpdated);
  desktopBridge.onHotkeyCaptureStatus(handleHotkeyCaptureStatus);
  desktopBridge.onSoundVolumeUpdated(handleSoundVolumeUpdated);
}

async function loadConnectionSettings() {
  try {
    if (!desktopBridge?.isElectron) throw new Error("Porvoz must be running as the Electron app.");
    const result = await desktopBridge.getConnectionSettings();
    renderConnectionSettings(result);
  } catch (error) {
    connectionStatus.textContent = error.message;
    connectionStatus.dataset.state = "error";
  }
}

function renderConnectionSettings(result) {
  baseUrlInput.value = result.baseUrl || "";
  verifyCertificateInput.checked = result.verifyCertificate !== false;
  apiKeyInput.value = "";
  apiKeyInput.placeholder = result.apiKeyConfigured
    ? "Stored securely — enter a new key to replace it"
    : "Paste the API key";
  connectionStatus.textContent = "Connection ready.";
  connectionStatus.dataset.state = "success";
}

async function saveConnection(event) {
  event.preventDefault();
  const submitButton = connectionForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  connectionStatus.textContent = "Saving connection…";
  connectionStatus.dataset.state = "saving";

  try {
    if (!desktopBridge?.isElectron) throw new Error("Porvoz must be running as the Electron app.");
    const result = await desktopBridge.saveConnection({
      baseUrl: baseUrlInput.value,
      apiKey: apiKeyInput.value,
      verifyCertificate: verifyCertificateInput.checked
    });
    renderConnectionSettings(result);
    runtimeConfig = await desktopBridge.getRuntimeConfig();
    renderModels();
    connectionStatus.textContent = "Connection saved securely.";
    connectionStatus.dataset.state = "success";
  } catch (error) {
    connectionStatus.textContent = error.message;
    connectionStatus.dataset.state = "error";
  } finally {
    submitButton.disabled = false;
  }
}

function renderModels() {
  const models = runtimeConfig.models.available;
  renderModelSelect(transcriptionModel, models, runtimeConfig.models.selected.transcription, "Choose a transcription model");
  renderModelSelect(instructionModel, models, runtimeConfig.models.selected.instruction, "Choose an instruction model");
  const hasModels = models.length > 0;
  transcriptionModel.disabled = !hasModels;
  instructionModel.disabled = !hasModels;
  modelStatus.textContent = hasModels
    ? `${models.length} models loaded from the configured endpoint.`
    : "No models loaded yet. Save the connection, then load models.";
  modelStatus.dataset.state = hasModels ? "success" : "idle";
}

function renderModelSelect(select, models, selectedModel, placeholderText) {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = placeholderText;
  placeholder.disabled = true;
  select.replaceChildren(placeholder, ...createModelGroups(models));
  select.value = selectedModel || "";
}

async function populateModels() {
  populateModelsButton.disabled = true;
  modelStatus.textContent = "Loading every model from the endpoint…";
  modelStatus.dataset.state = "loading";
  try {
    if (!desktopBridge?.isElectron) throw new Error("Porvoz must be running as the Electron app.");
    runtimeConfig = await desktopBridge.populateModels();
    renderModels();
  } catch (error) {
    console.error("Could not load models:", error);
    modelStatus.textContent = error.message || "Could not load models.";
    modelStatus.dataset.state = "error";
  } finally {
    populateModelsButton.disabled = false;
  }
}

function saveModelSelections() {
  const selections = {
    transcription: transcriptionModel.value,
    instruction: instructionModel.value
  };
  const previousStatus = modelStatus.textContent;
  modelStatus.textContent = "Saving model selections…";
  modelStatus.dataset.state = "saving";
  modelSaveQueue = modelSaveQueue.catch(() => {}).then(async () => {
    try {
      runtimeConfig = await desktopBridge.saveModelSelections(selections);
      modelStatus.textContent = `${runtimeConfig.models.available.length} models loaded. Selections saved.`;
      modelStatus.dataset.state = "success";
    } catch (error) {
      try {
        runtimeConfig = await desktopBridge.getRuntimeConfig();
        renderModels();
      } catch (refreshError) {
        console.error("Could not restore model selections:", refreshError);
      }
      modelStatus.textContent = error.message || previousStatus;
      modelStatus.dataset.state = "error";
    }
  });
  return modelSaveQueue;
}

function createModelGroups(models) {
  const groups = new Map([
    ["OpenAI / Codex", []],
    ["Anthropic / Claude", []],
    ["Other", []]
  ]);

  for (const model of [...models].sort((first, second) => first.localeCompare(second))) {
    const normalizedModel = model.toLocaleLowerCase();
    const group = normalizedModel.includes("claude")
      ? "Anthropic / Claude"
      : normalizedModel.includes("gpt") || normalizedModel.includes("codex") || normalizedModel.startsWith("openai/")
        ? "OpenAI / Codex"
        : "Other";
    groups.get(group).push(model);
  }

  return Array.from(groups, ([label, groupModels]) => {
    if (!groupModels.length) return null;
    const optgroup = document.createElement("optgroup");
    optgroup.label = label;
    for (const model of groupModels) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      optgroup.append(option);
    }
    return optgroup;
  }).filter(Boolean);
}

function initializeInstructionPrompt() {
  instructionPrompt.value = runtimeConfig.prompt;
  autoResizeTextarea(instructionPrompt);
}

function handlePromptInput() {
  autoResizeTextarea(instructionPrompt);
  clearTimeout(promptSaveTimer);
  promptStatus.textContent = "Saving…";
  promptStatus.dataset.state = "saving";
  promptSaveTimer = setTimeout(async () => {
    try {
      runtimeConfig.prompt = await desktopBridge.savePrompt(instructionPrompt.value);
      promptStatus.textContent = "Saved.";
      promptStatus.dataset.state = "success";
    } catch (error) {
      promptStatus.textContent = error.message || "Could not save the prompt.";
      promptStatus.dataset.state = "error";
    }
  }, 250);
}

async function resetPromptToDefault(event) {
  event.preventDefault();
  clearTimeout(promptSaveTimer);
  confirmPromptResetButton.disabled = true;
  promptStatus.textContent = "Restoring the packaged prompt…";
  promptStatus.dataset.state = "saving";
  try {
    if (!desktopBridge?.isElectron) throw new Error("Porvoz must be running as the Electron app.");
    runtimeConfig.prompt = await desktopBridge.resetPrompt();
    initializeInstructionPrompt();
    promptResetDialog.close();
    promptStatus.textContent = "Prompt reset to defaults.";
    promptStatus.dataset.state = "success";
  } catch (error) {
    promptStatus.textContent = error.message || "Could not reset the prompt.";
    promptStatus.dataset.state = "error";
  } finally {
    confirmPromptResetButton.disabled = false;
  }
}

function renderPrefixes() {
  prefixList.replaceChildren();
  prefixConfig.forEach((prefix, index) => {
    const row = document.createElement("article");
    row.className = `prefix-row ${prefix.builtIn ? "prefix-row-built-in" : "prefix-row-custom"}`;

    const identity = document.createElement("div");
    identity.className = "prefix-identity";

    const identityHeader = document.createElement("div");
    identityHeader.className = "prefix-identity-header";
    const typeBadge = document.createElement("span");
    typeBadge.className = `prefix-type-badge ${prefix.builtIn ? "prefix-type-built-in" : "prefix-type-custom"}`;
    typeBadge.textContent = prefix.builtIn ? "Built in" : "Custom";
    identityHeader.append(typeBadge);

    const nameLabel = document.createElement("label");
    nameLabel.className = "prefix-name-field";
    nameLabel.textContent = "Prefix name";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = runtimeConfig.limits.maxPrefixNameCharacters;
    nameInput.value = prefix.name;
    nameInput.placeholder = "Example: digits";
    nameInput.readOnly = prefix.builtIn;
    nameInput.setAttribute("aria-readonly", String(prefix.builtIn));
    if (prefix.builtIn) nameInput.title = "Built-in prefix names cannot be changed.";
    nameInput.addEventListener("input", () => {
      prefixConfig[index].name = nameInput.value;
      queuePrefixSave();
    });
    nameLabel.append(nameInput);

    const identityNote = document.createElement("p");
    identityNote.className = "prefix-identity-note";
    identityNote.textContent = prefix.builtIn
      ? "Packaged behavior · name locked"
      : "Your prefix · name editable";
    identity.append(identityHeader, nameLabel, identityNote);

    const instructionLabel = document.createElement("label");
    instructionLabel.className = "prefix-instruction-field";
    instructionLabel.textContent = "Instruction";
    const instructionInput = document.createElement("textarea");
    instructionInput.rows = 3;
    instructionInput.maxLength = runtimeConfig.limits.maxPrefixInstructionCharacters;
    instructionInput.value = prefix.instruction;
    instructionInput.placeholder = "What should the instruction model do?";
    instructionInput.addEventListener("input", () => {
      prefixConfig[index].instruction = instructionInput.value;
      queuePrefixSave();
      autoResizeTextarea(instructionInput);
    });
    instructionLabel.append(instructionInput);

    const controls = document.createElement("div");
    controls.className = "prefix-controls";

    const enabledGroup = document.createElement("div");
    enabledGroup.className = "prefix-enabled-group";
    enabledGroup.append(createPrefixToggle(prefix, index, "enabled", "Enabled"));

    const accessGroup = document.createElement("div");
    accessGroup.className = "prefix-access-group";
    const accessLabel = document.createElement("span");
    accessLabel.className = "prefix-control-caption";
    accessLabel.textContent = "Access";
    const accessToggles = document.createElement("div");
    accessToggles.className = "prefix-toggle-list";
    accessToggles.append(
      createPrefixToggle(prefix, index, "allowSearch", "Search access"),
      createPrefixToggle(prefix, index, "allowClipboard", "Clipboard access")
    );
    accessGroup.append(accessLabel, accessToggles);

    const rowActions = document.createElement("div");
    rowActions.className = "prefix-row-actions";
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = prefix.builtIn ? "button-secondary" : "button-danger";
    actionButton.textContent = prefix.builtIn ? "Reset to default" : "Remove prefix";
    actionButton.addEventListener("click", () => {
      if (prefix.builtIn) {
        resetBuiltInPrefix(index, actionButton);
      } else {
        removePrefix(index);
      }
    });
    rowActions.append(actionButton);

    controls.append(enabledGroup, accessGroup, rowActions);
    row.append(identity, instructionLabel, controls);
    prefixList.append(row);
    autoResizeTextarea(instructionInput);
  });
  prefixEmpty.hidden = prefixConfig.length > 0;
}

function createPrefixToggle(prefix, index, property, labelText) {
  const label = document.createElement("label");
  label.className = "prefix-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = property === "enabled" ? prefix.enabled !== false : prefix[property] === true;
  input.setAttribute("aria-label", labelText);
  input.addEventListener("change", () => {
    prefixConfig[index][property] = input.checked;
    queuePrefixSave({ immediate: true });
  });
  const face = document.createElement("span");
  face.textContent = labelText;
  label.append(input, face);
  return label;
}

function queuePrefixSave({ immediate = false } = {}) {
  clearTimeout(prefixSaveTimer);
  prefixStatus.textContent = "Saving prefix changes…";
  prefixStatus.dataset.state = "saving";

  if (immediate) {
    void persistPrefixes();
    return;
  }

  prefixSaveTimer = setTimeout(() => {
    void persistPrefixes();
  }, 250);
}

function persistPrefixes() {
  const validationError = getPrefixValidationError();
  if (validationError) {
    prefixStatus.textContent = validationError;
    prefixStatus.dataset.state = "error";
    return Promise.resolve();
  }

  prefixSaveQueue = prefixSaveQueue.catch(() => {}).then(async () => {
    try {
      const nextPrefixes = prefixConfig.map((prefix) => ({ ...prefix }));
      await desktopBridge.savePrefixes(nextPrefixes);
      prefixStatus.textContent = "Prefix changes saved.";
      prefixStatus.dataset.state = "success";
    } catch (error) {
      console.error("Could not save instruction prefixes:", error);
      prefixStatus.textContent = error.message || "Could not save prefix changes.";
      prefixStatus.dataset.state = "error";
    }
  });
  return prefixSaveQueue;
}

function openPrefixDialog() {
  if (prefixConfig.length >= runtimeConfig.limits.maxPrefixes) {
    prefixStatus.textContent = `You can save up to ${runtimeConfig.limits.maxPrefixes} instruction prefixes.`;
    prefixStatus.dataset.state = "error";
    return;
  }
  resetPrefixDialog();
  prefixDialog.showModal();
  voicePrefixOption.focus();
}

function addPrefixManually() {
  prefixConfig.push({
    id: "",
    builtIn: false,
    name: "",
    instruction: "",
    enabled: true,
    allowSearch: false,
    allowClipboard: false
  });
  renderPrefixes();
  queuePrefixSave();
  prefixDialog.close();
  prefixList.lastElementChild?.querySelector("input")?.focus();
}

function showVoicePrefixRecorder() {
  showPrefixDialogView(prefixRecordView);
  prefixRecordStatus.textContent = "Ready when you are.";
  prefixRecordStatus.dataset.state = "idle";
  prefixRecordOrb.dataset.state = "idle";
  prefixRecordStartButton.disabled = false;
  prefixRecordStopButton.hidden = true;
  prefixRecordStartButton.focus();
}

function returnToPrefixChoices() {
  prefixFlowToken += 1;
  abortPrefixRecording();
  showPrefixDialogView(prefixChoiceView);
  voicePrefixOption.focus();
}

async function startPrefixRecording() {
  if (prefixRecorder || !prefixDialog.open) return;
  if (!desktopBridge?.isElectron) {
    setPrefixRecordError("Voice prefix creation is available in the Electron app.");
    return;
  }
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    setPrefixRecordError("This Electron build does not support microphone recording.");
    return;
  }

  const flowToken = prefixFlowToken;
  prefixRecordStartButton.disabled = true;
  prefixRecordStopButton.hidden = false;
  prefixRecordStopButton.disabled = true;
  prefixRecordStatus.textContent = "Requesting microphone access…";
  prefixRecordStatus.dataset.state = "processing";
  prefixRecordOrb.dataset.state = "processing";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (flowToken !== prefixFlowToken || !prefixDialog.open) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    prefixRecordingStream = stream;
    prefixRecordedChunks = [];
    prefixRecorder = new MediaRecorder(stream);
    prefixRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) prefixRecordedChunks.push(event.data);
    });
    prefixRecorder.addEventListener("stop", () => handlePrefixRecorderStop(flowToken), { once: true });
    prefixRecorder.addEventListener("error", (event) => {
      setPrefixRecordError(event?.error?.message || "The microphone stopped unexpectedly.");
      releasePrefixRecording();
    }, { once: true });
    prefixRecorder.start();
    prefixRecordingStartedAt = performance.now();
    prefixRecordStopButton.disabled = false;
    prefixRecordStatus.textContent = "Listening… Describe the trigger and the result you want.";
    prefixRecordStatus.dataset.state = "recording";
    prefixRecordOrb.dataset.state = "recording";
  } catch (error) {
    console.error("Could not start prefix recording:", error);
    releasePrefixRecording();
    setPrefixRecordError(error.message || "Could not access the microphone.");
  }
}

function stopPrefixRecording() {
  if (!prefixRecorder || prefixRecorder.state === "inactive") return;
  prefixRecordingDiscarded = isRecordingTooShort(prefixRecordingStartedAt, performance.now());
  prefixRecordStopButton.disabled = true;
  prefixRecordStartButton.disabled = true;
  prefixRecordStatus.textContent = prefixRecordingDiscarded
    ? "That recording was too short. Resetting…"
    : "Transcribing and drafting your prefix…";
  prefixRecordStatus.dataset.state = "processing";
  prefixRecordOrb.dataset.state = "processing";
  try {
    prefixRecorder.stop();
  } catch (error) {
    console.error("Could not stop prefix recording:", error);
    releasePrefixRecording();
    setPrefixRecordError("Could not finish the recording. Please try again.");
  }
}

function handlePrefixRecorderStop(flowToken) {
  const discarded = prefixRecordingDiscarded;
  const audioType = prefixRecorder?.mimeType || "audio/webm";
  const audio = new File(prefixRecordedChunks, getAudioFileName(audioType), { type: audioType });
  releasePrefixRecording();
  if (flowToken !== prefixFlowToken || !prefixDialog.open) return;
  if (discarded || !audio.size) {
    prefixRecordStartButton.disabled = false;
    prefixRecordStopButton.hidden = true;
    prefixRecordStatus.textContent = "That was too short. Record a little more, then try again.";
    prefixRecordStatus.dataset.state = "error";
    prefixRecordOrb.dataset.state = "idle";
    return;
  }
  void createPrefixFromVoice(audio, flowToken);
}

async function createPrefixFromVoice(audio, flowToken) {
  try {
    const result = await desktopBridge.createPrefixFromVoice({
      audio: await audio.arrayBuffer(),
      mimeType: audio.type
    });
    if (flowToken !== prefixFlowToken || !prefixDialog.open) return;
    if (!result?.prefix || !result.transcript) throw new Error("No prefix proposal was returned.");
    prefixPreviewTranscript.textContent = result.transcript;
    prefixPreviewName.value = result.prefix.name;
    prefixPreviewInstruction.value = result.prefix.instruction;
    prefixPreviewName.maxLength = runtimeConfig.limits.maxPrefixNameCharacters;
    prefixPreviewInstruction.maxLength = runtimeConfig.limits.maxPrefixInstructionCharacters;
    prefixPreviewStatus.textContent = "Draft ready. Make any edits before adding it.";
    prefixPreviewStatus.dataset.state = "success";
    autoResizeTextarea(prefixPreviewInstruction);
    showPrefixDialogView(prefixPreviewView);
    prefixPreviewName.focus();
    prefixPreviewName.select();
  } catch (error) {
    console.error("Could not create prefix from voice:", error);
    if (flowToken !== prefixFlowToken || !prefixDialog.open) return;
    setPrefixRecordError(error.message || "Could not create a prefix from that recording.");
    prefixRecordStartButton.disabled = false;
    prefixRecordStopButton.hidden = true;
  }
}

function addPreviewPrefix() {
  const nextPrefix = {
    id: "",
    builtIn: false,
    name: prefixPreviewName.value,
    instruction: prefixPreviewInstruction.value,
    enabled: true,
    allowSearch: false,
    allowClipboard: false
  };
  const validationError = getPrefixValidationError([...prefixConfig, nextPrefix]);
  if (validationError) {
    prefixPreviewStatus.textContent = validationError;
    prefixPreviewStatus.dataset.state = "error";
    return;
  }

  prefixConfig.push(nextPrefix);
  renderPrefixes();
  prefixDialog.close();
  queuePrefixSave({ immediate: true });
  prefixList.lastElementChild?.querySelector("input")?.focus();
}

function showPrefixDialogView(view) {
  [prefixChoiceView, prefixRecordView, prefixPreviewView].forEach((candidate) => {
    candidate.hidden = candidate !== view;
  });
}

function resetPrefixDialog() {
  prefixFlowToken += 1;
  abortPrefixRecording();
  prefixPreviewTranscript.textContent = "";
  prefixPreviewName.value = "";
  prefixPreviewInstruction.value = "";
  prefixPreviewStatus.textContent = "";
  prefixPreviewStatus.dataset.state = "idle";
  prefixRecordStatus.textContent = "Ready when you are.";
  prefixRecordStatus.dataset.state = "idle";
  prefixRecordOrb.dataset.state = "idle";
  prefixRecordStartButton.disabled = false;
  prefixRecordStopButton.disabled = false;
  prefixRecordStopButton.hidden = true;
  showPrefixDialogView(prefixChoiceView);
}

function abortPrefixRecording() {
  if (prefixRecorder && prefixRecorder.state !== "inactive") {
    prefixRecorder.onstop = null;
    try {
      prefixRecorder.stop();
    } catch {
      // The recorder may already be finishing as the dialog closes.
    }
  }
  releasePrefixRecording();
}

function releasePrefixRecording() {
  prefixRecordingStream?.getTracks().forEach((track) => track.stop());
  prefixRecorder = undefined;
  prefixRecordingStream = undefined;
  prefixRecordedChunks = [];
  prefixRecordingStartedAt = 0;
  prefixRecordingDiscarded = false;
}

function setPrefixRecordError(message) {
  prefixRecordStatus.textContent = message;
  prefixRecordStatus.dataset.state = "error";
  prefixRecordOrb.dataset.state = "error";
  prefixRecordStartButton.disabled = false;
  prefixRecordStopButton.hidden = true;
}

function getAudioFileName(mimeType) {
  const extension = mimeType.includes("mp4")
    ? "mp4"
    : mimeType.includes("mpeg")
      ? "mp3"
      : mimeType.includes("ogg")
        ? "ogg"
        : mimeType.includes("wav")
          ? "wav"
          : "webm";
  return `prefix-brief.${extension}`;
}

function getPrefixValidationError(prefixes = prefixConfig) {
  const seenNames = new Set();
  let totalCharacters = 0;
  for (const prefix of prefixes) {
    const name = prefix.name.trim();
    const instruction = prefix.instruction.trim();
    if (!name || !instruction) return "Every prefix needs both a name and an instruction before changes can be saved.";
    if (name.length > runtimeConfig.limits.maxPrefixNameCharacters) {
      return `Prefix names can contain up to ${runtimeConfig.limits.maxPrefixNameCharacters} characters.`;
    }
    if (instruction.length > runtimeConfig.limits.maxPrefixInstructionCharacters) {
      return `Prefix instructions can contain up to ${runtimeConfig.limits.maxPrefixInstructionCharacters.toLocaleString()} characters.`;
    }
    const normalizedName = name.toLocaleLowerCase();
    if (seenNames.has(normalizedName)) return `The prefix name “${name}” is already in use.`;
    seenNames.add(normalizedName);
    totalCharacters += name.length + instruction.length;
  }
  if (totalCharacters > runtimeConfig.limits.maxPrefixTotalCharacters) {
    return "The instruction prefix registry is too large.";
  }
  return "";
}

function removePrefix(index) {
  prefixConfig.splice(index, 1);
  renderPrefixes();
  queuePrefixSave();
}

async function resetBuiltInPrefix(index, button) {
  const prefix = prefixConfig[index];
  if (!prefix?.builtIn || !prefix.id) return;
  clearTimeout(prefixSaveTimer);
  button.disabled = true;
  button.textContent = "Resetting…";
  prefixStatus.textContent = `Resetting ${prefix.name}…`;
  prefixStatus.dataset.state = "saving";
  try {
    await prefixSaveQueue.catch(() => {});
    runtimeConfig = await desktopBridge.resetPrefix(prefix.id);
    prefixConfig = runtimeConfig.prefixes.map(normalizePrefix);
    renderPrefixes();
    prefixStatus.textContent = `${prefix.name} reset to its default.`;
    prefixStatus.dataset.state = "success";
  } catch (error) {
    prefixStatus.textContent = error.message || "Could not reset the prefix.";
    prefixStatus.dataset.state = "error";
  } finally {
    button.disabled = false;
    button.textContent = "Reset to default";
  }
}

async function resetToDefaults(event) {
  event.preventDefault();
  clearTimeout(promptSaveTimer);
  clearTimeout(prefixSaveTimer);
  clearTimeout(soundVolumeSaveTimer);
  confirmResetButton.disabled = true;
  resetStatus.textContent = "Resetting settings…";
  resetStatus.dataset.state = "saving";
  try {
    await prefixSaveQueue.catch(() => {});
    await modelSaveQueue.catch(() => {});
    runtimeConfig = await desktopBridge.resetToDefaults();
    prefixConfig = runtimeConfig.prefixes.map(normalizePrefix);
    renderModels();
    initializeInstructionPrompt();
    renderPrefixes();
    renderSoundVolume(runtimeConfig.soundVolume);
    await loadConnectionSettings();
    resetDialog.close();
    resetStatus.textContent = "Settings reset to defaults.";
    resetStatus.dataset.state = "success";
  } catch (error) {
    resetStatus.textContent = error.message || "Could not reset settings.";
    resetStatus.dataset.state = "error";
  } finally {
    confirmResetButton.disabled = false;
  }
}

async function initializeHotkey() {
  try {
    const hotkey = await desktopBridge.getHotkey();
    renderHotkey(hotkey);
  } catch (error) {
    console.error("Could not load the desktop hotkey:", error);
    hotkeyStatus.textContent = error.message || "Could not load the hotkey.";
  }
}

function renderHotkey(hotkey) {
  hotkeyDisplay.textContent = hotkey.label;
}

function renderSoundVolume(value) {
  const normalizedValue = normalizeSoundVolume(value);
  const percentage = Math.round(normalizedValue * 100);
  soundVolumeInput.value = String(percentage);
  soundVolumeInput.style.setProperty("--volume-percent", `${percentage}%`);
  soundVolumeValue.textContent = `${percentage}%`;
}

function updateSoundVolumePreview() {
  const nextVolume = normalizeSoundVolume(Number(soundVolumeInput.value) / 100);
  runtimeConfig.soundVolume = nextVolume;
  renderSoundVolume(nextVolume);
}

function saveSoundVolume() {
  const nextVolume = normalizeSoundVolume(Number(soundVolumeInput.value) / 100);
  runtimeConfig.soundVolume = nextVolume;
  clearTimeout(soundVolumeSaveTimer);
  soundVolumeStatus.textContent = "Saving…";
  soundVolumeStatus.dataset.state = "saving";
  soundVolumeSaveTimer = setTimeout(async () => {
    try {
      if (!desktopBridge?.isElectron) throw new Error("Porvoz must be running as the Electron app.");
      const savedVolume = await desktopBridge.saveSoundVolume(nextVolume);
      runtimeConfig.soundVolume = normalizeSoundVolume(savedVolume);
      renderSoundVolume(runtimeConfig.soundVolume);
      soundVolumeStatus.textContent = "Cue volume saved.";
      soundVolumeStatus.dataset.state = "success";
    } catch (error) {
      soundVolumeStatus.textContent = error.message || "Could not save cue volume.";
      soundVolumeStatus.dataset.state = "error";
    }
  }, 180);
}

function handleSoundVolumeUpdated(value) {
  runtimeConfig.soundVolume = normalizeSoundVolume(value);
  renderSoundVolume(runtimeConfig.soundVolume);
}

function normalizeSoundVolume(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.min(1, Math.max(0, numericValue)) : 0.3;
}

function handleHotkeyUpdated(hotkey) {
  renderHotkey(hotkey);
  if (isCapturingHotkey) {
    finishHotkeyCapture();
    hotkeyStatus.textContent = `Hotkey saved: ${hotkey.label}.`;
  }
}

function handleHotkeyCaptureStatus({ state, message } = {}) {
  if (message) hotkeyStatus.textContent = message;
  if (state === "canceled") finishHotkeyCapture();
}

async function beginHotkeyCapture() {
  if (isCapturingHotkey) return;
  isCapturingHotkey = true;
  captureHotkeyButton.disabled = true;
  captureHotkeyButton.textContent = "Press keys…";
  cancelHotkeyButton.hidden = false;
  hotkeyStatus.textContent = "Press one Control/Alt key, or hold modifiers and press a trigger; release to save. Escape cancels.";
  try {
    await desktopBridge.beginHotkeyCapture();
  } catch (error) {
    finishHotkeyCapture();
    hotkeyStatus.textContent = error.message || "Could not capture the hotkey.";
  }
}

function cancelHotkeyCapture() {
  desktopBridge.cancelHotkeyCapture();
  finishHotkeyCapture();
  hotkeyStatus.textContent = "Hotkey capture canceled.";
}

function finishHotkeyCapture() {
  isCapturingHotkey = false;
  captureHotkeyButton.disabled = false;
  captureHotkeyButton.textContent = "Capture hotkey";
  cancelHotkeyButton.hidden = true;
}

function normalizePrefix(prefix) {
  return {
    id: typeof prefix?.id === "string" ? prefix.id : "",
    builtIn: prefix?.builtIn === true,
    name: typeof prefix?.name === "string" ? prefix.name : "",
    instruction: typeof prefix?.instruction === "string" ? prefix.instruction : "",
    enabled: prefix?.enabled !== false,
    allowSearch: prefix?.allowSearch === true,
    allowClipboard: prefix?.allowClipboard === true
  };
}

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}
