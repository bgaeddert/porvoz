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

  await api(baseUrl, "/v1/porvoz/prefixes", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      prefixes: [{
        id: "clipboard",
        name: "clipboard",
        instruction: "Use supplied clipboard context.",
        allowSearch: false,
        allowClipboard: true
      }]
    })
  });
  transcript = "clipboard summarize this";
  const instructedForm = new FormData();
  instructedForm.set("model", profileId);
  instructedForm.set("porvoz_context", JSON.stringify({ clipboard: "desktop clipboard text" }));
  instructedForm.set("file", new Blob([Buffer.from("audio")], { type: "audio/wav" }), "test.wav");
  const instructed = await api(baseUrl, "/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: "Bearer test-admin-key" },
    body: instructedForm
  });
  assert.equal(instructed.text, "clipboard result");
  assert.equal(instructed.porvoz.raw_transcript, "clipboard summarize this");
  assert.equal(instructed.porvoz.instruction_applied, true);
  assert.match(responseRequestBody, /desktop clipboard text/);

  const desktopClient = createBackendClient({
    baseUrl,
    adminKey: "test-admin-key",
    getActiveProfileId: () => profileId,
    setActiveProfileId: () => {}
  });
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
