export function formatSignificantTotal(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const sec = ms / 1000;
  if (sec >= 100) return `${Math.round(sec)}s`;
  return `${sec.toPrecision(2)}s`;
}

export function resolveTotalMs(timing) {
  if (!timing || typeof timing !== "object") return null;
  const stageSum = (
    (timing.preTranscriptionMs || 0) +
    (timing.transcriptionMs || 0) +
    (timing.instructionPrepMs || 0) +
    (timing.instructionMs || 0) +
    (timing.pasteMs || 0)
  );
  if (Number.isFinite(timing.totalMs) && timing.totalMs > 0) return Math.round(timing.totalMs);
  if (
    Number.isFinite(timing.hotkeyReleasedAt)
    && Number.isFinite(timing.textPastedAt)
    && timing.textPastedAt > timing.hotkeyReleasedAt
  ) {
    return Math.round(timing.textPastedAt - timing.hotkeyReleasedAt);
  }
  if (stageSum > 0) return Math.round(stageSum);
  return null;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
