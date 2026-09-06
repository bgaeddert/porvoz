// Run with Electron, then POST { expected: "..." } to the printed localhost
// control URL while the disposable editor selection is focused. No real audio,
// credentials, or cloud service is used. The production Windows copy, main IPC
// handler, backend client, HTTP server, and instruction routing are exercised.
import { app, clipboard } from "electron";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readSelectedTextFromClipboard, captureTextInputTarget, disposeTextInput } from "../electron/text-input.js";
import { createSelectedTextReader } from "../electron/selected-text.js";
import { createBackendClient } from "../electron/backend-client.js";
import { createServerStore } from "../server/store.js";
import { createPorvozHttpServer } from "../server/http-server.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const statePath = process.env.PORVOZ_SELECTION_TEST_STATE;
const listen = async (server) => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const json = (res, body, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
async function clipboardFingerprint() {
  const hash = createHash("sha256");
  for (const item of await clipboard.read()) {
    for (const type of [...item.types].sort()) {
      const data = await item.getType(type);
      hash.update(type);
      hash.update(data?.arrayBuffer ? Buffer.from(await data.arrayBuffer()) : JSON.stringify(data));
    }
  }
  return hash.digest("hex");
}

app.whenReady().then(async () => {
  assert.equal(process.platform, "win32");
  const directory = mkdtempSync(path.join(tmpdir(), "porvoz-windows-selection-"));
  let instructionRequest;
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url === "/v1/models") return json(res, { data: [{ id: "transcription-test" }, { id: "instruction-test" }] });
    if (req.url === "/v1/audio/transcriptions") return json(res, { text: "rewrite this clearly" });
    if (req.url === "/v1/responses") {
      instructionRequest = JSON.parse(Buffer.concat(chunks));
      return json(res, { output_text: "Test instruction response", output: [] });
    }
    json(res, { error: { message: "Unexpected fixture request" } }, 404);
  });
  const upstreamUrl = await listen(upstream);
  const store = await createServerStore({
    databasePath: path.join(directory, "fixture.db"),
    defaultsPath: path.join(root, "electron/defaults.json"), masterKey: "fixture-master-key"
  });
  const backend = createPorvozHttpServer({ store, adminKey: "fixture-admin-key" });
  const address = await backend.start();
  let profileId = "";
  const client = createBackendClient({
    baseUrl: `http://127.0.0.1:${address.port}`, adminKey: "fixture-admin-key",
    getActiveProfileId: () => profileId, setActiveProfileId: (id) => { profileId = id; }
  });
  await client.getRuntimeConfig();
  await client.saveConnection({ baseUrl: upstreamUrl, apiKey: "fixture-upstream-key" });
  await client.populateModels();
  await client.saveModelSelections({ transcription: "transcription-test", instruction: "instruction-test" });
  const reader = createSelectedTextReader({ readSelection: readSelectedTextFromClipboard });
  let attempt, handler;
  const context = vm.createContext({
    ipcMain: { handle: (_name, callback) => { handler = callback; } },
    runActiveOperation: callback => callback(new AbortController().signal),
    setOverlayStatus() {}, notifyLogsUpdated() {},
    getCaptureAttempt: () => attempt, selectedTextReader: reader,
    clipboard, appService: client, isCancellationError: () => false
  });
  const main = readFileSync(path.join(root, "electron/main.js"), "utf8");
  vm.runInContext(main.slice(main.indexOf('  ipcMain.handle("porvoz:transcribe"'),
    main.indexOf('  ipcMain.handle("porvoz:create-prefix-from-voice"')), context);
  const token = randomUUID();
  const control = createServer(async (req, res) => {
    if (req.headers.authorization !== token) return json(res, { error: "unauthorized" }, 403);
    if (req.url === "/stop") {
      await backend.close();
      upstream.close();
      disposeTextInput();
      rmSync(directory, { recursive: true, force: true });
      json(res, { stopped: true });
      control.close(() => app.quit());
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const { expected } = JSON.parse(Buffer.concat(chunks));
      assert.equal(typeof expected, "string");
      const before = await clipboardFingerprint();
      const target = captureTextInputTarget();
      assert.ok(target, "An external editor must have focus");
      attempt = { selectedTextPromise: reader.read({ target }) };
      const selected = await attempt.selectedTextPromise;
      assert.equal(selected, expected, "Windows clipboard capture");
      assert.equal(await clipboardFingerprint(), before, "Clipboard formats and bytes restored");
      instructionRequest = undefined;
      const result = await handler({}, { captureId: "fixture", audio: Buffer.from("fixture-audio"), mimeType: "audio/wav" });
      assert.equal(result.instructionApplied, Boolean(expected));
      if (expected) {
        assert.ok(instructionRequest.input.includes(expected), "Exact captured selection reaches the instruction request");
        assert.match(instructionRequest.instructions, /selection processor/);
        assert.doesNotMatch(instructionRequest.instructions, /Matched prefix instructions/);
      } else {
        assert.equal(instructionRequest, undefined, "No selected-text instruction request without a selection");
      }
      json(res, { passed: true, selectedCharacters: selected.length, clipboardRestored: true,
        selectionDelivered: Boolean(expected), instructionApplied: result.instructionApplied });
    } catch (error) {
      console.error(error.message);
      json(res, { passed: false, error: error.message }, 500);
    }
  });
  const url = await listen(control);
  writeFileSync(statePath, JSON.stringify({ url, token }));
  console.log("Windows selection integration fixture ready");
}).catch(error => { console.error(error); app.exit(1); });
