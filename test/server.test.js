import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPorvozHttpServer } from "../server/http-server.js";
import { createServerStore } from "../server/store.js";
import { createBackendClient } from "../electron/backend-client.js";

const defaultsPath = fileURLToPath(new URL("../electron/defaults.json", import.meta.url));

test("the headless server supports admin CRUD and key-routed OpenAI transcription", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "porvoz-server-"));
  let transcript = "ordinary dictation";
  let responseRequestBody = "";
  const upstream = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      return json(response, 200, { data: [{ id: "transcribe-model" }, { id: "instruction-model" }] });
    }
    if (request.method === "POST" && request.url === "/v1/audio/transcriptions") {
      for await (const _chunk of request) { /* consume multipart input */ }
      return json(response, 200, { text: transcript });
    }
    if (request.method === "POST" && request.url === "/v1/responses") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      responseRequestBody = Buffer.concat(chunks).toString("utf8");
      return json(response, 200, { output_text: "clipboard result", output: [] });
    }
    json(response, 404, { error: { message: "not found" } });
  });
  await listen(upstream);
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

  const databasePath = path.join(directory, "porvoz.db");
  const store = await createServerStore({
    databasePath,
    defaultsPath,
    masterKey: "test-master-key"
  });
  const application = createPorvozHttpServer({
    store,
    adminKey: "test-admin-key",
    host: "127.0.0.1",
    port: 0
  });
  const address = await application.start();
  context.after(async () => {
    await application.close();
    await close(upstream);
    rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const adminHeaders = {
    authorization: "Bearer test-admin-key",
    "content-type": "application/json"
  };

  const unauthorized = await fetch(`${baseUrl}/v1/models`);
  assert.equal(unauthorized.status, 401);

  let runtime = await api(baseUrl, "/v1/porvoz/runtime", { headers: adminHeaders });
  assert.equal(Object.hasOwn(runtime, "prompt"), false);
  const profileId = runtime.activeProfileId;
  await api(baseUrl, `/v1/porvoz/profiles/${profileId}/connection`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ baseUrl: upstreamUrl, apiKey: "upstream-secret", verifyCertificate: true })
  });
  runtime = await api(baseUrl, `/v1/porvoz/profiles/${profileId}/models`, {
    method: "POST",
    headers: { authorization: "Bearer test-admin-key" }
  });
  assert.deepEqual(runtime.models.available, ["transcribe-model", "instruction-model"]);
  await api(baseUrl, `/v1/porvoz/profiles/${profileId}/models`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ transcription: "transcribe-model", instruction: "instruction-model" })
  });
  const inference = await api(baseUrl, `/v1/porvoz/profiles/${profileId}/inference-key`, {
    headers: { authorization: "Bearer test-admin-key" }
  });

  const models = await api(baseUrl, "/v1/models", {
    headers: { authorization: `Bearer ${inference.apiKey}` }
  });
  assert.equal(models.data.length, 1);
  assert.match(models.data[0].id, /Default .* transcribe-model .* instruction-model/);

  const ordinaryForm = new FormData();
  ordinaryForm.set("model", "this-value-is-deliberately-ignored");
  ordinaryForm.set("file", new Blob([Buffer.from("audio")], { type: "audio/wav" }), "test.wav");
  const ordinary = await api(baseUrl, "/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${inference.apiKey}` },
    body: ordinaryForm
  });
  assert.equal(ordinary.text, "ordinary dictation");
  assert.equal(ordinary.porvoz.instruction_applied, false);

  runtime = await api(baseUrl, "/v1/porvoz/prefixes", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      prefixes: [{
        id: "clipboard",
        name: "clipboard",
        instruction: "Use supplied clipboard context.",
        allowClipboard: true
      }]
    })
  });
  transcript = "clipboard summarize this";
  const instructedForm = new FormData();
  instructedForm.set("model", profileId);
  instructedForm.set("porvoz_context", JSON.stringify({
    clipboard: "desktop clipboard text"
  }));
  instructedForm.set("file", new Blob([Buffer.from("audio")], { type: "audio/wav" }), "test.wav");
  const instructed = await api(baseUrl, "/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: "Bearer test-admin-key" },
    body: instructedForm
  });
  assert.equal(instructed.text, "clipboard result");
  assert.equal(instructed.porvoz.raw_transcript, "clipboard summarize this");
  assert.equal(instructed.porvoz.instruction_applied, true);
  assert.equal(typeof instructed.porvoz.timing?.transcriptionMs, "number");
  assert.equal(typeof instructed.porvoz.timing?.instructionPrepMs, "number");
  assert.equal(typeof instructed.porvoz.timing?.instructionMs, "number");
  assert.match(responseRequestBody, /desktop clipboard text/);
  assert.match(responseRequestBody, /Spoken request after matched prefixes/);
  assert.doesNotMatch(responseRequestBody, /clipboard summarize this/);
  assert.equal(Object.hasOwn(runtime.prefixes[0], "allowSearch"), false);

  const desktopClient = createBackendClient({
    baseUrl,
    adminKey: "test-admin-key",
    getActiveProfileId: () => profileId,
    setActiveProfileId: () => {}
  });

  await desktopClient.updateLogTiming({
    logGroupId: instructed.porvoz.log_group_id,
    timing: { pasteMs: 42, totalMs: 500 }
  });
  const serverLogs = await desktopClient.getLogs();
  const matchedEntry = serverLogs.find((entry) => entry.groupId === instructed.porvoz.log_group_id);
  assert.equal(matchedEntry.timing?.pasteMs, 42);
  assert.equal(matchedEntry.timing?.totalMs, 500);
  transcript = "ordinary dictation with selected context";
  const desktopSelectedTextResult = await desktopClient.transcribe({
    audio: Buffer.from("audio"),
    mimeType: "audio/wav",
    selectedText: "selection sent by the desktop client"
  });
  assert.equal(desktopSelectedTextResult.instructionApplied, true);
  assert.match(responseRequestBody, /selection sent by the desktop client/);
  assert.match(responseRequestBody, /selection processor/);
  assert.doesNotMatch(responseRequestBody, /Use supplied clipboard context/);

  for (const clipboardText of ["x".repeat(300_001), "漢😀".repeat(100_000), "\u0000\n\"\\".repeat(100_000)]) {
    for (const withPrefix of [false, true]) {
      await context.test(`oversized clipboard (${clipboardText.codePointAt(0)}) with prefix=${withPrefix}`, async () => {
        transcript = withPrefix ? "clipboard summarize this" : "ordinary dictation";
        const result = await desktopClient.transcribe({
          audio: Buffer.from("audio"), mimeType: "audio/wav", clipboardText
        });
        assert.equal(result.transcript, withPrefix ? "clipboard result" : "ordinary dictation");
        assert.equal(result.instructionApplied, withPrefix);
        if (withPrefix) assert.match(responseRequestBody, /Clipboard context truncated/);
      });
    }
  }

  assert.equal(readFileSync(databasePath).includes(Buffer.from("upstream-secret")), false);
});

test("malformed and interrupted multipart uploads leave the server available", { timeout: 10_000 }, async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "porvoz-upload-"));
  const store = await createServerStore({
    databasePath: path.join(directory, "porvoz.db"), defaultsPath, masterKey: "test-master-key"
  });
  const limits = store.getLimits();
  store.getLimits = () => ({ ...limits, maxUploadBytes: 16 });
  const inferenceKey = store.getInferenceKey(store.getSettings().activeProfileId);
  const application = createPorvozHttpServer({ store, adminKey: "test-admin-key" });
  const address = await application.start();
  context.after(async () => {
    application.server.closeAllConnections();
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const fileHeader = '--upload-test\r\nContent-Disposition: form-data; name="file"; filename="test.wav"\r\n'
    + 'Content-Type: audio/wav\r\n\r\n';
  const headers = {
    authorization: `Bearer ${inferenceKey}`,
    "content-type": "multipart/form-data; boundary=upload-test"
  };
  const assertAvailable = async () => {
    const models = await api(baseUrl, "/v1/models", { headers });
    assert.equal(models.data.length, 1);
  };

  for (const route of ["/v1/audio/transcriptions", "/v1/porvoz/prefixes/from-audio"]) {
    await context.test(`missing closing boundary on ${route} returns HTTP 400`, async () => {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: { ...headers, authorization: route.includes("prefixes") ? "Bearer test-admin-key" : headers.authorization },
        body: fileHeader + "partial"
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error.message, /Unexpected end of form/);
      await assertAvailable();
    });
  }

  await context.test("oversized audio still returns HTTP 413", async () => {
    const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: "POST", headers, body: fileHeader + "x".repeat(32) + "\r\n--upload-test--\r\n"
    });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error.message, /too large/);
    await assertAvailable();
  });

  for (const body of ["--upload-test\r\nContent-Disposition:", fileHeader + "partial"]) {
    await context.test(`disconnect during ${body.includes("partial") ? "audio" : "headers"} closes the parser`, async () => {
      let client;
      const parserClosed = new Promise((resolve) => {
        application.server.prependOnceListener("request", (request) => {
          const pipe = request.pipe;
          request.pipe = function (destination, ...options) {
            destination.once("close", resolve);
            return pipe.call(this, destination, ...options);
          };
          // Disconnect only after the server has actually received the partial body.
          request.once("data", () => client.destroy());
        });
      });
      client = http.request(`${baseUrl}/v1/audio/transcriptions`, { method: "POST", headers });
      client.on("error", () => {}); // The client deliberately resets its own connection.
      client.write(body);
      await parserClosed;
      await assertAvailable();
    });
  }
});

test("provider credentials and inference keys persist without storing provider plaintext", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "porvoz-store-"));
  const databasePath = path.join(directory, "porvoz.db");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const first = await createServerStore({ databasePath, defaultsPath, masterKey: "correct-master-key" });
  const profileId = first.getSettings().activeProfileId;
  first.saveConnection({
    profileId,
    baseUrl: "https://provider.example.com",
    apiKey: "provider-plaintext-value"
  });
  const inferenceKey = first.getInferenceKey(profileId);
  first.close();

  assert.equal(readFileSync(databasePath).includes(Buffer.from("provider-plaintext-value")), false);
  const reopened = await createServerStore({ databasePath, defaultsPath, masterKey: "correct-master-key" });
  assert.equal(reopened.getApiKey(profileId), "provider-plaintext-value");
  assert.equal(reopened.getInferenceKey(profileId), inferenceKey);
  reopened.close();

  const wrongKey = await createServerStore({ databasePath, defaultsPath, masterKey: "wrong-master-key" });
  assert.throws(() => wrongKey.getApiKey(profileId), /could not be decrypted/);
  wrongKey.close();
});

test("first-party capture routes transcription and instructions to separate providers", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "porvoz-routing-"));
  const requests = [];
  const speech = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ stage: "speech", url: request.url, key: request.headers.authorization,
      body: Buffer.concat(chunks).toString("utf8") });
    if (request.url === "/v1/models") return json(response, 200, { data: [{ id: "speech-only" }] });
    if (request.url === "/v1/audio/transcriptions") return json(response, 200, { text: "tidy this text" });
    json(response, 404, { error: { message: "speech provider cannot process instructions" } });
  });
  const instructions = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({ stage: "instructions", url: request.url, key: request.headers.authorization, body });
    if (request.url === "/v1/models") return json(response, 200, { data: [{ id: "instructions-only" }] });
    if (request.url === "/v1/responses") {
      const payload = JSON.parse(body);
      return json(response, 200, { output_text: payload.instructions.startsWith("You design")
        ? JSON.stringify({ name: "polish", instruction: "Polish the supplied text." })
        : "Tidied text." });
    }
    json(response, 404, { error: { message: "instruction provider cannot transcribe" } });
  });
  await listen(speech);
  await listen(instructions);
  const store = await createServerStore({ databasePath: path.join(directory, "porvoz.db"), defaultsPath, masterKey: "routing-master" });
  const application = createPorvozHttpServer({ store, adminKey: "routing-admin" });
  const address = await application.start();
  context.after(async () => {
    await application.close();
    await close(speech);
    await close(instructions);
    rmSync(directory, { recursive: true, force: true });
  });
  let selectedProfile = "";
  const client = createBackendClient({
    baseUrl: `http://127.0.0.1:${address.port}`, adminKey: "routing-admin",
    getActiveProfileId: () => selectedProfile, setActiveProfileId: (id) => { selectedProfile = id; }
  });
  const speechId = (await client.getRuntimeConfig()).activeProfileId;
  await client.saveConnection({ baseUrl: `http://127.0.0.1:${speech.address().port}/v1`, apiKey: "speech-key" });
  await client.saveModelSelections({ transcription: "speech-only" });
  const instructionId = (await client.createProfile({ name: "Instructions" })).activeProfileId;
  await client.saveConnection({ baseUrl: `http://127.0.0.1:${instructions.address().port}/v1`, apiKey: "instruction-key" });
  await client.saveModelSelections({ instruction: "instructions-only", instructionReasoning: "high", searchTool: "openrouter" });
  await client.saveRouting({ transcription: speechId, instruction: instructionId });
  await client.savePrefixSettings({ prefixes: [{ id: "tidy", name: "tidy", instruction: "Tidy the supplied text." }] });
  // Editing an unconfigured third provider must not affect readiness or capture.
  const editorId = (await client.createProfile({ name: "Unconfigured" })).activeProfileId;
  assert.equal((await client.getSetupStatus()).ready, true);
  await client.populateModels({ profileId: speechId });
  await client.populateModels({ profileId: instructionId });
  const runtime = await client.getRuntimeConfig();
  assert.equal(runtime.activeProfileId, editorId);
  assert.deepEqual(runtime.routing.transcription.available, ["speech-only"]);
  assert.deepEqual(runtime.routing.instruction.available, ["instructions-only"]);
  assert.equal(runtime.routing.instruction.searchTool, "openrouter");
  for (const value of [null, [], { transcription: "missing" }]) {
    await assert.rejects(() => api(`http://127.0.0.1:${address.port}`, "/v1/porvoz/routing", {
      method: "PUT", headers: { authorization: "Bearer routing-admin", "content-type": "application/json" },
      body: JSON.stringify(value)
    }), { status: 400 });
  }
  const result = await client.transcribe({ audio: Buffer.from("audio"), mimeType: "audio/wav" });
  assert.equal(result.rawTranscript, "tidy this text");
  assert.equal(result.transcript, "Tidied text.");
  assert.equal(result.instructionApplied, true);
  const proposal = await client.createPrefixFromVoice({ audio: Buffer.from("audio"), mimeType: "audio/wav" });
  assert.equal(proposal.prefix.name, "polish");
  const transcriptionRequests = requests.filter(({ url }) => url === "/v1/audio/transcriptions");
  assert.equal(transcriptionRequests.length, 2);
  for (const request of transcriptionRequests) {
    assert.equal(request.stage, "speech");
    assert.equal(request.key, "Bearer speech-key");
    assert.match(request.body, /speech-only/);
  }
  const instructionRequests = requests.filter(({ url }) => url === "/v1/responses");
  assert.equal(instructionRequests.length, 2);
  for (const request of instructionRequests) {
    assert.equal(request.stage, "instructions");
    assert.equal(request.key, "Bearer instruction-key");
    const payload = JSON.parse(request.body);
    assert.equal(payload.model, "instructions-only");
    assert.equal(payload.reasoning.effort, "high");
    assert.equal(payload.tools[0].type, "openrouter:web_search");
  }
});

test("routing migrates the active provider, persists, and repairs deleted providers", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "porvoz-routing-store-"));
  const options = { databasePath: path.join(directory, "porvoz.db"), defaultsPath, masterKey: "routing-master" };
  let store = await createServerStore(options);
  context.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const firstId = store.getSettings().activeProfileId;
  const secondId = store.addProfile({ name: "Second" }).id;
  // Simulate settings saved before routing existed.
  const legacy = store.getSettings();
  delete legacy.routing;
  store.getDatabase().prepare("UPDATE state SET settings_json = ? WHERE id = ?").run(JSON.stringify(legacy), 1);
  store.close();
  store = await createServerStore(options);
  assert.deepEqual(store.getSettings().routing, { transcription: secondId, instruction: secondId });
  store.saveRouting({ transcription: firstId });
  store.setActiveProfile({ id: firstId });
  const expected = { transcription: firstId, instruction: secondId };
  assert.deepEqual(store.getSettings().routing, expected);
  assert.throws(() => store.saveRouting({ transcription: secondId, instruction: "missing" }), /existing provider/);
  assert.deepEqual(store.getSettings().routing, expected, "invalid updates are atomic");
  store.close();
  store = await createServerStore(options);
  assert.deepEqual(store.getSettings().routing, expected);
  const thirdId = store.addProfile({ name: "Third" }).id;
  assert.deepEqual(store.getSettings().routing, expected, "adding a provider does not route requests to it");
  store.deleteProfile({ id: thirdId });
  assert.deepEqual(store.getSettings().routing, expected, "deleting an unused provider preserves routing");
  store.deleteProfile({ id: secondId });
  assert.deepEqual(store.getSettings().routing, { transcription: firstId, instruction: firstId });
  store.resetToDefaults();
  const resetId = store.getSettings().activeProfileId;
  assert.deepEqual(store.getSettings().routing, { transcription: resetId, instruction: resetId });
});

async function api(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.error?.message), { status: response.status });
  return body;
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body);
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
