import { loadRuntimeConfig } from "./runtime-config.js";
import { isRecordingTooShort } from "./capture-policy.js";
import { createButtonLabel, createIcon, setButtonLabel } from "./icons.js";
import { getUniquePrefixName, parsePrefix, serializePrefix } from "./prefix-transfer.js";

const profileSelect = document.querySelector("#profile-select");
const addProfileButton = document.querySelector("#add-profile");
const renameProfileButton = document.querySelector("#rename-profile");
const deleteProfileButton = document.querySelector("#delete-profile");
const profileStatus = document.querySelector("#profile-status");
const profileDialog = document.querySelector("#profile-dialog");
const profileDialogKicker = document.querySelector("#profile-dialog-kicker");
const profileDialogHeading = document.querySelector("#profile-dialog-heading");
const profileNameInput = document.querySelector("#profile-name-input");
const profileDialogStatus = document.querySelector("#profile-dialog-status");
const cancelProfileDialogButton = document.querySelector("#cancel-profile-dialog");
const saveProfileDialogButton = document.querySelector("#save-profile-dialog");
const deleteProfileDialog = document.querySelector("#delete-profile-dialog");
const deleteProfileDialogHeading = document.querySelector("#delete-profile-dialog-heading");
const cancelDeleteProfileButton = document.querySelector("#cancel-delete-profile");
const confirmDeleteProfileButton = document.querySelector("#confirm-delete-profile");
const baseUrlInput = document.querySelector("#base-url");
const apiKeyInput = document.querySelector("#api-key");
const verifyCertificateInput = document.querySelector("#verify-certificate");
const connectionForm = document.querySelector("#connection-form");
const connectionStatus = document.querySelector("#connection-status");
const transcriptionModel = document.querySelector("#transcription-model");
const instructionModel = document.querySelector("#instruction-model");
const instructionReasoning = document.querySelector("#instruction-reasoning");
const populateModelsButton = document.querySelector("#populate-models");
const modelStatus = document.querySelector("#model-status");
const openTranscriptionModelPickerButton = document.querySelector("#open-transcription-model-picker");
const openInstructionModelPickerButton = document.querySelector("#open-instruction-model-picker");
const modelPickerDialog = document.querySelector("#model-picker-dialog");
const modelPickerHeading = document.querySelector("#model-picker-heading");
const modelPickerDescription = document.querySelector("#model-picker-description");
const modelPickerInput = document.querySelector("#model-picker-input");
const modelPickerMenu = document.querySelector("#model-picker-menu");
const modelPickerStatus = document.querySelector("#model-picker-status");
const closeModelPickerButton = document.querySelector("#close-model-picker");
const cancelModelPickerButton = document.querySelector("#cancel-model-picker");
const saveModelPickerButton = document.querySelector("#save-model-picker");
const instructionPrompt = document.querySelector("#instruction-prompt");
const promptStatus = document.querySelector("#prompt-status");
const resetPromptButton = document.querySelector("#reset-prompt");
const addPrefixButton = document.querySelector("#add-prefix");
const importPrefixButton = document.querySelector("#import-prefix");
const prefixList = document.querySelector("#prefix-list");
const prefixEmpty = document.querySelector("#prefix-empty");
const prefixStatus = document.querySelector("#prefix-status");
const prefixDialog = document.querySelector("#prefix-dialog");
const prefixDialogKicker = document.querySelector("#prefix-dialog-kicker");
const prefixDialogHeading = document.querySelector("#prefix-dialog-heading");
const closePrefixDialogButton = document.querySelector("#close-prefix-dialog");
const prefixChoiceView = document.querySelector("#prefix-choice-view");
const prefixEditView = document.querySelector("#prefix-edit-view");
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
const prefixPreviewSearch = document.querySelector("#prefix-preview-search");
const prefixPreviewClipboard = document.querySelector("#prefix-preview-clipboard");
const prefixPreviewStatus = document.querySelector("#prefix-preview-status");
const prefixPreviewCancelButton = document.querySelector("#prefix-preview-cancel");
const prefixPreviewAddButton = document.querySelector("#prefix-preview-add");
const prefixEditName = document.querySelector("#prefix-edit-name");
const prefixEditInstruction = document.querySelector("#prefix-edit-instruction");
const prefixEditSearch = document.querySelector("#prefix-edit-search");
const prefixEditClipboard = document.querySelector("#prefix-edit-clipboard");
const prefixEditStatus = document.querySelector("#prefix-edit-status");
const prefixEditRemoveButton = document.querySelector("#prefix-edit-remove");
const prefixEditCancelButton = document.querySelector("#prefix-edit-cancel");
const prefixEditSaveButton = document.querySelector("#prefix-edit-save");
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
const previewCueButton = document.querySelector("#preview-cue");
const previewCueSound = new Audio("./assets/recording-start.mp3");
const desktopBridge = window.porvozDesktop;

let runtimeConfig = await loadRuntimeConfig();
let prefixConfig = runtimeConfig.prefixes.map(normalizePrefix);
let isCapturingHotkey = false;
let promptSaveTimer;
let prefixSaveTimer;
let prefixSaveQueue = Promise.resolve();
let modelSaveQueue = Promise.resolve();
let modelSaveTimer;
let soundVolumeSaveTimer;
let prefixRecorder;
let prefixRecordingStream;
let prefixRecordedChunks = [];
let prefixRecordingStartedAt = 0;
let prefixRecordingDiscarded = false;
let prefixFlowToken = 0;
let editingPrefixIndex = -1;
let modelPickerTarget = "";
let modelPickerSelection = "";
let profileDialogMode = "add";

baseUrlInput.maxLength = 2048;
apiKeyInput.maxLength = 4096;
profileNameInput.maxLength = runtimeConfig.limits.maxProfileNameCharacters;
instructionPrompt.maxLength = runtimeConfig.limits.maxInstructionPromptCharacters;
prefixEditName.maxLength = runtimeConfig.limits.maxPrefixNameCharacters;
prefixEditInstruction.maxLength = runtimeConfig.limits.maxPrefixInstructionCharacters;
prefixPreviewName.maxLength = runtimeConfig.limits.maxPrefixNameCharacters;
prefixPreviewInstruction.maxLength = runtimeConfig.limits.maxPrefixInstructionCharacters;

renderProfiles();
loadConnectionSettings();
renderModels();
initializeInstructionPrompt();
renderPrefixes();
renderSoundVolume(runtimeConfig.soundVolume);
await initializeHotkey();

profileSelect.addEventListener("change", switchActiveProfile);
addProfileButton.addEventListener("click", openAddProfileDialog);
renameProfileButton.addEventListener("click", openRenameProfileDialog);
deleteProfileButton.addEventListener("click", openDeleteProfileDialog);
cancelProfileDialogButton.addEventListener("click", () => profileDialog.close());
saveProfileDialogButton.addEventListener("click", saveProfileDialog);
cancelDeleteProfileButton.addEventListener("click", () => deleteProfileDialog.close());
confirmDeleteProfileButton.addEventListener("click", confirmDeleteProfile);
connectionForm.addEventListener("submit", saveConnection);
populateModelsButton.addEventListener("click", populateModels);
transcriptionModel.addEventListener("input", handleModelInput);
instructionModel.addEventListener("input", handleModelInput);
instructionReasoning.addEventListener("change", saveModelSelections);
openTranscriptionModelPickerButton.addEventListener("click", () => openModelPicker("transcription"));
openInstructionModelPickerButton.addEventListener("click", () => openModelPicker("instruction"));
modelPickerInput.addEventListener("input", () => {
  modelPickerSelection = "";
  renderModelPickerOptions();
});
modelPickerInput.addEventListener("keydown", handleModelPickerInputKeydown);
modelPickerMenu.addEventListener("keydown", handleModelPickerOptionKeydown);
closeModelPickerButton.addEventListener("click", () => modelPickerDialog.close());
cancelModelPickerButton.addEventListener("click", () => modelPickerDialog.close());
saveModelPickerButton.addEventListener("click", saveModelPickerSelection);
modelPickerDialog.addEventListener("close", resetModelPicker);
instructionPrompt.addEventListener("input", handlePromptInput);
resetPromptButton.addEventListener("click", () => promptResetDialog.showModal());
addPrefixButton.addEventListener("click", openPrefixDialog);
importPrefixButton.addEventListener("click", importPrefixFromClipboard);
closePrefixDialogButton.addEventListener("click", () => prefixDialog.close());
voicePrefixOption.addEventListener("click", showVoicePrefixRecorder);
manualPrefixOption.addEventListener("click", addPrefixManually);
prefixRecordCancelButton.addEventListener("click", returnToPrefixChoices);
prefixRecordStartButton.addEventListener("click", startPrefixRecording);
prefixRecordStopButton.addEventListener("click", stopPrefixRecording);
prefixPreviewCancelButton.addEventListener("click", () => prefixDialog.close());
prefixPreviewAddButton.addEventListener("click", addPreviewPrefix);
prefixEditInstruction.addEventListener("input", () => autoResizeTextarea(prefixEditInstruction));
prefixEditCancelButton.addEventListener("click", () => prefixDialog.close());
prefixEditSaveButton.addEventListener("click", savePrefixEdit);
prefixEditRemoveButton.addEventListener("click", removeEditingPrefix);
prefixDialog.addEventListener("close", resetPrefixDialog);
resetDefaultsButton.addEventListener("click", () => resetDialog.showModal());
confirmResetButton.addEventListener("click", resetToDefaults);
confirmPromptResetButton.addEventListener("click", resetPromptToDefault);
cancelResetButton.addEventListener("click", () => resetDialog.close());
captureHotkeyButton.addEventListener("click", beginHotkeyCapture);
cancelHotkeyButton.addEventListener("click", cancelHotkeyCapture);
soundVolumeInput.addEventListener("input", updateSoundVolumePreview);
soundVolumeInput.addEventListener("change", saveSoundVolume);
previewCueButton?.addEventListener("click", playCuePreview);

if (desktopBridge?.isElectron) {
  desktopBridge.onHotkeyUpdated(handleHotkeyUpdated);
  desktopBridge.onHotkeyCaptureStatus(handleHotkeyCaptureStatus);
  desktopBridge.onSoundVolumeUpdated(handleSoundVolumeUpdated);
  desktopBridge.onActivityCanceled(handleActivityCanceled);
}

function handleActivityCanceled() {
  const prefixActive = prefixDialog.open && ["recording", "processing"].includes(prefixRecordStatus.dataset.state);
  const modelsActive = modelStatus.dataset.state === "loading";
  if (!prefixActive && !modelsActive) return;

  if (prefixActive) {
    prefixFlowToken += 1;
    abortPrefixRecording();
    prefixRecordStatus.textContent = "Canceled.";
    prefixRecordStatus.dataset.state = "idle";
    prefixRecordOrb.dataset.state = "idle";
    prefixRecordStartButton.disabled = false;
    prefixRecordStopButton.disabled = false;
    prefixRecordStopButton.hidden = true;
    desktopBridge.setStatus({ state: "idle" });
  }
  if (modelsActive) {
    modelStatus.textContent = "Model loading canceled.";
    modelStatus.dataset.state = "idle";
  }
}

function renderProfiles() {
  profileSelect.replaceChildren(...runtimeConfig.profiles.map((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    return option;
  }));
  profileSelect.value = runtimeConfig.activeProfileId;
  deleteProfileButton.disabled = runtimeConfig.profiles.length <= 1;
}

function getActiveProfileName() {
  return runtimeConfig.profiles.find((profile) => profile.id === runtimeConfig.activeProfileId)?.name || "";
}

async function switchActiveProfile() {
  const nextProfileId = profileSelect.value;
  if (nextProfileId === runtimeConfig.activeProfileId) return;
  setProfileControlsDisabled(true);
  profileStatus.textContent = "Switching connection profile…";
  profileStatus.dataset.state = "saving";
  try {
    if (!desktopBridge?.isElectron) throw new Error("Porvoz must be running as the Electron app.");
    runtimeConfig = await desktopBridge.setActiveProfile({ id: nextProfileId });
    renderProfiles();
    await loadConnectionSettings();
    renderModels();
    profileStatus.textContent = `Switched to “${getActiveProfileName()}”.`;
    profileStatus.dataset.state = "success";
  } catch (error) {
    renderProfiles();
    profileStatus.textContent = error.message || "Could not switch connection profiles.";
    profileStatus.dataset.state = "error";
  } finally {
    setProfileControlsDisabled(false);
  }
}

function setProfileControlsDisabled(disabled) {
  profileSelect.disabled = disabled;
  addProfileButton.disabled = disabled;
  renameProfileButton.disabled = disabled;
  // renderProfiles() is always called before this re-enables (both on
  // success and on error), and it sets the correct disabled state for a
  // single remaining profile — so only force it on, never force it off.
  deleteProfileButton.disabled = disabled || deleteProfileButton.disabled;
}

function openAddProfileDialog() {
  profileDialogMode = "add";
  profileDialogKicker.textContent = "New connection profile";
  profileDialogHeading.textContent = "Name this profile";
  profileNameInput.value = "";
  profileDialogStatus.textContent = "";
  profileDialogStatus.dataset.state = "idle";
  setButtonLabel(saveProfileDialogButton, "Add profile");
  profileDialog.showModal();
  profileNameInput.focus();
}

function openRenameProfileDialog() {
  profileDialogMode = "rename";
  profileDialogKicker.textContent = "Profile settings";
  profileDialogHeading.textContent = "Rename profile";
  profileNameInput.value = getActiveProfileName();
  profileDialogStatus.textContent = "";
  profileDialogStatus.dataset.state = "idle";
  setButtonLabel(saveProfileDialogButton, "Save name");
  profileDialog.showModal();
  profileNameInput.focus();
  profileNameInput.select();
}

async function saveProfileDialog() {
  const name = profileNameInput.value.trim();
  if (!name) {
    profileDialogStatus.textContent = "Enter a name for the connection profile.";
    profileDialogStatus.dataset.state = "error";
    return;
  }
  saveProfileDialogButton.disabled = true;
  profileDialogStatus.textContent = "Saving…";
  profileDialogStatus.dataset.state = "saving";
  try {
    if (!desktopBridge?.isElectron) throw new Error("Porvoz must be running as the Electron app.");
    runtimeConfig = profileDialogMode === "add"
      ? await desktopBridge.createProfile({ name })
      : await desktopBridge.renameProfile({ id: runtimeConfig.activeProfileId, name });
    renderProfiles();
    await loadConnectionSettings();
    renderModels();
    profileDialog.close();
    profileStatus.textContent = profileDialogMode === "add"
      ? `Added “${name}” and made it the active profile.`
      : `Renamed the profile to “${name}”.`;
    profileStatus.dataset.state = "success";
  } catch (error) {
    profileDialogStatus.textContent = error.message || "Could not save the connection profile.";
    profileDialogStatus.dataset.state = "error";
  } finally {
    saveProfileDialogButton.disabled = false;
  }
}

function openDeleteProfileDialog() {
  if (deleteProfileButton.disabled) return;
  deleteProfileDialogHeading.textContent = `Delete “${getActiveProfileName()}”?`;
  deleteProfileDialog.showModal();
}

async function confirmDeleteProfile() {
  confirmDeleteProfileButton.disabled = true;
  const deletedName = getActiveProfileName();
  try {
    if (!desktopBridge?.isElectron) throw new Error("Porvoz must be running as the Electron app.");
    runtimeConfig = await desktopBridge.deleteProfile({ id: runtimeConfig.activeProfileId });
    renderProfiles();
    await loadConnectionSettings();
    renderModels();
    deleteProfileDialog.close();
    profileStatus.textContent = `Deleted “${deletedName}”. Now using “${getActiveProfileName()}”.`;
    profileStatus.dataset.state = "success";
  } catch (error) {
    profileStatus.textContent = error.message || "Could not delete the connection profile.";
    profileStatus.dataset.state = "error";
  } finally {
    confirmDeleteProfileButton.disabled = false;
  }
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
  const models = Array.isArray(runtimeConfig.models.available) ? runtimeConfig.models.available : [];
  transcriptionModel.value = runtimeConfig.models.selected.transcription || "";
  instructionModel.value = runtimeConfig.models.selected.instruction || "";
  instructionReasoning.value = ["low", "medium", "high"].includes(runtimeConfig.models.selected.instructionReasoning)
    ? runtimeConfig.models.selected.instructionReasoning
    : "low";
  const hasModels = models.length > 0;
  openTranscriptionModelPickerButton.disabled = !hasModels;
  openInstructionModelPickerButton.disabled = !hasModels;
  openTranscriptionModelPickerButton.title = hasModels
    ? "Browse transcription models"
    : "Load models to browse the catalog";
  openInstructionModelPickerButton.title = hasModels
    ? "Browse instruction models"
    : "Load models to browse the catalog";
  modelStatus.textContent = hasModels
    ? `${models.length} models loaded. Type a model ID or browse the catalog.`
    : "No models loaded yet. You can type a model ID or load the catalog.";
  modelStatus.dataset.state = hasModels ? "success" : "idle";
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
    if (isCancellationError(error)) {
      modelStatus.textContent = "Model loading canceled.";
      modelStatus.dataset.state = "idle";
      return;
    }
    console.error("Could not load models:", error);
    modelStatus.textContent = error.message || "Could not load models.";
    modelStatus.dataset.state = "error";
  } finally {
    populateModelsButton.disabled = false;
  }
}

function saveModelSelections() {
  const selections = {
    transcription: transcriptionModel.value.trim(),
    instruction: instructionModel.value.trim(),
    instructionReasoning: instructionReasoning.value
  };
  const previousStatus = modelStatus.textContent;
  modelStatus.textContent = "Saving model selections…";
  modelStatus.dataset.state = "saving";
  const saveOperation = modelSaveQueue.catch(() => {}).then(async () => {
    try {
      runtimeConfig = await desktopBridge.saveModelSelections(selections);
      transcriptionModel.value = runtimeConfig.models.selected.transcription || "";
      instructionModel.value = runtimeConfig.models.selected.instruction || "";
      instructionReasoning.value = runtimeConfig.models.selected.instructionReasoning || "low";
      modelStatus.textContent = `${runtimeConfig.models.available.length} models loaded. Selections saved.`;
      modelStatus.dataset.state = "success";
      return true;
    } catch (error) {
      try {
        runtimeConfig = await desktopBridge.getRuntimeConfig();
        renderModels();
      } catch (refreshError) {
        console.error("Could not restore model selections:", refreshError);
      }
      modelStatus.textContent = error.message || previousStatus;
      modelStatus.dataset.state = "error";
      return false;
    }
  });
  modelSaveQueue = saveOperation.catch(() => {});
  return saveOperation;
}

function handleModelInput() {
  clearTimeout(modelSaveTimer);
  modelStatus.textContent = "Saving model selections…";
  modelStatus.dataset.state = "saving";
  modelSaveTimer = setTimeout(() => {
    void saveModelSelections();
  }, 250);
}

function openModelPicker(target) {
  modelPickerTarget = target;
  modelPickerSelection = "";
  document.documentElement.classList.add("model-picker-open");
  document.body.classList.add("model-picker-open");
  modelPickerHeading.textContent = `Browse ${target} models`;
  modelPickerDescription.textContent = `Type to filter the loaded catalog, choose a ${target} model, then save it into the ${target} model field.`;
  modelPickerInput.value = "";
  renderModelPickerOptions();
  modelPickerDialog.showModal();
  modelPickerInput.focus();
}

function renderModelPickerOptions() {
  const models = Array.isArray(runtimeConfig.models.available) ? runtimeConfig.models.available : [];
  const query = modelPickerInput.value.trim().toLocaleLowerCase();
  const filteredModels = models.filter((model) => model.toLocaleLowerCase().includes(query));
  modelPickerMenu.replaceChildren(...createModelMenuOptions(filteredModels));
  saveModelPickerButton.disabled = !modelPickerSelection;

  if (!models.length) {
    modelPickerStatus.textContent = "No models loaded. Close this dialog and select Load models first.";
    modelPickerStatus.dataset.state = "error";
  } else if (!filteredModels.length) {
    modelPickerStatus.textContent = `No models match “${modelPickerInput.value}”.`;
    modelPickerStatus.dataset.state = "error";
  } else {
    modelPickerStatus.textContent = query
      ? `${filteredModels.length} of ${models.length} models match.`
      : `${models.length} models available.`;
    modelPickerStatus.dataset.state = "success";
  }
}

async function saveModelPickerSelection() {
  const selectedModel = modelPickerSelection.trim();
  const input = getModelInput(modelPickerTarget);
  if (!selectedModel || !input) return;

  modelPickerSelection = selectedModel;
  input.value = selectedModel;
  saveModelPickerButton.disabled = true;
  cancelModelPickerButton.disabled = true;
  const saved = await saveModelSelections();
  saveModelPickerButton.disabled = false;
  cancelModelPickerButton.disabled = false;
  if (saved) modelPickerDialog.close();
}

function getModelInput(target) {
  return target === "transcription" ? transcriptionModel : target === "instruction" ? instructionModel : null;
}

function resetModelPicker() {
  modelPickerTarget = "";
  modelPickerSelection = "";
  document.documentElement.classList.remove("model-picker-open");
  document.body.classList.remove("model-picker-open");
  modelPickerInput.value = "";
  modelPickerMenu.replaceChildren();
  modelPickerStatus.textContent = "No models loaded yet.";
  modelPickerStatus.dataset.state = "idle";
}

const SPEECH_MODEL_HINTS = ["whisper", "transcribe", "speech-to-text", "speech_to_text", "stt", "voxtral", "gpt-4o-audio"];

function looksLikeSpeechModel(normalizedModel) {
  return SPEECH_MODEL_HINTS.some((hint) => normalizedModel.includes(hint));
}

function createModelMenuOptions(models) {
  // The picker opens from either the transcription or the instruction field.
  // Models that suit the field you opened it from are listed first, but nothing
  // is hidden — an endpoint is free to name its models anything it likes.
  const isTranscriptionTarget = modelPickerTarget === "transcription";
  const groups = isTranscriptionTarget
    ? new Map([
        ["Speech to text", []],
        ["Other models", []]
      ])
    : new Map([
        ["OpenAI / Codex", []],
        ["Anthropic / Claude", []],
        ["Other", []]
      ]);

  for (const model of [...models].sort((first, second) => first.localeCompare(second))) {
    const normalizedModel = model.toLocaleLowerCase();
    const group = isTranscriptionTarget
      ? (looksLikeSpeechModel(normalizedModel) ? "Speech to text" : "Other models")
      : normalizedModel.includes("claude")
        ? "Anthropic / Claude"
        : normalizedModel.includes("gpt") || normalizedModel.includes("codex") || normalizedModel.startsWith("openai/")
          ? "OpenAI / Codex"
          : "Other";
    groups.get(group).push(model);
  }

  const options = [];
  for (const [label, groupModels] of groups) {
    if (!groupModels.length) continue;
    const groupLabel = document.createElement("div");
    groupLabel.className = "model-picker-group-label";
    groupLabel.textContent = label;
    options.push(groupLabel);
    for (const model of groupModels) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "model-picker-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(model === modelPickerSelection));
      option.dataset.model = model;
      option.textContent = model;
      option.addEventListener("click", () => selectModelFromPicker(model));
      options.push(option);
    }
  }

  if (!options.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "model-picker-empty";
    emptyState.textContent = "No matching models.";
    options.push(emptyState);
  }

  return options;
}

function handleModelPickerInputKeydown(event) {
  const options = getModelPickerOptions();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    options[0]?.focus();
  } else if (event.key === "Enter" && options.length === 1) {
    event.preventDefault();
    selectModelFromPicker(options[0].dataset.model);
  }
}

function handleModelPickerOptionKeydown(event) {
  const options = getModelPickerOptions();
  const currentIndex = options.indexOf(event.target);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    options[Math.min(currentIndex + 1, options.length - 1)]?.focus();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (currentIndex <= 0) {
      modelPickerInput.focus();
    } else {
      options[currentIndex - 1]?.focus();
    }
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectModelFromPicker(event.target.dataset.model);
  }
}

function selectModelFromPicker(model) {
  if (!model) return;
  modelPickerSelection = model;
  modelPickerMenu.querySelectorAll("[role=option]").forEach((option) => {
    option.setAttribute("aria-selected", String(option.dataset.model === model));
  });
  saveModelPickerButton.disabled = false;
  modelPickerStatus.textContent = `${model} selected. Choose Save model to apply it.`;
  modelPickerStatus.dataset.state = "success";
}

function getModelPickerOptions() {
  return Array.from(modelPickerMenu.querySelectorAll("[role=option]"));
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
    row.className = "prefix-row";

    // The row itself opens the editor, so nothing in it pretends to be a field.
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Edit ${prefix.name} prefix`);
    row.addEventListener("click", (event) => {
      if (event.target.closest(".prefix-copy-button")) return;
      openPrefixEditor(index);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openPrefixEditor(index);
    });

    const name = document.createElement("strong");
    name.className = "prefix-row-name";
    name.textContent = prefix.name;
    name.title = prefix.name;

    const instruction = document.createElement("p");
    instruction.className = "prefix-row-instruction";
    instruction.textContent = prefix.instruction;
    instruction.title = prefix.instruction;

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "button-secondary prefix-copy-button";
    copyButton.append(createIcon("copy"));
    copyButton.setAttribute("aria-label", `Copy ${prefix.name} prefix JSON`);
    copyButton.title = "Copy prefix JSON";
    copyButton.addEventListener("click", () => copyPrefix(prefix, copyButton));

    const actions = document.createElement("div");
    actions.className = "prefix-row-actions";
    actions.append(copyButton);

    row.append(name, instruction, actions);
    prefixList.append(row);
  });
  prefixEmpty.hidden = prefixConfig.length > 0;
}

async function copyPrefix(prefix, button) {
  try {
    await writeClipboardText(serializePrefix(prefix));
    button.title = "Copied";
    prefixStatus.textContent = `Copied “${prefix.name}” as JSON. Use Import from clipboard to add a copy.`;
    prefixStatus.dataset.state = "success";
    window.setTimeout(() => {
      if (button.isConnected) button.title = "Copy prefix JSON";
    }, 1600);
  } catch (error) {
    console.error("Could not copy instruction prefix:", error);
    prefixStatus.textContent = error.message || "Could not copy the prefix JSON.";
    prefixStatus.dataset.state = "error";
  }
}

async function writeClipboardText(text) {
  if (desktopBridge?.writeClipboardText) {
    await desktopBridge.writeClipboardText(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  document.body.append(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Clipboard access is unavailable.");
  } finally {
    textarea.remove();
  }
}

async function readClipboardText() {
  if (desktopBridge?.readClipboardText) return desktopBridge.readClipboardText();
  if (navigator.clipboard?.readText) return navigator.clipboard.readText();
  throw new Error("Clipboard access is unavailable.");
}

async function importPrefixFromClipboard() {
  if (importPrefixButton.disabled) return;
  importPrefixButton.disabled = true;
  prefixStatus.textContent = "Reading the clipboard…";
  prefixStatus.dataset.state = "saving";

  try {
    const result = parsePrefix(await readClipboardText());
    if (result.state === "not-prefix") {
      prefixStatus.textContent = "The clipboard does not contain a prefix JSON object.";
      prefixStatus.dataset.state = "error";
      return;
    }
    if (result.state === "invalid") {
      prefixStatus.textContent = result.message;
      prefixStatus.dataset.state = "error";
      return;
    }

    addPastedPrefix(result.prefix);
  } catch (error) {
    console.error("Could not import instruction prefix:", error);
    prefixStatus.textContent = error.message || "Could not read the prefix from the clipboard.";
    prefixStatus.dataset.state = "error";
  } finally {
    importPrefixButton.disabled = false;
  }
}

function addPastedPrefix(prefix) {
  if (prefixConfig.length >= runtimeConfig.limits.maxPrefixes) {
    prefixStatus.textContent = `You can save up to ${runtimeConfig.limits.maxPrefixes} instruction prefixes.`;
    prefixStatus.dataset.state = "error";
    return;
  }

  const nextPrefix = {
    ...prefix,
    name: getUniquePrefixName(
      prefix.name,
      prefixConfig,
      runtimeConfig.limits.maxPrefixNameCharacters
    )
  };
  const validationError = getPrefixValidationError([...prefixConfig, nextPrefix]);
  if (validationError) {
    prefixStatus.textContent = validationError;
    prefixStatus.dataset.state = "error";
    return;
  }

  prefixConfig = [...prefixConfig, nextPrefix];
  renderPrefixes();
  queuePrefixSave({ immediate: true });
  prefixStatus.textContent = nextPrefix.name === prefix.name
    ? `Pasted “${nextPrefix.name}” and added it to the registry.`
    : `Pasted “${prefix.name}” as “${nextPrefix.name}” and added it to the registry.`;
  prefixStatus.dataset.state = "success";
  requestAnimationFrame(() => {
    prefixList.lastElementChild?.querySelector(".prefix-copy-button")?.focus();
  });
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
      await desktopBridge.savePrefixSettings({
        prefixes: nextPrefixes
      });
      prefixStatus.textContent = "Prefix settings saved.";
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
  preparePrefixDialog("add", -1);
  prefixDialog.showModal();
  voicePrefixOption.focus();
}

function addPrefixManually() {
  editingPrefixIndex = -1;
  prefixDialogKicker.textContent = "New instruction prefix";
  prefixDialogHeading.textContent = "Add a prefix";
  prefixEditName.value = "";
  prefixEditInstruction.value = "";
  prefixEditSearch.checked = false;
  prefixEditClipboard.checked = false;
  prefixEditStatus.textContent = "";
  prefixEditStatus.dataset.state = "idle";
  prefixEditRemoveButton.hidden = true;
  setButtonLabel(prefixEditSaveButton, "Add prefix");
  showPrefixDialogView(prefixEditView);
  prefixEditName.focus();
}

function openPrefixEditor(index) {
  const prefix = prefixConfig[index];
  if (!prefix) return;
  editingPrefixIndex = index;
  prefixDialogKicker.textContent = "Prefix settings";
  prefixDialogHeading.textContent = "Edit prefix";
  prefixEditName.value = prefix.name;
  prefixEditInstruction.value = prefix.instruction;
  prefixEditSearch.checked = prefix.allowSearch === true;
  prefixEditClipboard.checked = prefix.allowClipboard === true;
  prefixEditStatus.textContent = "";
  prefixEditStatus.dataset.state = "idle";
  prefixEditRemoveButton.hidden = false;
  setButtonLabel(prefixEditSaveButton, "Save changes");
  showPrefixDialogView(prefixEditView);
  prefixDialog.showModal();
  prefixEditName.focus();
  prefixEditName.select();
  autoResizeTextarea(prefixEditInstruction);
}

function savePrefixEdit() {
  const nextPrefix = {
    id: editingPrefixIndex >= 0 ? prefixConfig[editingPrefixIndex]?.id || "" : "",
    name: prefixEditName.value,
    instruction: prefixEditInstruction.value,
    allowSearch: prefixEditSearch.checked,
    allowClipboard: prefixEditClipboard.checked
  };
  const nextPrefixes = prefixConfig.map((prefix, index) =>
    index === editingPrefixIndex ? nextPrefix : prefix);
  if (editingPrefixIndex < 0) nextPrefixes.push(nextPrefix);

  const validationError = getPrefixValidationError(nextPrefixes);
  if (validationError) {
    prefixEditStatus.textContent = validationError;
    prefixEditStatus.dataset.state = "error";
    return;
  }

  const savedIndex = editingPrefixIndex >= 0 ? editingPrefixIndex : prefixConfig.length;
  prefixConfig = nextPrefixes;
  renderPrefixes();
  prefixDialog.close();
  queuePrefixSave({ immediate: true });
  requestAnimationFrame(() => {
    prefixList.children[savedIndex]?.querySelector("button")?.focus();
  });
}

function removeEditingPrefix() {
  if (editingPrefixIndex < 0) return;
  removePrefix(editingPrefixIndex);
  prefixDialog.close();
}

function showVoicePrefixRecorder() {
  showPrefixDialogView(prefixRecordView);
  prefixRecordStatus.textContent = "Ready when you are.";
  prefixRecordStatus.dataset.state = "idle";
  prefixRecordOrb.dataset.state = "idle";
  prefixRecordStartButton.disabled = false;
  prefixRecordStopButton.hidden = true;
  desktopBridge?.setStatus?.({ state: "idle" });
  prefixRecordStartButton.focus();
}

function returnToPrefixChoices() {
  prefixFlowToken += 1;
  abortPrefixRecording();
  showPrefixDialogView(prefixChoiceView);
  desktopBridge?.setStatus?.({ state: "idle" });
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
  desktopBridge.setStatus({ message: "Preparing prefix recording…", state: "processing", stage: "recording" });

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
    desktopBridge.setStatus({ message: "Recording…", state: "recording", stage: "recording" });
  } catch (error) {
    if (flowToken !== prefixFlowToken) return;
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
  desktopBridge.setStatus({ message: "Creating prefix…", state: "processing", stage: "instruction" });
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
    prefixPreviewStatus.textContent = "Draft ready. Make any edits before adding it.";
    prefixPreviewStatus.dataset.state = "success";
    autoResizeTextarea(prefixPreviewInstruction);
    showPrefixDialogView(prefixPreviewView);
    prefixPreviewName.focus();
    prefixPreviewName.select();
  } catch (error) {
    if (flowToken !== prefixFlowToken || !prefixDialog.open || isCancellationError(error)) return;
    console.error("Could not create prefix from voice:", error);
    setPrefixRecordError(error.message || "Could not create a prefix from that recording.");
    prefixRecordStartButton.disabled = false;
    prefixRecordStopButton.hidden = true;
  }
}

function addPreviewPrefix() {
  const nextPrefix = {
    id: "",
    name: prefixPreviewName.value,
    instruction: prefixPreviewInstruction.value,
    allowSearch: prefixPreviewSearch.checked,
    allowClipboard: prefixPreviewClipboard.checked
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
  prefixList.lastElementChild?.querySelector("button")?.focus();
}

function showPrefixDialogView(view) {
  [prefixChoiceView, prefixEditView, prefixRecordView, prefixPreviewView].forEach((candidate) => {
    candidate.hidden = candidate !== view;
  });
}

function preparePrefixDialog(mode, index) {
  prefixFlowToken += 1;
  abortPrefixRecording();
  editingPrefixIndex = index;
  prefixDialogKicker.textContent = mode === "edit" ? "Prefix settings" : "New instruction prefix";
  prefixDialogHeading.textContent = mode === "edit" ? "Edit prefix" : "Add a prefix to your voice";
  prefixEditRemoveButton.hidden = mode !== "edit";
  setButtonLabel(prefixEditSaveButton, mode === "edit" ? "Save changes" : "Add prefix");
  prefixEditStatus.textContent = "";
  prefixEditStatus.dataset.state = "idle";
  prefixPreviewSearch.checked = false;
  prefixPreviewClipboard.checked = false;
  showPrefixDialogView(prefixChoiceView);
}

function resetPrefixDialog() {
  prefixFlowToken += 1;
  abortPrefixRecording();
  editingPrefixIndex = -1;
  desktopBridge?.setStatus?.({ state: "idle" });
  prefixPreviewTranscript.textContent = "";
  prefixPreviewName.value = "";
  prefixPreviewInstruction.value = "";
  prefixPreviewSearch.checked = false;
  prefixPreviewClipboard.checked = false;
  prefixPreviewStatus.textContent = "";
  prefixPreviewStatus.dataset.state = "idle";
  prefixRecordStatus.textContent = "Ready when you are.";
  prefixRecordStatus.dataset.state = "idle";
  prefixRecordOrb.dataset.state = "idle";
  prefixRecordStartButton.disabled = false;
  prefixRecordStopButton.disabled = false;
  prefixRecordStopButton.hidden = true;
  prefixEditName.value = "";
  prefixEditInstruction.value = "";
  prefixEditSearch.checked = false;
  prefixEditClipboard.checked = false;
  prefixEditStatus.textContent = "";
  prefixEditStatus.dataset.state = "idle";
  prefixDialogKicker.textContent = "New instruction prefix";
  prefixDialogHeading.textContent = "Add a prefix to your voice";
  prefixEditRemoveButton.hidden = true;
  setButtonLabel(prefixEditSaveButton, "Add prefix");
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
  desktopBridge?.setStatus?.({ message, state: "error", stage: "instruction" });
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

function isCancellationError(error) {
  return Boolean(error && (
    error.code === "ERR_CANCELED"
    || error.name === "AbortError"
    || error.name === "CanceledError"
    || /ERR_CANCELED|AbortError|CanceledError|cancel(?:ed|led) by user/i.test(error.message || "")
  ));
}

function removePrefix(index) {
  prefixConfig.splice(index, 1);
  renderPrefixes();
  queuePrefixSave();
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
    renderProfiles();
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

// You cannot judge a cue volume you have never heard, so let it be heard.
async function playCuePreview() {
  previewCueSound.pause();
  previewCueSound.currentTime = 0;
  previewCueSound.volume = normalizeSoundVolume(Number(soundVolumeInput.value) / 100);
  try {
    await previewCueSound.play();
  } catch (error) {
    console.error("Could not play the cue preview:", error);
    soundVolumeStatus.textContent = "Could not play the cue on this device.";
    soundVolumeStatus.dataset.state = "error";
  }
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
  setButtonLabel(captureHotkeyButton, "Press keys…");
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
  setButtonLabel(captureHotkeyButton, "Set hotkey");
  cancelHotkeyButton.hidden = true;
}

function normalizePrefix(prefix) {
  return {
    id: typeof prefix?.id === "string" ? prefix.id : "",
    name: typeof prefix?.name === "string" ? prefix.name : "",
    instruction: typeof prefix?.instruction === "string" ? prefix.instruction : "",
    allowSearch: prefix?.allowSearch === true,
    allowClipboard: prefix?.allowClipboard === true
  };
}

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}
