// One capability check shared by Capture and voice prefix creation, so both
// entry points enable, disable, and explain themselves the same way.

const PREFERRED_RECORDING_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4"
];

export function getRecordingSupport() {
  if (!window.isSecureContext) {
    return unavailable(
      "insecure-context",
      "Recording needs a secure connection. Open this site over HTTPS, or reach it at localhost, then try again."
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return unavailable(
      "no-media-devices",
      "This browser does not offer microphone access to the page. Try a current desktop browser."
    );
  }
  if (typeof window.MediaRecorder !== "function") {
    return unavailable(
      "no-recorder",
      "This browser cannot record audio. Try a current desktop browser."
    );
  }
  const mimeType = pickRecordingType();
  if (mimeType === null) {
    return unavailable(
      "no-format",
      "This browser does not support a recording format Porvoz can send. Try a current desktop browser."
    );
  }
  return { supported: true, reason: "", message: "", mimeType };
}

// An empty string asks MediaRecorder for its own default, which is correct when
// the browser has no isTypeSupported to consult.
function pickRecordingType() {
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  const supported = PREFERRED_RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  return supported === undefined ? null : supported;
}

export function createRecorder(stream, mimeType) {
  return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
}

function unavailable(reason, message) {
  return { supported: false, reason, message, mimeType: "" };
}
