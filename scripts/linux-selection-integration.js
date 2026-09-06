// Run with Electron in an X11 session against the disposable Gedit fixture.
// See docs/linux-selection-testing.md. This imports the production input path.
import assert from "node:assert/strict";
import { app, clipboard, ClipboardItem } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { captureTextInputTarget, readSelectedTextFromClipboard, typeText, disposeTextInput } from "../electron/text-input.js";
const execute = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixture = async (action) => JSON.parse((await execute("python3", [
  fileURLToPath(new URL("./linux-selection-fixture.py", import.meta.url)), action
], { timeout: 5000 })).stdout);

app.whenReady().then(async () => {
  const original = "fixture clipboard — preserved";
  // Seed the fixture before selecting. Portable writes are deliberately used
  // here so this catches regressions back to Chromium's PRIMARY-clobbering path.
  await clipboard.write([new ClipboardItem({"text/plain": original, "text/html": "<b>fixture clipboard — preserved</b>"})]);
  await delay(250);
  const cases = process.argv.includes("--modifier-only") ? []
    : [[], ["Control_R"], ["Alt_L"], ["Shift_L"], ["Control_L", "Super_L"], ["Control_L", "Alt_L", "Shift_L", "Super_L"]];
  for (const modifiers of cases) {
    await fixture("reset");
    await delay(1200);
    // Seed after CopyQ's optional PRIMARY -> CLIPBOARD synchronization settles.
    await clipboard.write([new ClipboardItem({
      'electron application/osclipboard;format="text/plain"': new Blob([original]),
      'electron application/osclipboard;format="UTF8_STRING"': new Blob([original]),
      'electron application/osclipboard;format="text/html"': new Blob(["<b>fixture clipboard — preserved</b>"]),
      'application/x-copyq-owner': new Blob(['porvoz-fixture'])
    })]);
    await delay(250);
    const target = captureTextInputTarget();
    assert.match((await execute("xdotool", ["getwindowname", String(target)])).stdout, /porvoz-selection-fixture\.txt/);
    if (modifiers.length) await execute("xdotool", ["keydown", ...modifiers]);
    let capture;
    try {
      capture = readSelectedTextFromClipboard({ target });
      capture.catch(() => {});
      if (modifiers.length) await delay(150);
      if (modifiers.length) assert.equal(await clipboard.readText(), original);
    } finally {
      if (modifiers.length) await execute("xdotool", ["keyup", ...modifiers.slice().reverse()]);
    }
    assert.equal(await capture, "ORIGINAL");
    assert.equal((await fixture("read")).selections, 1);
    assert.equal(await clipboard.readText(), original);
    await typeText("REPLACED café 日本語", { target });
    assert.equal((await fixture("read")).text, "Before REPLACED café 日本語 after");
    assert.equal(await clipboard.readText(), original);
    const html = await execute('xclip', ['-selection', 'clipboard', '-t', 'text/html', '-o'], {timeout:2000});
    assert.equal(html.stdout, "<b>fixture clipboard — preserved</b>");
    assert.equal(await readSelectedTextFromClipboard({ target }), "");
    console.log(`PASS capture, replacement, no-selection, rich clipboard restore: ${modifiers.join("+") || "no modifiers"}`);
  }
  // Verify paste waits for modifier release rather than sending Ctrl+Alt+V.
  await fixture("reset");
  const target = captureTextInputTarget();
  await execute("xdotool", ["keydown", "Alt_L"]);
  try {
    let completed = false;
    const paste = typeText("WAITED", { target });
    paste.then(() => { completed = true; }, () => { completed = true; });
    await delay(150);
    assert.equal(completed, false);
    await execute("xdotool", ["keyup", "Alt_L"]);
    await paste;
    assert.equal((await fixture("read")).text, "Before WAITED after");
    console.log("PASS paste waits for held modifier");
  } finally {
    await execute("xdotool", ["keyup", "Alt_L"]);
  }
  disposeTextInput();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
