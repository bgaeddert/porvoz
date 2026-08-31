export const MINIMUM_RECORDING_DURATION_MS = 300;

export function isRecordingTooShort(startedAt, stoppedAt, minimumDuration = MINIMUM_RECORDING_DURATION_MS) {
  if (!Number.isFinite(startedAt) || startedAt <= 0) return true;
  if (!Number.isFinite(stoppedAt) || stoppedAt < startedAt) return true;
  return stoppedAt - startedAt < minimumDuration;
}
