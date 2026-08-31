import assert from "node:assert/strict";
import test from "node:test";
import { MINIMUM_RECORDING_DURATION_MS, isRecordingTooShort } from "../public/capture-policy.js";

test("rapid hotkey taps are discarded before transcription", () => {
  assert.equal(isRecordingTooShort(1000, 1000 + MINIMUM_RECORDING_DURATION_MS - 1), true);
});

test("recordings at or beyond the minimum duration are processed", () => {
  assert.equal(isRecordingTooShort(1000, 1000 + MINIMUM_RECORDING_DURATION_MS), false);
  assert.equal(isRecordingTooShort(1000, 2000), false);
});

test("invalid recorder timestamps fail closed", () => {
  assert.equal(isRecordingTooShort(0, 1000), true);
  assert.equal(isRecordingTooShort(2000, 1000), true);
});
