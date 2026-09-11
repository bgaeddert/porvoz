import { loadRuntimeConfig } from "./runtime-config.js";
import { isRecordingTooShort } from "./capture-policy.js";
import { createButtonLabel, createIcon, setButtonLabel } from "./icons.js";
import { getUniquePrefixName, parsePrefix, serializePrefix } from "./prefix-transfer.js";
import { bridge } from "./app-bridge.js";
import { createRecorder, getRecordingSupport } from "./media-support.js";

const RADIAL_SLOT_DEFINITIONS = [
  ...Array.from({ length: 12 }, (_value, index) => ({
    id: String(index + 1), number: index + 1,
    position: `${index === 0 ? 12 : index} o'clock`
  })),
  { id: "center", number: 13, position: "Center" }
];

function formatRadialActionLabel(action) {
  if (!action) return "";
  if (action.type === "navigation") return action.command === "forward" ? "Forward" : "Back";
  return Array.isArray(action.keys) ? action.keys.join(" + ") : "";
}

function formatMouseButtonLabel(button) {
  return { 1: "Mouse Left", 2: "Mouse Right", 3: "Mouse Middle", 4: "Mouse Back", 5: "Mouse Forward" }[button]
    || `Mouse ${button}`;
}

const RADIAL_PREVIEW_CENTER = 276;
const RADIAL_PREVIEW_OUTER_RADIUS = 264;
const RADIAL_PREVIEW_INNER_RADIUS = 128;
const RADIAL_PREVIEW_SEGMENT_GAP = 2.4;

function radialSettingsSegmentPath(index) {
  const centerAngle = -90 + index * 30;
  const startAngle = centerAngle - 15 + RADIAL_PREVIEW_SEGMENT_GAP / 2;
  const endAngle = centerAngle + 15 - RADIAL_PREVIEW_SEGMENT_GAP / 2;
  const outerStart = radialSettingsPolarPoint(RADIAL_PREVIEW_OUTER_RADIUS, startAngle);
  const outerEnd = radialSettingsPolarPoint(RADIAL_PREVIEW_OUTER_RADIUS, endAngle);
  const innerEnd = radialSettingsPolarPoint(RADIAL_PREVIEW_INNER_RADIUS, endAngle);
  const innerStart = radialSettingsPolarPoint(RADIAL_PREVIEW_INNER_RADIUS, startAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${RADIAL_PREVIEW_OUTER_RADIUS} ${RADIAL_PREVIEW_OUTER_RADIUS} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${RADIAL_PREVIEW_INNER_RADIUS} ${RADIAL_PREVIEW_INNER_RADIUS} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    "Z"
  ].join(" ");
}

function radialSettingsPolarPoint(radius, angle) {
  const radians = angle * Math.PI / 180;
  return {
    x: RADIAL_PREVIEW_CENTER + radius * Math.cos(radians),
    y: RADIAL_PREVIEW_CENTER + radius * Math.sin(radians)
  };
}

const profileSelect = document.querySelector("#profile-select");
const backendForm = document.querySelector("#backend-form");
const backendMode = document.querySelector("#backend-mode");
const remoteBackendFields = document.querySelector("#remote-backend-fields");
const remoteBackendUrl = document.querySelector("#remote-backend-url");
const remoteAdminKey = document.querySelector("#remote-admin-key");
const backendStatus = document.querySelector("#backend-status");
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
const openRouterSearchInput = document.querySelector("#open-router-search");
const connectionForm = document.querySelector("#connection-form");
const connectionStatus = document.querySelector("#connection-status");
const inferenceApiKey = document.querySelector("#inference-api-key");
const copyInferenceApiKeyButton = document.querySelector("#copy-inference-api-key");
const rotateInferenceApiKeyButton = document.querySelector("#rotate-inference-api-key");
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
const addPrefixButton = document.querySelector("#add-prefix");
const importPrefixButton = document.querySelector("#import-prefix");
const refreshPrefixesButton = document.querySelector("#refresh-prefixes");
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
const prefixPreviewClipboard = document.querySelector("#prefix-preview-clipboard");
const prefixPreviewStatus = document.querySelector("#prefix-preview-status");
const prefixPreviewCancelButton = document.querySelector("#prefix-preview-cancel");
const prefixPreviewAddButton = document.querySelector("#prefix-preview-add");
const prefixEditName = document.querySelector("#prefix-edit-name");
const prefixEditInstruction = document.querySelector("#prefix-edit-instruction");
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
const captureHotkeyButton = document.querySelector("#capture-hotkey");
const cancelHotkeyButton = document.querySelector("#cancel-hotkey");
const hotkeyDisplay = document.querySelector("#hotkey-display");
const hotkeyStatus = document.querySelector("#hotkey-status");
const radialEnabledInput = document.querySelector("#radial-enabled");
const radialTriggerDisplay = document.querySelector("#radial-trigger-display");
const captureRadialTriggerButton = document.querySelector("#capture-radial-trigger");
const cancelRadialTriggerButton = document.querySelector("#cancel-radial-trigger");
const radialTriggerStatus = document.querySelector("#radial-trigger-status");
const radialSettingsSegments = document.querySelector("#radial-settings-segments");
const radialSettingsCenter = document.querySelector("#radial-settings-center");
const radialSettingsCenterRing = document.querySelector("#radial-settings-center-ring");
const radialSettingsCenterLabel = document.querySelector("#radial-settings-center-label");
const radialSlotForm = document.querySelector("#radial-slot-form");
const radialEditorLabel = document.querySelector("#radial-editor-label");
const radialEditorActionType = document.querySelector("#radial-editor-action-type");
const radialEditorAction = document.querySelector("#radial-editor-action");
const cancelRadialSlotEditButton = document.querySelector("#cancel-radial-slot-edit");
const saveRadialSlotEditButton = document.querySelector("#save-radial-slot-edit");
const radialSlotStatus = document.querySelector("#radial-slot-status");
const soundVolumeInput = document.querySelector("#sound-volume");
const soundVolumeValue = document.querySelector("#sound-volume-value");
const soundVolumeStatus = document.querySelector("#sound-volume-status");
const consoleSelectionInput = document.querySelector("#console-selection-enabled");
const consoleSelectionStatus = document.querySelector("#console-selection-status");
let savedConsoleSelectionEnabled = false;
const previewCueButton = document.querySelector("#preview-cue");
// Desktop-only cards are absent from the browser document, so their cue audio
// is never created and its file is never requested.
const previewCueSound = previewCueButton ? new Audio("./assets/recording-start.mp3") : null;
const recordingSupport = getRecordingSupport();

let runtimeConfig;
let prefixConfig = [];
let isCapturingHotkey = false;
let radialMenu;
let isCapturingRadialTrigger = false;
let radialSlotCaptureId = "";
let radialEditorSlotId = "";
let radialEditorDraft;
let radialSaveQueue = Promise.resolve();
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

await initializeSettings();

async function initializeSettings() {
  backendMode?.addEventListener("change", renderBackendMode);
  backendForm?.addEventListener("submit", saveBackendSettings);
  const controls = [...document.querySelectorAll("input, select, textarea, button")]
    .filter((control) => !control.closest("#backend"));
  const disabledStates = controls.map((control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  if (backendForm) await loadBackendSettings();
  try {
    runtimeConfig = await loadRuntimeConfig();
  } catch (error) {
    setStartupError(error);
    return;
  }
  controls.forEach((control, index) => { control.disabled = disabledStates[index]; });
  prefixConfig = runtimeConfig.prefixes.map(normalizePrefix);

  baseUrlInput.maxLength = 2048;
  apiKeyInput.maxLength = 4096;
  profileNameInput.maxLength = runtimeConfig.limits.maxProfileNameCharacters;
  prefixEditName.maxLength = runtimeConfig.limits.maxPrefixNameCharacters;
  prefixEditInstruction.maxLength = runtimeConfig.limits.maxPrefixInstructionCharacters;
  prefixPreviewName.maxLength = runtimeConfig.limits.maxPrefixNameCharacters;
  prefixPreviewInstruction.maxLength = runtimeConfig.limits.maxPrefixInstructionCharacters;

  renderProfiles();
  loadConnectionSettings();
  renderModels();
  renderPrefixes();
  renderVoicePrefixSupport();
  if (soundVolumeInput) renderSoundVolume(runtimeConfig.soundVolume);
  if (consoleSelectionInput) renderConsoleSelection(runtimeConfig.consoleSelectionEnabled);
  if (hotkeyDisplay) await initializeHotkey();
  if (radialEnabledInput && bridge.features.radialMenu) await initializeRadialMenu();

  profileSelect.addEventListener("change", switchActiveProfile);
  addProfileButton.addEventListener("click", openAddProfileDialog);
  renameProfileButton.addEventListener("click", openRenameProfileDialog);
  deleteProfileButton.addEventListener("click", openDeleteProfileDialog);
  cancelProfileDialogButton.addEventListener("click", () => profileDialog.close());
  saveProfileDialogButton.addEventListener("click", saveProfileDialog);
  cancelDeleteProfileButton.addEventListener("click", () => deleteProfileDialog.close());
  confirmDeleteProfileButton.addEventListener("click", confirmDeleteProfile);
  connectionForm.addEventListener("submit", saveConnection);
  copyInferenceApiKeyButton.addEventListener("click", copyInferenceApiKey);
  rotateInferenceApiKeyButton.addEventListener("click", rotateInferenceApiKey);
  populateModelsButton.addEventListener("click", populateModels);
  transcriptionModel.addEventListener("input", handleModelInput);
  instructionModel.addEventListener("input", handleModelInput);
  instructionReasoning.addEventListener("change", saveModelSelections);
  openRouterSearchInput.addEventListener("change", saveModelSelections);
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
  addPrefixButton.addEventListener("click", openPrefixDialog);
  importPrefixButton.addEventListener("click", importPrefixFromClipboard);
  refreshPrefixesButton.addEventListener("click", refreshPrefixes);
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
  cancelResetButton.addEventListener("click", () => resetDialog.close());
  captureHotkeyButton?.addEventListener("click", beginHotkeyCapture);
  cancelHotkeyButton?.addEventListener("click", cancelHotkeyCapture);
  radialEnabledInput?.addEventListener("change", saveRadialEnabled);
  captureRadialTriggerButton?.addEventListener("click", beginRadialTriggerCapture);
  // Cancel on pointer-down so its left-button release cannot be mistaken for
  // the mouse trigger currently being recorded.
  cancelRadialTriggerButton?.addEventListener("pointerdown", cancelRadialCapture);
  radialSettingsSegments?.addEventListener("click", handleRadialPreviewClick);
  radialSettingsSegments?.addEventListener("keydown", handleRadialPreviewKeydown);
  radialSettingsCenter?.addEventListener("click", () => selectRadialSlot("center"));
  radialSettingsCenter?.addEventListener("keydown", handleRadialCenterKeydown);
  radialEditorLabel?.addEventListener("input", () => {
    if (radialEditorDraft) radialEditorDraft.label = radialEditorLabel.value.slice(0, 64);
  });
  radialEditorActionType?.addEventListener("change", handleRadialEditorActionTypeChange);
  radialSlotForm?.addEventListener("submit", saveRadialSlotEdit);
  cancelRadialSlotEditButton?.addEventListener("click", cancelRadialSlotEdit);
  soundVolumeInput?.addEventListener("input", updateSoundVolumePreview);
  soundVolumeInput?.addEventListener("change", saveSoundVolume);
  consoleSelectionInput?.addEventListener("change", saveConsoleSelection);
  previewCueButton?.addEventListener("click", playCuePreview);

  if (bridge.features.hotkeys) {
    bridge.onHotkeyUpdated(handleHotkeyUpdated);
    bridge.onHotkeyCaptureStatus(handleHotkeyCaptureStatus);
  }
  if (bridge.features.radialMenu) {
    bridge.onRadialMenuUpdated?.(handleRadialMenuUpdated);
    bridge.onRadialTriggerCaptureStatus?.(handleRadialTriggerCaptureStatus);
    bridge.onRadialSlotCaptureStatus?.(handleRadialSlotCaptureStatus);
  }
  if (bridge.features.sounds) bridge.onSoundVolumeUpdated(handleSoundVolumeUpdated);
  if (bridge.features.activityEvents) bridge.onActivityCanceled(handleActivityCanceled);
}

// The server card is where the desktop reports a connection failure. The
// website administers one server and has no such card, so the same failure is
// reported beside the provider form instead.
function setStartupError(error) {
  const target = backendStatus || connectionStatus;
  target.textContent = backendStatus
    ? `Could not load server settings. Choose Local or update the remote connection above. ${error.message || ""}`
    : `Could not load this server's settings. ${error.message || ""}`;
  target.dataset.state = "error";
}

// Capture and voice prefix creation share one capability check, so a browser
// that cannot record explains itself the same way in both places.
function renderVoicePrefixSupport() {
  if (recordingSupport.supported) return;
  voicePrefixOption.disabled = true;
  voicePrefixOption.title = recordingSupport.message;
  prefixRecordStartButton.disabled = true;
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
    bridge.setStatus?.({ state: "idle" });
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

async function loadBackendSettings() {
  try {
    const settings = await bridge.getBackendSettings();
    backendMode.value = settings.mode;
    remoteBackendUrl.value = settings.remoteUrl || "";
    remoteAdminKey.value = "";
    remoteAdminKey.placeholder = settings.adminKeyConfigured
      ? "Stored securely — enter a new key to replace it"
      : "Paste the server admin key";
    renderBackendMode();
    if (settings.connectionError) {
      backendStatus.textContent = `Remote server unavailable; using the local child for recovery. ${settings.connectionError}`;
      backendStatus.dataset.state = "error";
    } else {
      backendStatus.textContent = settings.connectedMode === "local"
        ? "Using the private child server on this computer."
        : `Connected to ${settings.remoteUrl}.`;
      backendStatus.dataset.state = "success";
    }
  } catch (error) {
    backendStatus.textContent = error.message || "Could not load the server configuration.";
    backendStatus.dataset.state = "error";
  }
}

function renderBackendMode() {
  const remote = backendMode.value === "remote";
  remoteBackendFields.hidden = !remote;
  remoteBackendUrl.required = remote;
}

async function saveBackendSettings(event) {
  event.preventDefault();
  const submit = backendForm.querySelector("button[type=submit]");
  submit.disabled = true;
  backendStatus.textContent = "Connecting to the Porvoz server…";
  backendStatus.dataset.state = "saving";
  try {
    await bridge.saveBackendSettings({
      mode: backendMode.value,
      remoteUrl: remoteBackendUrl.value,
      adminKey: remoteAdminKey.value
    });
    window.location.reload();
  } catch (error) {
    backendStatus.textContent = error.message || "Could not connect to the Porvoz server.";
    backendStatus.dataset.state = "error";
    submit.disabled = false;
  }
}

async function switchActiveProfile() {
  const nextProfileId = profileSelect.value;
  if (nextProfileId === runtimeConfig.activeProfileId) return;
  setProfileControlsDisabled(true);
  profileStatus.textContent = "Switching connection profile…";
  profileStatus.dataset.state = "saving";
  try {
    runtimeConfig = await bridge.setActiveProfile({ id: nextProfileId });
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
    runtimeConfig = profileDialogMode === "add"
      ? await bridge.createProfile({ name })
      : await bridge.renameProfile({ id: runtimeConfig.activeProfileId, name });
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
    runtimeConfig = await bridge.deleteProfile({ id: runtimeConfig.activeProfileId });
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
    const result = await bridge.getConnectionSettings();
    renderConnectionSettings(result);
    const inference = await bridge.getInferenceKey();
    inferenceApiKey.value = inference.apiKey || "";
  } catch (error) {
    connectionStatus.textContent = error.message;
    connectionStatus.dataset.state = "error";
  }
}

async function copyInferenceApiKey() {
  if (!inferenceApiKey.value) return;
  try {
    await writeClipboardText(inferenceApiKey.value);
    connectionStatus.textContent = "Inference API key copied.";
    connectionStatus.dataset.state = "success";
  } catch (error) {
    console.error("Could not copy the inference API key:", error);
    // The field stays selectable, so a denied clipboard is a nuisance, not a wall.
    inferenceApiKey.select();
    connectionStatus.textContent = "Could not reach the clipboard. The key is selected; copy it manually.";
    connectionStatus.dataset.state = "error";
  }
}

async function rotateInferenceApiKey() {
  rotateInferenceApiKeyButton.disabled = true;
  try {
    const result = await bridge.rotateInferenceKey();
    inferenceApiKey.value = result.apiKey || "";
    connectionStatus.textContent = "A new inference API key was generated. The previous key no longer works.";
    connectionStatus.dataset.state = "success";
  } catch (error) {
    connectionStatus.textContent = error.message || "Could not regenerate the inference API key.";
    connectionStatus.dataset.state = "error";
  } finally {
    rotateInferenceApiKeyButton.disabled = false;
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
    const result = await bridge.saveConnection({
      baseUrl: baseUrlInput.value,
      apiKey: apiKeyInput.value,
      verifyCertificate: verifyCertificateInput.checked
    });
    renderConnectionSettings(result);
    runtimeConfig = await bridge.getRuntimeConfig();
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
  openRouterSearchInput.checked = runtimeConfig.models.selected.openRouterSearch === true;
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
    runtimeConfig = await bridge.populateModels();
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
    instructionReasoning: instructionReasoning.value,
    openRouterSearch: openRouterSearchInput.checked
  };
  const previousStatus = modelStatus.textContent;
  modelStatus.textContent = "Saving model selections…";
  modelStatus.dataset.state = "saving";
  const saveOperation = modelSaveQueue.catch(() => {}).then(async () => {
    try {
      runtimeConfig = await bridge.saveModelSelections(selections);
      transcriptionModel.value = runtimeConfig.models.selected.transcription || "";
      instructionModel.value = runtimeConfig.models.selected.instruction || "";
      instructionReasoning.value = runtimeConfig.models.selected.instructionReasoning || "low";
      openRouterSearchInput.checked = runtimeConfig.models.selected.openRouterSearch === true;
      modelStatus.textContent = `${runtimeConfig.models.available.length} models loaded. Selections saved.`;
      modelStatus.dataset.state = "success";
      return true;
    } catch (error) {
      try {
        runtimeConfig = await bridge.getRuntimeConfig();
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
  modelPickerDescription.textContent = `Filter the catalog, choose a ${target} model, then save it.`;
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
  if (bridge.writeClipboardText) {
    await bridge.writeClipboardText(text);
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
  if (bridge.readClipboardText) return bridge.readClipboardText();
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
  refreshPrefixesButton.disabled = true;
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
    refreshPrefixesButton.disabled = false;
    prefixStatus.textContent = validationError;
    prefixStatus.dataset.state = "error";
    return Promise.resolve();
  }

  prefixSaveQueue = prefixSaveQueue.catch(() => {}).then(async () => {
    try {
      const nextPrefixes = prefixConfig.map((prefix) => ({ ...prefix }));
      await bridge.savePrefixSettings({
        prefixes: nextPrefixes
      });
      prefixStatus.textContent = "Prefix settings saved.";
      prefixStatus.dataset.state = "success";
    } catch (error) {
      console.error("Could not save instruction prefixes:", error);
      prefixStatus.textContent = error.message || "Could not save prefix changes.";
      prefixStatus.dataset.state = "error";
    } finally {
      refreshPrefixesButton.disabled = false;
    }
  });
  return prefixSaveQueue;
}

async function refreshPrefixes() {
  refreshPrefixesButton.disabled = true;
  prefixStatus.textContent = "Refreshing prefixes from the server…";
  prefixStatus.dataset.state = "saving";
  try {
    await prefixSaveQueue.catch(() => {});
    const refreshedRuntime = await loadRuntimeConfig();
    prefixConfig = refreshedRuntime.prefixes.map(normalizePrefix);
    runtimeConfig.prefixes = prefixConfig.map((prefix) => ({ ...prefix }));
    renderPrefixes();
    prefixStatus.textContent = "Prefixes refreshed from the server.";
    prefixStatus.dataset.state = "success";
  } catch (error) {
    console.error("Could not refresh instruction prefixes:", error);
    prefixStatus.textContent = error.message || "Could not refresh prefixes from the server.";
    prefixStatus.dataset.state = "error";
  } finally {
    refreshPrefixesButton.disabled = false;
  }
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
  bridge.setStatus?.({ state: "idle" });
  prefixRecordStartButton.focus();
}

function returnToPrefixChoices() {
  prefixFlowToken += 1;
  abortPrefixRecording();
  showPrefixDialogView(prefixChoiceView);
  bridge.setStatus?.({ state: "idle" });
  voicePrefixOption.focus();
}

async function startPrefixRecording() {
  if (prefixRecorder || !prefixDialog.open) return;
  if (!recordingSupport.supported) {
    setPrefixRecordError(recordingSupport.message);
    prefixRecordStartButton.disabled = true;
    return;
  }

  const flowToken = prefixFlowToken;
  prefixRecordStartButton.disabled = true;
  prefixRecordStopButton.hidden = false;
  prefixRecordStopButton.disabled = true;
  prefixRecordStatus.textContent = "Requesting microphone access…";
  prefixRecordStatus.dataset.state = "processing";
  prefixRecordOrb.dataset.state = "processing";
  bridge.setStatus?.({ message: "Preparing prefix recording…", state: "processing", stage: "recording" });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (flowToken !== prefixFlowToken || !prefixDialog.open) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    prefixRecordingStream = stream;
    prefixRecordedChunks = [];
    prefixRecorder = createRecorder(stream, recordingSupport.mimeType);
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
    bridge.setStatus?.({ message: "Recording…", state: "recording", stage: "recording" });
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
  bridge.setStatus?.({ message: "Creating prefix…", state: "processing", stage: "instruction" });
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
    const result = await bridge.createPrefixFromVoice({
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
  prefixDialogHeading.textContent = mode === "edit" ? "Edit prefix" : "Add a prefix";
  prefixEditRemoveButton.hidden = mode !== "edit";
  setButtonLabel(prefixEditSaveButton, mode === "edit" ? "Save changes" : "Add prefix");
  prefixEditStatus.textContent = "";
  prefixEditStatus.dataset.state = "idle";
  prefixPreviewClipboard.checked = false;
  showPrefixDialogView(prefixChoiceView);
}

function resetPrefixDialog() {
  prefixFlowToken += 1;
  abortPrefixRecording();
  editingPrefixIndex = -1;
  bridge.setStatus?.({ state: "idle" });
  prefixPreviewTranscript.textContent = "";
  prefixPreviewName.value = "";
  prefixPreviewInstruction.value = "";
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
  prefixEditClipboard.checked = false;
  prefixEditStatus.textContent = "";
  prefixEditStatus.dataset.state = "idle";
  prefixDialogKicker.textContent = "New instruction prefix";
  prefixDialogHeading.textContent = "Add a prefix";
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
  bridge.setStatus?.({ message, state: "error", stage: "instruction" });
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
  clearTimeout(prefixSaveTimer);
  clearTimeout(soundVolumeSaveTimer);
  confirmResetButton.disabled = true;
  resetStatus.textContent = "Resetting settings…";
  resetStatus.dataset.state = "saving";
  try {
    await prefixSaveQueue.catch(() => {});
    await modelSaveQueue.catch(() => {});
    runtimeConfig = await bridge.resetToDefaults();
    prefixConfig = runtimeConfig.prefixes.map(normalizePrefix);
    renderProfiles();
    renderModels();
    renderPrefixes();
    if (soundVolumeInput) renderSoundVolume(runtimeConfig.soundVolume);
    if (consoleSelectionInput) {
      renderConsoleSelection(runtimeConfig.consoleSelectionEnabled);
      consoleSelectionStatus.textContent = "";
    }
    if (radialEnabledInput && bridge.features.radialMenu) {
      radialMenu = normalizeRadialMenuForSettings(await bridge.getRadialMenu());
      radialEditorSlotId = "";
      radialEditorDraft = undefined;
      radialSlotForm.hidden = true;
      renderRadialMenu();
      radialTriggerStatus.textContent = "Radial menu settings reset.";
      radialTriggerStatus.dataset.state = "success";
    }
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
    const hotkey = await bridge.getHotkey();
    renderHotkey(hotkey);
  } catch (error) {
    console.error("Could not load the desktop hotkey:", error);
    hotkeyStatus.textContent = error.message || "Could not load the hotkey.";
  }
}

async function initializeRadialMenu() {
  try {
    radialMenu = normalizeRadialMenuForSettings(await bridge.getRadialMenu());
    renderRadialMenu();
  } catch (error) {
    radialTriggerStatus.textContent = error.message || "Could not load the radial menu.";
    radialTriggerStatus.dataset.state = "error";
  }
}

function normalizeRadialMenuForSettings(value) {
  const sourceSlots = Array.isArray(value?.slots) ? value.slots : [];
  return {
    enabled: value?.enabled === true,
    trigger: value?.trigger && typeof value.trigger === "object" ? { ...value.trigger } : null,
    slots: RADIAL_SLOT_DEFINITIONS.map((definition) => {
      const source = sourceSlots.find((slot) => String(slot?.id) === definition.id);
      return {
        id: definition.id,
        label: typeof source?.label === "string" ? source.label : "",
        action: source?.action && typeof source.action === "object" ? { ...source.action } : null
      };
    })
  };
}

function renderRadialMenu() {
  if (!radialMenu || !radialSettingsSegments) return;
  radialEnabledInput.checked = radialMenu.enabled === true;
  const trigger = radialMenu.trigger;
  radialTriggerDisplay.textContent = trigger
    ? trigger.label || (trigger.kind === "mouse" ? formatMouseButtonLabel(trigger.button) : "Assigned")
    : "Not assigned";

  renderRadialPreview();
  if (radialEditorDraft && radialEditorSlotId) renderRadialSlotEditor();
}

function renderRadialPreview() {
  radialSettingsSegments.replaceChildren();
  const slotMap = new Map(radialMenu.slots.map((slot) => [slot.id, slot]));
  for (let index = 0; index < 12; index += 1) {
    const definition = RADIAL_SLOT_DEFINITIONS[index];
    const slot = slotMap.get(definition.id) || { id: definition.id, label: "", action: null };
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("radial-settings-segment");
    group.dataset.slotId = definition.id;
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", radialSlotAriaLabel(definition, slot));

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("radial-settings-segment-shape");
    path.setAttribute("d", radialSettingsSegmentPath(index));
    group.append(path);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.classList.add("radial-settings-segment-label");
    const point = radialSettingsPolarPoint(190, -90 + index * 30);
    text.setAttribute("x", point.x);
    text.setAttribute("y", point.y);
    text.setAttribute("text-anchor", "middle");
    text.textContent = displayRadialSlotLabel(slot, "");
    group.append(text);
    radialSettingsSegments.append(group);
  }

  const centerSlot = slotMap.get("center") || { id: "center", label: "", action: null };
  radialSettingsCenterLabel.textContent = displayRadialSlotLabel(centerSlot, "");
  radialSettingsCenter.setAttribute("aria-label", radialSlotAriaLabel(
    RADIAL_SLOT_DEFINITIONS.at(-1), centerSlot
  ));
  radialSettingsSegments.querySelectorAll(".radial-settings-segment").forEach((segment) => {
    segment.classList.toggle("selected", segment.dataset.slotId === radialEditorSlotId);
  });
  radialSettingsCenter.classList.toggle("selected", radialEditorSlotId === "center");
  radialSettingsCenterRing.classList.toggle("selected", radialEditorSlotId === "center");
}

function displayRadialSlotLabel(slot, fallback) {
  const label = typeof slot?.label === "string" ? slot.label.trim() : "";
  if (label) return label;
  if (!slot?.action) return fallback;
  return formatRadialActionLabel(slot.action) || (
    slot.action.type === "navigation"
      ? slot.action.command === "forward" ? "Forward" : "Back"
      : "Assigned"
  );
}

function radialSlotAriaLabel(definition, slot) {
  const label = displayRadialSlotLabel(slot, "Empty");
  return `Slot ${definition.number}, ${definition.position}: ${label}`;
}

function handleRadialPreviewClick(event) {
  const segment = event.target.closest?.(".radial-settings-segment");
  if (segment) selectRadialSlot(segment.dataset.slotId);
}

function handleRadialPreviewKeydown(event) {
  if (!event.target.classList.contains("radial-settings-segment")) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  selectRadialSlot(event.target.dataset.slotId);
}

function handleRadialCenterKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  selectRadialSlot("center");
}

function getRadialDefinition(slotId) {
  return RADIAL_SLOT_DEFINITIONS.find((definition) => definition.id === slotId);
}

function getRadialSlot(slotId) {
  return radialMenu?.slots?.find((slot) => slot.id === slotId);
}

function selectRadialSlot(slotId) {
  if (!getRadialDefinition(slotId) || radialSlotCaptureId) return;
  const slot = getRadialSlot(slotId) || { id: slotId, label: "", action: null };
  radialEditorSlotId = slotId;
  radialEditorDraft = {
    id: slotId,
    label: slot.label || "",
    action: slot.action ? structuredClone(slot.action) : null,
    actionType: slot.action?.type || ""
  };
  radialSlotStatus.textContent = "";
  radialSlotStatus.dataset.state = "idle";
  renderRadialPreview();
  renderRadialSlotEditor();
  radialEditorLabel?.focus();
}

function renderRadialSlotEditor() {
  if (!radialSlotForm) return;
  if (!radialEditorDraft || !radialEditorSlotId) {
    radialSlotForm.hidden = true;
    return;
  }
  radialSlotForm.hidden = false;
  radialEditorLabel.value = radialEditorDraft.label || "";
  radialEditorActionType.value = radialEditorDraft.actionType || radialEditorDraft.action?.type || "";
  radialEditorAction.replaceChildren();

  if (radialEditorDraft.action?.type === "navigation") {
    const navigation = document.createElement("select");
    navigation.className = "radial-editor-navigation";
    navigation.setAttribute("aria-label", "Navigation action");
    appendRadialOption(navigation, "back", "Back");
    appendRadialOption(navigation, "forward", "Forward");
    navigation.value = radialEditorDraft.action.command === "forward" ? "forward" : "back";
    navigation.addEventListener("change", () => {
      radialEditorDraft.action = {
        type: "navigation",
        command: navigation.value,
        label: navigation.value === "forward" ? "Forward" : "Back"
      };
    });
    radialEditorAction.append(navigation, createRadialEditorClearButton());
  } else if (radialEditorActionType.value === "hotkey") {
    const readout = document.createElement("kbd");
    readout.className = "radial-editor-readout";
    readout.textContent = formatRadialActionLabel(radialEditorDraft.action) || "Not assigned";
    const record = document.createElement("button");
    record.type = "button";
    record.className = "button-secondary";
    record.disabled = Boolean(radialSlotCaptureId && radialSlotCaptureId !== radialEditorSlotId);
    setButtonLabel(record, radialSlotCaptureId === radialEditorSlotId ? "Press keys…" : "Record shortcut");
    record.addEventListener("click", () => beginRadialSlotCapture(radialEditorSlotId));
    radialEditorAction.append(readout, record, createRadialEditorClearButton());
  }
  saveRadialSlotEditButton.disabled = Boolean(radialSlotCaptureId);
}

function handleRadialEditorActionTypeChange() {
  if (!radialEditorDraft) return;
  const type = radialEditorActionType.value;
  radialEditorDraft.actionType = type;
  if (type === "navigation") {
    const command = radialEditorDraft.action?.type === "navigation"
      && radialEditorDraft.action.command === "forward"
      ? "forward"
      : "back";
    radialEditorDraft.action = {
      type: "navigation",
      command,
      label: command === "forward" ? "Forward" : "Back"
    };
  } else if (type === "hotkey") {
    radialEditorDraft.action = radialEditorDraft.action?.type === "hotkey"
      ? structuredClone(radialEditorDraft.action)
      : null;
  } else {
    radialEditorDraft.action = null;
    radialEditorDraft.actionType = "";
  }
  renderRadialSlotEditor();
}

function appendRadialOption(select, value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  select.append(option);
}

function createRadialEditorClearButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button-secondary";
  setButtonLabel(button, "Clear slot");
  button.addEventListener("click", () => {
    if (!radialEditorDraft) return;
    radialEditorDraft.label = "";
    radialEditorDraft.action = null;
    radialEditorDraft.actionType = "";
    renderRadialSlotEditor();
  });
  return button;
}

async function saveRadialEnabled() {
  if (!radialMenu) return;
  const nextMenu = {
    ...radialMenu,
    enabled: radialEnabledInput.checked
  };
  radialMenu = nextMenu;
  radialTriggerStatus.textContent = radialMenu.enabled && !radialMenu.trigger
    ? "Set a trigger before using the radial menu."
    : "Saving…";
  radialTriggerStatus.dataset.state = "saving";
  try {
    await queueRadialMenuSave(nextMenu);
  } catch {
    // queueRadialMenuSave reports the actionable error beside the setting.
  }
}

async function saveRadialSlotEdit(event) {
  event.preventDefault();
  if (!radialMenu || !radialEditorDraft || !radialEditorSlotId || radialSlotCaptureId) return;
  const nextMenu = {
    ...radialMenu,
    slots: radialMenu.slots.map((slot) => slot.id === radialEditorSlotId
      ? {
        ...slot,
        label: radialEditorDraft.label.trim(),
        action: radialEditorDraft.action ? structuredClone(radialEditorDraft.action) : null
      }
      : slot)
  };
  saveRadialSlotEditButton.disabled = true;
  cancelRadialSlotEditButton.disabled = true;
  radialSlotStatus.textContent = "Saving…";
  radialSlotStatus.dataset.state = "saving";
  try {
    radialMenu = normalizeRadialMenuForSettings(await bridge.saveRadialMenu(nextMenu));
    const savedSlot = getRadialSlot(radialEditorSlotId);
    radialEditorDraft = savedSlot ? {
      id: savedSlot.id,
      label: savedSlot.label || "",
      action: savedSlot.action ? structuredClone(savedSlot.action) : null,
      actionType: savedSlot.action?.type || ""
    } : undefined;
    radialSlotStatus.textContent = "Saved.";
    radialSlotStatus.dataset.state = "success";
    renderRadialPreview();
    renderRadialSlotEditor();
  } catch (error) {
    radialSlotStatus.textContent = error.message || "Could not save this radial slot.";
    radialSlotStatus.dataset.state = "error";
  } finally {
    cancelRadialSlotEditButton.disabled = false;
    if (!radialSlotCaptureId) saveRadialSlotEditButton.disabled = false;
  }
}

function cancelRadialSlotEdit() {
  if (radialSlotCaptureId) void bridge.cancelRadialCapture?.();
  radialSlotCaptureId = "";
  radialEditorSlotId = "";
  radialEditorDraft = undefined;
  radialSlotStatus.textContent = "";
  radialSlotStatus.dataset.state = "idle";
  radialSlotForm.hidden = true;
  renderRadialPreview();
}

async function queueRadialMenuSave(value, { render = true } = {}) {
  if (!value) return;
  const requestedMenu = normalizeRadialMenuForSettings(value);
  radialSaveQueue = radialSaveQueue.catch(() => {}).then(async () => {
    try {
      radialMenu = normalizeRadialMenuForSettings(await bridge.saveRadialMenu(requestedMenu));
      if (render) renderRadialMenu();
      radialTriggerStatus.textContent = radialMenu.enabled && !radialMenu.trigger
        ? "Set a trigger before using the radial menu."
        : "Radial menu settings saved.";
      radialTriggerStatus.dataset.state = "success";
    } catch (error) {
      radialTriggerStatus.textContent = error.message || "Could not save radial menu settings.";
      radialTriggerStatus.dataset.state = "error";
      throw error;
    }
  });
  return radialSaveQueue;
}

async function beginRadialTriggerCapture() {
  if (isCapturingRadialTrigger) return;
  isCapturingRadialTrigger = true;
  captureRadialTriggerButton.disabled = true;
  setButtonLabel(captureRadialTriggerButton, "Press trigger…");
  cancelRadialTriggerButton.hidden = false;
  radialTriggerStatus.textContent = "Press a keyboard key or mouse button, then release it to save. Click Cancel to stop recording.";
  try {
    await bridge.beginRadialTriggerCapture();
  } catch (error) {
    finishRadialTriggerCapture();
    radialTriggerStatus.textContent = error.message || "Could not capture the radial trigger.";
    radialTriggerStatus.dataset.state = "error";
  }
}

function cancelRadialCapture() {
  void bridge.cancelRadialCapture?.();
  finishRadialTriggerCapture();
  finishRadialSlotCapture();
  radialTriggerStatus.textContent = "Radial shortcut capture canceled.";
  radialTriggerStatus.dataset.state = "idle";
}

function handleRadialTriggerCaptureStatus({ state, message } = {}) {
  if (message) radialTriggerStatus.textContent = message;
  radialTriggerStatus.dataset.state = state || "idle";
  if (state === "saved" || state === "canceled") finishRadialTriggerCapture();
}

function finishRadialTriggerCapture() {
  isCapturingRadialTrigger = false;
  if (captureRadialTriggerButton) {
    captureRadialTriggerButton.disabled = false;
    setButtonLabel(captureRadialTriggerButton, "Set trigger");
  }
  if (cancelRadialTriggerButton) cancelRadialTriggerButton.hidden = true;
}

async function beginRadialSlotCapture(slotId) {
  if (!slotId || radialSlotCaptureId || !radialEditorDraft) return;
  radialSlotCaptureId = slotId;
  radialSlotStatus.textContent = "Recording shortcut…";
  radialSlotStatus.dataset.state = "waiting";
  renderRadialSlotEditor();
  try {
    await bridge.beginRadialSlotCapture(slotId);
  } catch (error) {
    finishRadialSlotCapture();
    radialSlotStatus.textContent = error.message || "Could not capture the slot shortcut.";
    radialSlotStatus.dataset.state = "error";
  }
}

function handleRadialSlotCaptureStatus({ state, message, slotId, action } = {}) {
  if (slotId && radialSlotCaptureId && slotId !== radialSlotCaptureId) return;
  if (state === "saved" && action && radialEditorDraft && radialEditorSlotId === slotId) {
    radialEditorDraft.action = structuredClone(action);
    radialEditorDraft.actionType = "hotkey";
    radialSlotStatus.textContent = "Shortcut recorded. Save changes to apply it.";
  } else if (message) {
    radialSlotStatus.textContent = message;
  }
  radialSlotStatus.dataset.state = state === "saved" ? "success" : state || "idle";
  if (state === "saved" || state === "canceled") {
    finishRadialSlotCapture();
    renderRadialSlotEditor();
  }
}

function finishRadialSlotCapture() {
  radialSlotCaptureId = "";
  renderRadialSlotEditor();
}

function handleRadialMenuUpdated(value) {
  radialMenu = normalizeRadialMenuForSettings(value);
  renderRadialMenu();
}

function renderHotkey(hotkey) {
  hotkeyDisplay.textContent = hotkey.label;
}

function renderConsoleSelection(value) {
  savedConsoleSelectionEnabled = value === true;
  consoleSelectionInput.checked = savedConsoleSelectionEnabled;
}

async function saveConsoleSelection() {
  const nextValue = consoleSelectionInput.checked;
  consoleSelectionInput.disabled = true;
  consoleSelectionStatus.textContent = "Saving…";
  consoleSelectionStatus.dataset.state = "saving";
  try {
    const saved = await bridge.saveConsoleSelectionEnabled(nextValue);
    renderConsoleSelection(saved);
    consoleSelectionStatus.textContent = saved ? "Console selection is on." : "Console selection is off.";
    consoleSelectionStatus.dataset.state = "success";
  } catch (error) {
    consoleSelectionInput.checked = savedConsoleSelectionEnabled;
    consoleSelectionStatus.textContent = error.message || "Could not save console selection.";
    consoleSelectionStatus.dataset.state = "error";
  } finally {
    consoleSelectionInput.disabled = false;
  }
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
  if (!previewCueSound) return;
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
      const savedVolume = await bridge.saveSoundVolume(nextVolume);
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
  hotkeyStatus.textContent = "Press one Control/Alt key, a modifier combination, or hold modifiers and press a trigger; release to save. Escape cancels.";
  try {
    await bridge.beginHotkeyCapture();
  } catch (error) {
    finishHotkeyCapture();
    hotkeyStatus.textContent = error.message || "Could not capture the hotkey.";
  }
}

function cancelHotkeyCapture() {
  bridge.cancelHotkeyCapture();
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
    allowClipboard: prefix?.allowClipboard === true
  };
}

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}
