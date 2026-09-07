import { loadRuntimeConfig } from "./runtime-config.js";
import { MINIMUM_RECORDING_DURATION_MS, isRecordingTooShort } from "./capture-policy.js";
import { setButtonIcon, setButtonLabel } from "./icons.js";
import { bridge } from "./app-bridge.js";
import { createRecorder, getRecordingSupport } from "./media-support.js";

const transcribeButton = document.querySelector("#transcribe");
const clearButton = document.querySelector("#clear");
const status = document.querySelector("#status");
const transcript = document.querySelector("#transcript");
const instructionResponse = document.querySelector("#instruction-response");
const hotkeyHint = document.querySelector("#hotkey-hint");
const captureSignal = document.querySelector("#capture-signal");
const recordingNotice = document.querySelector("#recording-unavailable");
const MICROPHONE_REQUEST_TIMEOUT_MS = 10_000;

const runtimeConfig = await loadRuntimeConfig();
const recordingSupport = getRecordingSupport();
let hotkeySoundVolume = normalizeSoundVolume(runtimeConfig.soundVolume);

let isTranscribing = false;
let isTranscriptionProcessing = false;
let isTypingResponse = false;
let activityGeneration = 0;
let stopRequested = false;
let shouldTypeFinalResponse = false;
let captureIntentId = "";
let discardRecording = false;
let recordingStartedAt = 0;
let hotkeyReleasedTimestamp = null;
let mediaRecorder;
let transcriptionStream;
let recordedChunks = [];
// Recording cues are a desktop affordance; the browser site never plays them
// and never requests their audio files.
const hotkeySounds = bridge.features.sounds
  ? {
      start: createHotkeySound("./assets/recording-start.mp3"),
      stop: createHotkeySound("./assets/recording-stop.mp3"),
      failure: createHotkeySound("./assets/text-input-failure.mp3")
    }
  : {};

transcribeButton.addEventListener("click", () => {
  if (isTranscribing) {
    stopTranscription();
  } else {
    startTranscription({ playStartCue: true });
  }
});

clearButton.addEventListener("click", clearTranscript);

if (bridge.features.hotkeys) {
  hotkeyHint.hidden = false;
  bridge.onHotkey((action, payload) => {
    if (action === "start" && !isTranscribing && !isTranscriptionProcessing) {
      hotkeyReleasedTimestamp = null;
      startTranscription({
        typeResultAtCursor: true,
        captureId: payload?.captureId,
        playStartCue: true
      });
    }
    if (action === "configuration-needed" && !isTranscribing && !isTranscriptionProcessing) {
      void typeConfigurationWarning(payload?.message || payload);
    }
    if (action === "stop" && isTranscribing && !stopRequested) {
      hotkeyReleasedTimestamp = payload?.hotkeyReleasedAt || Date.now();
      void playHotkeySound(action);
      stopTranscription(hotkeyReleasedTimestamp);
    }
  });
  bridge.onActivityCanceled(() => {
    const hadActivity = isTranscribing || isTranscriptionProcessing || isTypingResponse || stopRequested;
    if (!hadActivity) return;
    activityGeneration += 1;
    resetTranscriptionState();
    isTranscriptionProcessing = false;
    isTypingResponse = false;
    recordedChunks = [];
    Object.values(hotkeySounds).forEach((sound) => {
      sound.pause();
      sound.currentTime = 0;
    });
    setStatus("Canceled.", "idle");
  });
  bridge.onHotkeyUpdated((hotkey) => {
    hotkeyHint.textContent = `Hold ${hotkey.label} to record. Double-tap to view the last response.`;
  });
  bridge.onSoundVolumeUpdated((soundVolume) => {
    hotkeySoundVolume = normalizeSoundVolume(soundVolume);
  });
  initializeDesktopHotkeyHint();
}

autoResizeTextarea(transcript);
autoResizeTextarea(instructionResponse);
renderRecordingSupport();
updateActionButtons();

// Both recording entry points share one capability check and one explanation.
// The page stays usable with recording turned off rather than hiding itself.
function renderRecordingSupport() {
  if (!recordingNotice) return;
  recordingNotice.hidden = recordingSupport.supported;
  if (!recordingSupport.supported) {
    recordingNotice.textContent = recordingSupport.message;
    setStatus("Recording is unavailable on this connection.", "error");
  }
}

async function startTranscription({
  typeResultAtCursor = false,
  captureId = "",
  playStartCue = false
} = {}) {
  const generation = activityGeneration;
  if (!recordingSupport.supported) {
    logClientError("recording", new Error(recordingSupport.message));
    setStatus(recordingSupport.message, "error", "recording");
    return;
  }

  isTranscribing = true;
  stopRequested = false;
  shouldTypeFinalResponse = typeResultAtCursor;
  captureIntentId = typeof captureId === "string" ? captureId : "";
  discardRecording = false;
  recordingStartedAt = 0;
  updateTranscribeButtonLabel();
  updateActionButtons();
  setStatus("Requesting microphone access…", "processing", "recording");

  try {
    transcriptionStream = await getMicrophoneStream();
    if (generation !== activityGeneration) {
      transcriptionStream?.getTracks().forEach((track) => track.stop());
      transcriptionStream = undefined;
      return;
    }
    if (stopRequested) {
      resetTranscriptionState({ stopRecorder: false });
      setStatus("Tap ignored. Hold the hotkey a little longer to record.", "idle");
      return;
    }
    if (playStartCue) {
      setStatus("Microphone ready…", "processing", "recording");
      await playHotkeySound("start");
      if (generation !== activityGeneration) return;
      if (stopRequested) {
        resetTranscriptionState({ stopRecorder: false });
        setStatus("Tap ignored. Hold the hotkey a little longer to record.", "idle");
        return;
      }
    }
    recordedChunks = [];
    mediaRecorder = createRecorder(transcriptionStream, recordingSupport.mimeType);
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordedChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", handleRecorderStop, { once: true });
    mediaRecorder.addEventListener("error", handleRecorderError, { once: true });
    mediaRecorder.start();
    recordingStartedAt = performance.now();
    setStatus("Recording… Release the hotkey or select Stop recording.", "recording", "recording");
  } catch (error) {
    if (generation !== activityGeneration) return;
    console.error(error);
    resetTranscriptionState();
    logClientError("recording", error);
    setStatus(error.message || "Could not start recording.", "error", "recording");
  }
}

async function getMicrophoneStream() {
  let requestExpired = false;
  let timeoutId;
  const streamRequest = navigator.mediaDevices.getUserMedia({ audio: true });
  streamRequest.then((stream) => {
    if (requestExpired) stream.getTracks().forEach((track) => track.stop());
  }).catch(() => {});
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      requestExpired = true;
      reject(new Error("The microphone did not respond. Check the selected input device and try again."));
    }, MICROPHONE_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([streamRequest, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function stopTranscription(releasedAt) {
  if (stopRequested) return;
  if (!hotkeyReleasedTimestamp) {
    hotkeyReleasedTimestamp = releasedAt || Date.now();
  }
  stopRequested = true;
  transcribeButton.disabled = true;
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    setStatus("Canceling short tap…", "processing");
    return;
  }
  discardRecording = isRecordingTooShort(recordingStartedAt, performance.now());
  setStatus("Finishing recording…", "processing", "recording");
  try {
    mediaRecorder.stop();
  } catch (error) {
    handleRecordingFailure(error);
  }
}

function handleRecorderStop() {
  if (discardRecording) {
    resetTranscriptionState({ stopRecorder: false });
    setStatus(
      `Tap ignored. Hold the hotkey for at least ${MINIMUM_RECORDING_DURATION_MS / 1000} seconds.`,
      "idle"
    );
    return;
  }
  void processTranscription();
}

function handleRecorderError(event) {
  handleRecordingFailure(event?.error || new Error("The audio recorder stopped unexpectedly."));
}

function handleRecordingFailure(error) {
  console.error(error);
  resetTranscriptionState();
  logClientError("recording", error);
  setStatus(error?.message || "Could not finish the recording.", "error", "recording");
}

async function processTranscription() {
  const generation = activityGeneration;
  const typeResultAtCursor = shouldTypeFinalResponse;
  const captureId = captureIntentId;
  const releasedAt = hotkeyReleasedTimestamp;
  hotkeyReleasedTimestamp = null;
  const audioType = mediaRecorder?.mimeType || "audio/webm";
  const audio = new File(recordedChunks, getAudioFileName(audioType), { type: audioType });
  releaseRecordingResources();
  isTranscribing = false;
  stopRequested = false;
  isTranscriptionProcessing = true;
  updateTranscribeButtonLabel();
  updateActionButtons();
  instructionResponse.value = "";
  autoResizeTextarea(instructionResponse);
  if (!audio.size) {
    isTranscriptionProcessing = false;
    shouldTypeFinalResponse = false;
    captureIntentId = "";
    recordedChunks = [];
    updateActionButtons();
    const error = new Error("No audio was captured. Hold the hotkey and try again.");
    logClientError("recording", error);
    setStatus(error.message, "error", "recording");
    return;
  }
  setStatus("Sending audio for transcription…", "processing", "transcription");

  const transcriptionRequestedAt = Date.now();
  const preTranscriptionMs = releasedAt ? Math.max(0, transcriptionRequestedAt - releasedAt) : null;
  const initialTiming = {
    hotkeyReleasedAt: releasedAt,
    preTranscriptionMs
  };

  let processStage = "transcription";
  try {
    const result = await bridge.transcribe({
      audio: await audio.arrayBuffer(),
      mimeType: audio.type,
      captureId,
      timing: initialTiming
    });
    if (generation !== activityGeneration) return;
    if (!result?.transcript) throw new Error("Could not transcribe the audio.");

    const timingForTyping = {
      ...(result.timing || initialTiming),
      responseCompletedAt: Date.now()
    };

    replaceTranscript(result.rawTranscript || result.transcript);
    if (!result.instructionApplied) {
      setStatus("Transcription complete; no instruction prefix detected.", "success", "transcription");
      if (typeResultAtCursor) {
        await typeFinalResponse(
          result.transcript,
          captureId,
          "transcription",
          false,
          result.logGroupId,
          timingForTyping
        );
      } else if (result.logGroupId && typeof bridge.updateLogTiming === "function") {
        const totalMs = (
          (timingForTyping.preTranscriptionMs || 0) +
          (timingForTyping.transcriptionMs || 0)
        );
        if (totalMs > 0) {
          void bridge.updateLogTiming({
            logGroupId: result.logGroupId,
            timing: { ...timingForTyping, totalMs }
          }).catch(() => {});
        }
      }
      return;
    }
    processStage = "instruction";
    instructionResponse.value = result.transcript;
    autoResizeTextarea(instructionResponse);
    setStatus("Transcription complete.", "success", "instruction");
    if (typeResultAtCursor) {
      await typeFinalResponse(
        instructionResponse.value,
        captureId,
        "transcription",
        result.webSearchUsed === true,
        result.logGroupId,
        timingForTyping
      );
    } else if (result.logGroupId && typeof bridge.updateLogTiming === "function") {
      const totalMs = (
        (timingForTyping.preTranscriptionMs || 0) +
        (timingForTyping.transcriptionMs || 0) +
        (timingForTyping.instructionPrepMs || 0) +
        (timingForTyping.instructionMs || 0)
      );
      if (totalMs > 0) {
        void bridge.updateLogTiming({
          logGroupId: result.logGroupId,
          timing: { ...timingForTyping, totalMs }
        }).catch(() => {});
      }
    }
  } catch (error) {
    if (generation !== activityGeneration || isCancellationError(error)) return;
    console.error(error);
    setStatus(error.message || "Could not transcribe the audio.", "error", processStage);
  } finally {
    if (generation !== activityGeneration) return;
    isTranscriptionProcessing = false;
    shouldTypeFinalResponse = false;
    captureIntentId = "";
    recordedChunks = [];
    updateActionButtons();
  }
}

function getAudioFileName(mimeType) {
  const type = mimeType.toLowerCase();
  const extension = type.includes("mp4")
    ? "mp4"
    : type.includes("mpeg")
      ? "mp3"
      : type.includes("ogg")
        ? "ogg"
        : type.includes("wav")
          ? "wav"
          : "webm";
  return "transcription." + extension;
}

function resetTranscriptionState({ stopRecorder = true } = {}) {
  const recorder = mediaRecorder;
  mediaRecorder = undefined;
  if (recorder) {
    recorder.removeEventListener("stop", handleRecorderStop);
    recorder.removeEventListener("error", handleRecorderError);
    if (stopRecorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch (error) {
        console.warn("Could not stop the audio recorder during cleanup:", error);
      }
    }
  }
  releaseRecordingResources();
  recordedChunks = [];
  isTranscribing = false;
  stopRequested = false;
  shouldTypeFinalResponse = false;
  captureIntentId = "";
  updateTranscribeButtonLabel();
  updateActionButtons();
}

function releaseRecordingResources() {
  transcriptionStream?.getTracks().forEach((track) => track.stop());
  transcriptionStream = undefined;
  mediaRecorder = undefined;
  recordingStartedAt = 0;
  discardRecording = false;
}

function updateTranscribeButtonLabel() {
  setButtonIcon(transcribeButton, isTranscribing ? "player-stop" : "microphone");
  setButtonLabel(transcribeButton, isTranscribing ? "Stop recording" : "Start recording");
  transcribeButton.setAttribute("aria-pressed", String(isTranscribing));
}

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

function replaceTranscript(text) {
  transcript.value = text;
  autoResizeTextarea(transcript);
}

function clearTranscript() {
  transcript.value = "";
  instructionResponse.value = "";
  autoResizeTextarea(transcript);
  autoResizeTextarea(instructionResponse);
  setStatus("Ready to record.", "idle");
}

function setStatus(message, state = "idle", stage = "") {
  status.textContent = message;
  status.dataset.state = state;
  // A failure in a request stage is almost always a credentials or model
  // problem, so offer the page that fixes it instead of ending on the message.
  if (state === "error" && (stage === "transcription" || stage === "instruction")) {
    const recovery = document.createElement("a");
    recovery.className = "status-recovery";
    recovery.href = "settings.html#provider";
    recovery.textContent = "Open Provider & models";
    status.append(recovery);
  }
  captureSignal.dataset.state = state;
  captureSignal.setAttribute("aria-label", state === "recording"
    ? "Recording in progress"
    : state === "processing"
      ? "Processing audio"
      : state === "error"
        ? "Action needs attention"
        : "System ready");
  bridge.setStatus?.({ message, state, stage });
}

function logClientError(stage, error, metadata = {}) {
  if (typeof bridge.logError !== "function") return;
  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message
    : String(error || "Unknown error.");
  void bridge.logError({ stage, message, ...metadata }).catch((logError) => {
    console.warn("Could not save client error log:", logError);
  });
}

async function initializeDesktopHotkeyHint() {
  try {
    const hotkey = await bridge.getHotkey();
    if (hotkey?.label) hotkeyHint.textContent = `Hold ${hotkey.label} to record. Double-tap to view the last response.`;
  } catch (error) {
    console.error(error);
  }
}

async function typeFinalResponse(
  text,
  captureId = "",
  purpose = "transcription",
  webSearchUsed = false,
  logGroupId = "",
  timing = null
) {
  // The website displays results in the page; it never types into other apps.
  if (!bridge.features.typing || !text) return;
  const generation = activityGeneration;
  isTypingResponse = true;
  try {
    await bridge.typeText({ text, captureId, purpose, webSearchUsed, logGroupId, timing });
  } catch (error) {
    if (generation !== activityGeneration || isCancellationError(error)) return;
    console.error(error);
    await playHotkeySound("failure");
    setStatus(error.message || "Response ready; could not type into the active app.", "error", "typing");
  } finally {
    isTypingResponse = false;
  }
}

async function typeConfigurationWarning(message) {
  const warningMessage = typeof message === "string" && message.trim()
    ? message
    : "Open Porvoz and finish setup in Provider & models before using the hotkey.";
  setStatus(warningMessage, "error");
  await typeFinalResponse(warningMessage, "", "configuration-warning");
}

function updateActionButtons() {
  const audioBusy = isTranscribing || isTranscriptionProcessing;
  clearButton.disabled = audioBusy;
  transcribeButton.disabled = isTranscriptionProcessing || !recordingSupport.supported;
}

function createHotkeySound(source) {
  const sound = new Audio(source);
  sound.preload = "auto";
  sound.volume = hotkeySoundVolume;
  return sound;
}

async function playHotkeySound(action) {
  const sound = hotkeySounds[action];
  if (!sound) return;
  sound.pause();
  sound.currentTime = 0;
  sound.volume = hotkeySoundVolume;
  try {
    await sound.play();
    const cueDuration = Number.isFinite(sound.duration) && sound.duration > 0
      ? Math.min(sound.duration * 1000, 1000)
      : 180;
    await wait(cueDuration);
  } catch {
    // Recording should still start when the optional cue cannot play.
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeSoundVolume(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.min(1, Math.max(0, numericValue)) : 0.3;
}

function isCancellationError(error) {
  return Boolean(error && (
    error.code === "ERR_CANCELED"
    || error.name === "AbortError"
    || error.name === "CanceledError"
    || /ERR_CANCELED|AbortError|CanceledError|cancel(?:ed|led) by user/i.test(error.message || "")
  ));
}
