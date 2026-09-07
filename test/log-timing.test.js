import assert from "node:assert/strict";
import test from "node:test";
import { formatSignificantTotal, resolveTotalMs, formatDuration } from "../public/log-timing.js";

test("formatSignificantTotal formats durations to two significant digits in seconds", () => {
  assert.equal(formatSignificantTotal(null), "");
  assert.equal(formatSignificantTotal(undefined), "");
  assert.equal(formatSignificantTotal(0), "");
  assert.equal(formatSignificantTotal(-100), "");

  // Sub-second
  assert.equal(formatSignificantTotal(45), "0.045s");
  assert.equal(formatSignificantTotal(120), "0.12s");
  assert.equal(formatSignificantTotal(850), "0.85s");

  // 1s - 9.9s
  assert.equal(formatSignificantTotal(1000), "1.0s");
  assert.equal(formatSignificantTotal(1420), "1.4s");
  assert.equal(formatSignificantTotal(1831), "1.8s");
  assert.equal(formatSignificantTotal(2503), "2.5s");
  assert.equal(formatSignificantTotal(6153), "6.2s");

  // 10s - 99s
  assert.equal(formatSignificantTotal(9990), "10s");
  assert.equal(formatSignificantTotal(10000), "10s");
  assert.equal(formatSignificantTotal(12300), "12s");
  assert.equal(formatSignificantTotal(25000), "25s");

  // >= 100s
  assert.equal(formatSignificantTotal(105000), "105s");
  assert.equal(formatSignificantTotal(120000), "120s");
});

test("resolveTotalMs computes total time with fallback to stage sum and never returns 0", () => {
  assert.equal(resolveTotalMs(null), null);
  assert.equal(resolveTotalMs({}), null);

  // Explicit positive totalMs
  assert.equal(resolveTotalMs({ totalMs: 2503 }), 2503);

  // Explicit 0 totalMs should fall back to stage sum
  assert.equal(resolveTotalMs({
    totalMs: 0,
    preTranscriptionMs: 50,
    transcriptionMs: 1200,
    pasteMs: 300
  }), 1550);

  // Timestamps difference
  assert.equal(resolveTotalMs({
    hotkeyReleasedAt: 1000,
    textPastedAt: 3500
  }), 2500);

  // Timestamps where textPastedAt <= hotkeyReleasedAt falls back to stage sum
  assert.equal(resolveTotalMs({
    hotkeyReleasedAt: 3500,
    textPastedAt: 3500,
    preTranscriptionMs: 100,
    transcriptionMs: 1500
  }), 1600);

  // Only intermediate stages recorded (e.g. paste not performed or in progress)
  assert.equal(resolveTotalMs({
    preTranscriptionMs: 517,
    transcriptionMs: 1437
  }), 1954);

  assert.equal(resolveTotalMs({
    preTranscriptionMs: 495,
    transcriptionMs: 1370,
    instructionPrepMs: 20,
    instructionMs: 6850
  }), 8735);
});

test("formatDuration formats milliseconds below 1000 and seconds with two decimals above", () => {
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(33), "33ms");
  assert.equal(formatDuration(629), "629ms");
  assert.equal(formatDuration(1831), "1.83s");
  assert.equal(formatDuration(2503), "2.50s");
});
