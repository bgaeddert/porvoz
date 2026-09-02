import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createAppService } from "../electron/app-service.js";

const limits = {
  maxUploadBytes: 1024,
  maxTranscriptCharacters: 1000,
  maxClipboardCharacters: 1000,
  maxInstructionPromptCharacters: 100,
  maxPrefixes: 5,
  maxPrefixNameCharacters: 12,
  maxPrefixInstructionCharacters: 40,
  maxPrefixTotalCharacters: 80
};

test("connection URLs reject ambiguous or credential-bearing values", () => {
  const { service } = createService();

  assert.throws(() => service.saveConnection({ baseUrl: "https://example.com/v1?tenant=a" }), /valid HTTP or HTTPS/);
  assert.throws(() => service.saveConnection({ baseUrl: "https://user:secret@example.com/v1" }), /valid HTTP or HTTPS/);
  assert.throws(() => service.saveConnection({ baseUrl: "file:///tmp/api" }), /valid HTTP or HTTPS/);
});

test("connection URLs are normalized before being saved", () => {
  const { service, settingsStore } = createService();

  service.saveConnection({ baseUrl: "  https://example.com/api/v1///  ", apiKey: "secret", verifyCertificate: true });

  assert.equal(settingsStore.getSettings().connection.baseUrl, "https://example.com/api/v1");
  assert.equal(service.getConnectionSettings().apiKeyConfigured, true);
});

test("saving a connection with an empty API key preserves the existing key", () => {
  const { service, settingsStore } = createService();

  service.saveConnection({ baseUrl: "https://example.com/v1", apiKey: "secret" });
  service.saveConnection({ baseUrl: "https://example.com/v1", apiKey: "" });

  assert.equal(settingsStore.getApiKey(), "secret");
  assert.equal(service.getConnectionSettings().apiKeyConfigured, true);
});

test("prefix saves reject incomplete and duplicate definitions", () => {
  const { service } = createService();

  assert.throws(() => service.savePrefixes([
    prefix("digits", "Return digits."),
    prefix("unfinished", "")
  ]), /needs a name and an instruction/);

  assert.throws(() => service.savePrefixes([
    prefix("digits", "Return digits."),
    prefix("DIGITS", "Return more digits.")
  ]), /already in use/);
});

test("prefix saves trim valid values and enforce field limits", () => {
  const { service, settingsStore } = createService();

  service.savePrefixes([prefix("  digits  ", "  Return digits.  ")]);
  assert.equal(settingsStore.getSettings().prefixes[0].name, "digits");
  assert.equal(settingsStore.getSettings().prefixes[0].instruction, "Return digits.");

  assert.throws(() => service.savePrefixes([prefix("a-name-that-is-too-long", "Do it.")]), /up to 12 characters/);
});

test("sound volume is clamped and persisted as a normalized value", () => {
  const { service, settingsStore } = createService();

  assert.equal(service.saveSoundVolume(1.5), 1);
  assert.equal(settingsStore.getSettings().soundVolume, 1);
  assert.equal(service.saveSoundVolume(-0.25), 0);
  assert.throws(() => service.saveSoundVolume("loud"), /must be a number/);
});

test("prompt reset restores the packaged instruction prompt", () => {
  const { service, settingsStore } = createService();

  service.savePrompt("A custom prompt.");
  assert.equal(service.resetPrompt(), "Keep answers concise.");
  assert.equal(settingsStore.getSettings().prompt, "Keep answers concise.");
});

test("setup status names missing credentials and model selections", () => {
  const { service } = createService();

  const status = service.getSetupStatus();

  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, ["API base URL", "API key", "transcription model", "instruction model"]);
  assert.match(status.warningMessage, /Open Settings/);
  assert.match(status.hotkeyMessage, /before using the hotkey/);
});

test("setup status is ready when credentials and both models are selected", () => {
  const { service } = createService({ availableModels: ["transcription-model", "instruction-model"] });

  service.saveConnection({ baseUrl: "https://example.com/v1", apiKey: "secret" });
  service.saveModelSelections({ transcription: "transcription-model", instruction: "instruction-model" });

  assert.deepEqual(service.getSetupStatus(), {
    ready: true,
    missing: [],
    warningMessage: "",
    hotkeyMessage: ""
  });
});

test("a transcript without a prefix bypasses the instruction endpoint", async () => {
  const { service } = createService({ prefixes: [prefix("digits", "Return digits.")] });

  const result = await service.instruct({ transcript: "ordinary dictated text" });

  assert.deepEqual(result, { transcript: "ordinary dictated text", instructionApplied: false });
});

test("transcription failures retain the provider error in the error log", async () => {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({
        error: { message: "No endpoints available matching your data policy.", code: 404 }
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { service, logs } = createService({ availableModels: ["transcription-model"] });
    const address = server.address();
    service.saveConnection({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "secret" });
    service.saveModelSelections({ transcription: "transcription-model" });

    await assert.rejects(
      service.transcribe({ audio: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" }),
      /transcription endpoint could not process/
    );

    assert.equal(logs[0].type, "error");
    assert.equal(logs[0].stage, "transcription");
    assert.equal(logs[0].status, 404);
    assert.equal(logs[0].model, "transcription-model");
    assert.match(logs[0].text, /No endpoints available matching your data policy/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("invalid transcription input returns its validation error and logs it", async () => {
  const { service, logs } = createService();

  await assert.rejects(
    service.transcribe(),
    /Enter the base URL and API key in Settings/
  );

  assert.equal(logs[0].type, "error");
  assert.equal(logs[0].stage, "transcription");
  assert.equal(logs[0].bytes, 0);
});

test("chained prefixes are detected together and combine access permissions", async () => {
  let requestBody;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ output_text: "combined result" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { service } = createService({
      prefixes: [
        prefix("search", "Find the answer.", { allowSearch: true }),
        prefix("clipboard", "Use the reference.", { allowClipboard: true })
      ],
      availableModels: ["instruction-model"]
    });
    const address = server.address();
    service.saveConnection({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "secret" });
    service.saveModelSelections({ instruction: "instruction-model", instructionReasoning: "high" });

    const result = await service.instruct(
      { transcript: "search clipboard summarize this", logGroupId: "chain-1" },
      { readClipboard: () => "reference text" }
    );

    assert.deepEqual(result, { transcript: "combined result", instructionApplied: true });
    assert.match(requestBody.instructions, /chain of consecutive enabled registered instruction prefixes/);
    assert.match(requestBody.instructions, /apply every matched prefix instruction in left-to-right order/);
    assert.match(requestBody.input, /reference text/);
    assert.deepEqual(requestBody.reasoning, { effort: "high" });
    assert.deepEqual(requestBody.tools, [{ type: "web_search" }]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("voice prefix creation transcribes the brief and returns an editable proposal", async () => {
  let responsesRequestBody = "";
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === "/v1/audio/transcriptions") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ text: "Call this tidy and rewrite the next message to be concise." }));
        return;
      }
      if (request.url === "/v1/responses") {
        responsesRequestBody = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          output_text: "```json\n{\"name\":\"tidy\",\"instruction\":\"Rewrite next message concisely.\"}\n```"
        }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { service } = createService({
      prefixes: [prefix("digits", "Return digits.")],
      availableModels: ["transcription-model", "instruction-model"]
    });
    const address = server.address();
    service.saveConnection({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "secret" });
    service.saveModelSelections({ transcription: "transcription-model", instruction: "instruction-model" });

    const result = await service.createPrefixFromVoice({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: "audio/webm"
    });

    assert.equal(result.transcript, "Call this tidy and rewrite the next message to be concise.");
    assert.deepEqual(result.prefix, {
      id: "",
      builtIn: false,
      name: "tidy",
      instruction: "Rewrite next message concisely.",
      enabled: true,
      allowSearch: false,
      allowClipboard: false
    });
    assert.match(responsesRequestBody, /Keep answers concise\./);
    assert.match(responsesRequestBody, /"reasoning":\{"effort":"low"\}/);
    assert.match(responsesRequestBody, /Prefix name: digits/);
    assert.match(responsesRequestBody, /Porvoz supports the exact output token \[enter\]/);
    assert.match(responsesRequestBody, /Do not mention the prefix, trigger phrase, command/);
    assert.match(responsesRequestBody, /Prepend exactly one space to the supplied text/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function prefix(name, instruction, options = {}) {
  return {
    id: name.toLocaleLowerCase(),
    name,
    instruction,
    builtIn: false,
    enabled: true,
    allowSearch: options.allowSearch === true,
    allowClipboard: options.allowClipboard === true
  };
}

function createService({ prefixes = [], availableModels = [] } = {}) {
  let apiKey = "";
  const logs = [];
  let settings = {
    connection: { baseUrl: "", verifyCertificate: true },
    models: {
      available: availableModels,
      transcription: "",
      instruction: "",
      instructionReasoning: "low"
    },
    prompt: "Keep answers concise.",
    prefixes,
    hotkey: { key: "ControlRight", modifiers: [], label: "Right Ctrl" },
    soundVolume: 0.3
  };

  const settingsStore = {
    getLimits: () => ({ ...limits }),
    getSettings: () => structuredClone(settings),
    getApiKey: () => apiKey,
    saveConnection(value) {
      settings.connection = {
        baseUrl: value.baseUrl,
        verifyCertificate: value.verifyCertificate !== false
      };
      if (value.apiKey) apiKey = value.apiKey;
    },
    saveModelCatalog(models) {
      settings.models.available = [...models];
    },
    saveModelSelections(value) {
      settings.models = { ...settings.models, ...value };
    },
    savePrompt(promptValue) {
      settings.prompt = promptValue;
    },
    resetPrompt() {
      settings.prompt = "Keep answers concise.";
      return settings.prompt;
    },
    savePrefixes(prefixValues) {
      settings.prefixes = structuredClone(prefixValues);
    },
    saveSoundVolume(value) {
      settings.soundVolume = value;
    },
    resetBuiltInPrefix() {},
    resetToDefaults() {
      settings = { ...settings, prefixes: [] };
      apiKey = "";
    }
  };

  const logStore = {
    getLogs: () => structuredClone(logs),
    appendLog(entry) {
      logs.unshift(structuredClone(entry));
      return entry;
    },
    clearLogs() {
      logs.length = 0;
      return [];
    }
  };

  return {
    settingsStore,
    logs,
    service: createAppService(settingsStore, logStore)
  };
}
