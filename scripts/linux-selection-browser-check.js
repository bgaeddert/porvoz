import { app } from "electron";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { captureTextInputTarget, readSelectedTextFromClipboard, typeText, disposeTextInput } from "../electron/text-input.js";
const execute = promisify(execFile);
app.whenReady().then(async () => {
  const target = captureTextInputTarget();
  const title = async () => (await execute("xdotool", ["getwindowname", String(target)])).stdout.trim();
  assert.match(await title(), /^Porvoz Chrome selection fixture/);
  // Chrome does not publish a script-only setSelectionRange to PRIMARY.
  await execute("xdotool", ["key", "Home", ...Array(7).fill("Right"), ...Array(8).fill("shift+Right")]);
  assert.equal(await readSelectedTextFromClipboard({ target }), "ORIGINAL");
  await typeText("REPLACED café 日本語", { target });
  assert.match(await title(), /^Porvoz Chrome selection fixture PASS/);
  assert.equal(await readSelectedTextFromClipboard({ target }), "");
  console.log("PASS Chrome selection capture, exact replacement, and no-selection");
  disposeTextInput();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
