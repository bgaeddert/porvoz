import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createAppService } from "../electron/app-service.js";

const limits = {
  maxUploadBytes: 1024,
  maxTranscriptCharacters: 1000,
  maxClipboardCharacters: 1000,
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

  assert.equal(settingsStore.getSettings().profiles[0].connection.baseUrl, "https://example.com/api/v1");
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

  assert.throws(() => service.savePrefixSettings({ prefixes: [
    prefix("digits", "Return digits."),
    prefix("unfinished", "")
  ] }), /needs a name and an instruction/);

  assert.throws(() => service.savePrefixSettings({ prefixes: [
    prefix("digits", "Return digits."),
    prefix("DIGITS", "Return more digits.")
  ] }), /already in use/);
});

test("prefix saves trim valid values and enforce field limits", () => {
  const { service, settingsStore } = createService();

  service.savePrefixSettings({
    prefixes: [prefix("  digits  ", "  Return digits.  ")]
  });
  assert.equal(settingsStore.getSettings().prefixes[0].name, "digits");
  assert.equal(settingsStore.getSettings().prefixes[0].instruction, "Return digits.");

  assert.throws(() => service.savePrefixSettings({
    prefixes: [prefix("a-name-that-is-too-long", "Do it.")]
  }), /up to 12 characters/);
});

test("runtime config omits the retired prompt and prefix search setting", () => {
  const { service } = createService({
    prefixes: [{
      id: "search",
      name: "search",
      instruction: "Find the answer.",
      allowSearch: true,
      allowClipboard: false
    }]
  });

  const runtime = service.getRuntimeConfig();
  assert.equal(Object.hasOwn(runtime, "prompt"), false);
  assert.equal(Object.hasOwn(runtime.prefixes[0], "allowSearch"), false);
});

test("sound volume is clamped and persisted as a normalized value", () => {
  const { service, settingsStore } = createService();

  assert.equal(service.saveSoundVolume(1.5), 1);
  assert.equal(settingsStore.getSettings().soundVolume, 1);
  assert.equal(service.saveSoundVolume(-0.25), 0);
  assert.throws(() => service.saveSoundVolume("loud"), /must be a number/);
});

test("setup status names missing credentials and model selections", () => {
  const { service } = createService();

  const status = service.getSetupStatus();

  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, ["API base URL", "API key", "transcription model", "instruction model"]);
  assert.match(status.warningMessage, /Open Provider & models/);
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

  assert.deepEqual(result, { transcript: "ordinary dictated text", instructionApplied: false, webSearchUsed: false });
});

test("selected text uses the selection flow and ignores prefixes and clipboard access", async () => {
  let requestBody;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ output_text: "selection result" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { service } = createService({
      prefixes: [
        prefix("rewrite", "This prefix instruction must not be sent.", { allowClipboard: true }),
        prefix("unrelated", "This unrelated instruction must not be sent.")
      ],
      availableModels: ["instruction-model"]
    });
    const address = server.address();
    service.saveConnection({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "secret" });
    service.saveModelSelections({ instruction: "instruction-model" });

    let clipboardReads = 0;
    const result = await service.instruct({
      transcript: "rewrite this clearly",
      selectedText: "rough selected sentence"
    }, { readClipboard: () => { clipboardReads += 1; return "clipboard must not be sent"; } });

    assert.deepEqual(result, { transcript: "selection result", instructionApplied: true, webSearchUsed: false });
    assert.equal(clipboardReads, 0);
    assert.match(requestBody.input, /rewrite this clearly/);
    assert.match(requestBody.input, /rough selected sentence/);
    assert.match(requestBody.instructions, /selection processor/);
    assert.match(requestBody.instructions, /Do not detect, remove, or apply Porvoz prefixes/);
    assert.doesNotMatch(requestBody.instructions, /This prefix instruction must not be sent/);
    assert.doesNotMatch(requestBody.instructions, /This unrelated instruction must not be sent/);
    assert.doesNotMatch(requestBody.input, /clipboard must not be sent/);
    assert.deepEqual(requestBody.tools, [{ type: "web_search" }]);
    assert.equal(requestBody.tool_choice, undefined);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("every prefix entry is active when it exists", async () => {
  const { service } = createService({
    prefixes: [prefix("digits", "Return digits.")]
  });

  await assert.rejects(
    service.instruct({ transcript: "digits 42" }),
    /Enter the base URL and API key in Settings/
  );
});

test("instruction failures retain the exact request prompt in the activity log", async () => {
  let requestBody;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Instruction service failed.", code: "server_error" } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { service, logs } = createService({
      prefixes: [prefix("rewrite", "Rewrite the supplied text clearly.")],
      availableModels: ["instruction-model"]
    });
    const address = server.address();
    service.saveConnection({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "secret" });
    service.saveModelSelections({ instruction: "instruction-model" });

    await assert.rejects(
      service.instruct({ transcript: "rewrite this sentence", logGroupId: "instruction-failure" }),
      /instruction model could not respond/
    );

    assert.equal(logs[0].type, "error");
    assert.equal(logs[0].stage, "instruction");
    assert.equal(logs[0].groupId, "instruction-failure");
    assert.equal(logs[0].model, "instruction-model");
    assert.equal(logs[0].prefix, "rewrite");
    assert.equal(logs[0].instructions, requestBody.instructions);
    assert.equal(logs[0].input, requestBody.input);
    assert.equal(logs[0].searchEnabled, true);
    assert.equal(logs[0].clipboardEnabled, false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
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

test("canceled transcription stops without recording a failure log", async () => {
  const { service, logs } = createService({ availableModels: ["transcription-model"] });
  service.saveConnection({ baseUrl: "https://example.com/v1", apiKey: "secret" });
  service.saveModelSelections({ transcription: "transcription-model" });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    service.transcribe(
      { audio: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" },
      { signal: controller.signal }
    ),
    (error) => error.code === "ERR_CANCELED"
  );
  assert.equal(logs.length, 0);
});

test("chained prefixes are stripped and only matched instructions and clipboard context are sent", async () => {
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
        prefix("search", "Find the answer."),
        prefix("clipboard", "Use the reference.", { allowClipboard: true }),
        prefix("unmatched", "This instruction must not be sent.")
      ],
      availableModels: ["instruction-model"]
    });
    const address = server.address();
    service.saveConnection({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "secret" });
    service.saveModelSelections({ instruction: "instruction-model", instructionReasoning: "high" });

    const result = await service.instruct(
      {
        transcript: "search clipboard summarize this",
        logGroupId: "chain-1"
      },
      { readClipboard: () => "reference text" }
    );

    assert.deepEqual(result, { transcript: "combined result", instructionApplied: true, webSearchUsed: false });
    assert.match(requestBody.instructions, /already matched and removed the leading prefix chain/);
    assert.match(requestBody.instructions, /Matched prefix 1: search/);
    assert.match(requestBody.instructions, /Instruction: Find the answer\./);
    assert.match(requestBody.instructions, /Matched prefix 2: clipboard/);
    assert.match(requestBody.instructions, /Instruction: Use the reference\./);
    assert.doesNotMatch(requestBody.instructions, /This instruction must not be sent/);
    assert.match(requestBody.input, /reference text/);
    assert.match(requestBody.input, /\[BEGIN SPOKEN REQUEST\][\s\S]*summarize this[\s\S]*\[END SPOKEN REQUEST\]/);
    assert.doesNotMatch(requestBody.input, /search clipboard summarize this/);
    assert.deepEqual(requestBody.reasoning, { effort: "high" });
    assert.deepEqual(requestBody.tools, [{ type: "web_search" }]);
    assert.equal(requestBody.tool_choice, undefined);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("instruct detects when web search was used from API response output", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      output_text: "Paris weather is 18°C",
      output: [
        { type: "web_search_call", id: "search_1" },
        {
          type: "message",
          content: [
            {
              type: "text",
              text: "Paris weather is 18°C",
              annotations: [
                { type: "url_citation", url: "https://weather.example.com", title: "Weather" }
              ]
            }
          ]
        }
      ]
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { service } = createService({
      prefixes: [prefix("search", "Search the web.")],
      availableModels: ["instruction-model"]
    });
    const address = server.address();
    service.saveConnection({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "secret" });
    service.saveModelSelections({ instruction: "instruction-model" });

    const result = await service.instruct({ transcript: "search weather in paris" });
    assert.equal(result.instructionApplied, true);
    assert.equal(result.webSearchUsed, true);
    assert.match(result.transcript, /Paris weather is 18°C/);
    assert.match(result.transcript, /Sources:\n1\. Weather — https:\/\/weather\.example\.com/);
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
      name: "tidy",
      instruction: "Rewrite next message concisely.",
      allowClipboard: false
    });
    assert.doesNotMatch(responsesRequestBody, /This retired prompt must never be sent\./);
    assert.match(responsesRequestBody, /"reasoning":\{"effort":"low"\}/);
    assert.match(responsesRequestBody, /Prefix name: digits/);
    assert.doesNotMatch(responsesRequestBody, /Prefix Search access/);
    assert.match(responsesRequestBody, /Porvoz supports key notation/);
    assert.match(responsesRequestBody, /Do not mention the prefix, trigger phrase, command/);
    assert.match(responsesRequestBody, /Prepend exactly one space to the supplied text/);
    assert.match(responsesRequestBody, /"tools":\[\{"type":"web_search"\}\]/);
    assert.doesNotMatch(responsesRequestBody, /"tool_choice"/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function prefix(name, instruction, access = {}) {
  return {
    id: name.toLocaleLowerCase(),
    name,
    instruction,
    allowClipboard: access.allowClipboard === true
  };
}

function createService({ prefixes = [], availableModels = [] } = {}) {
  const apiKeys = new Map();
  const logs = [];
  let settings = {
    profiles: [{
      id: "default",
      name: "Default",
      connection: { baseUrl: "", verifyCertificate: true },
      models: {
        available: availableModels,
        transcription: "",
        instruction: "",
        instructionReasoning: "low"
      }
    }],
    activeProfileId: "default",
    prompt: "This retired prompt must never be sent.",
    prefixes,
    hotkey: { key: "ControlRight", modifiers: [], label: "Right Ctrl" },
    soundVolume: 0.3
  };

  const resolveProfileId = (profileId) => profileId || settings.activeProfileId;
  const getProfile = (profileId) => settings.profiles.find(
    (profile) => profile.id === resolveProfileId(profileId)
  );

  const settingsStore = {
    getLimits: () => ({ ...limits }),
    getSettings: () => structuredClone(settings),
    getApiKey: (profileId) => apiKeys.get(resolveProfileId(profileId)) || "",
    hasApiKey: (profileId) => apiKeys.has(resolveProfileId(profileId)),
    saveConnection(value) {
      const profile = getProfile(value.profileId);
      profile.connection = {
        baseUrl: value.baseUrl,
        verifyCertificate: value.verifyCertificate !== false
      };
      if (value.apiKey) apiKeys.set(profile.id, value.apiKey);
    },
    saveModelCatalog(profileId, models) {
      getProfile(profileId).models.available = [...models];
    },
    saveModelSelections(profileId, value) {
      const profile = getProfile(profileId);
      profile.models = { ...profile.models, ...value };
    },
    savePrefixSettings(value) {
      settings.prefixes = structuredClone(value.prefixes);
    },
    saveSoundVolume(value) {
      settings.soundVolume = value;
    },
    addProfile({ name } = {}) {
      const profile = {
        id: `profile-${settings.profiles.length + 1}`,
        name: name || `Connection ${settings.profiles.length + 1}`,
        connection: { baseUrl: "", verifyCertificate: true },
        models: { available: [], transcription: "", instruction: "", instructionReasoning: "low" }
      };
      settings.profiles.push(profile);
      settings.activeProfileId = profile.id;
      return structuredClone(profile);
    },
    renameProfile({ id, name } = {}) {
      getProfile(id).name = name;
    },
    deleteProfile({ id } = {}) {
      settings.profiles = settings.profiles.filter((profile) => profile.id !== id);
      apiKeys.delete(id);
      if (settings.activeProfileId === id) settings.activeProfileId = settings.profiles[0].id;
    },
    setActiveProfile({ id } = {}) {
      settings.activeProfileId = id;
    },
    resetToDefaults() {
      settings = {
        ...settings,
        profiles: [{
          id: "default",
          name: "Default",
          connection: { baseUrl: "", verifyCertificate: true },
          models: { available: [], transcription: "", instruction: "", instructionReasoning: "low" }
        }],
        activeProfileId: "default",
        prefixes: []
      };
      apiKeys.clear();
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
