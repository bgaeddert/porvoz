import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/settings.js", import.meta.url), "utf8");
const routingSource = source.slice(source.indexOf("function renderModels()"), source.indexOf("function openModelPicker("));

function createHarness() {
  const control = (value = "") => ({ value, disabled: false, replaceChildren() {} });
  const transcriptionModel = control("speech-draft");
  const instructionModel = control("instruction-draft");
  const controls = (model, providerId) => ({
    model, provider: control(providerId), loadButton: control(), picker: control(),
    status: { textContent: "", dataset: {} }
  });
  const persisted = {
    profiles: [{ id: "speech", name: "Speech" }, { id: "instructions", name: "Instructions" }],
    activeProfileId: "speech",
    routing: {
      transcription: { profileId: "speech", available: ["speech-catalog"], model: "old-speech" },
      instruction: { profileId: "instructions", available: ["instruction-catalog"], model: "old-instruction",
        instructionReasoning: "low", searchTool: "omit" }
    }
  };
  const saves = [];
  const calls = [];
  const context = vm.createContext({
    console,
    transcriptionModel,
    instructionModel,
    instructionReasoning: control("high"),
    searchToolInputs: [],
    routingControls: {
      transcription: controls(transcriptionModel, "speech"),
      instruction: controls(instructionModel, "instructions")
    },
    runtimeConfig: structuredClone(persisted),
    document: { createElement: () => control() },
    modelSaveTimers: new Map(),
    modelSaveFailures: new Set(),
    modelSaveQueue: Promise.resolve(),
    setTimeout: () => 1,
    clearTimeout() {},
    getSearchTool: () => "openrouter",
    setSearchTool() {},
    bridge: {
      async saveModelSelections(value) {
        saves.push(JSON.parse(JSON.stringify(value)));
        calls.push("models");
        for (const stage of ["transcription", "instruction"]) {
          if (value[stage] !== undefined) persisted.routing[stage].model = value[stage];
        }
        return structuredClone(persisted);
      },
      async saveRouting(value) {
        calls.push("routing");
        persisted.routing.transcription = {
          profileId: value.transcription, model: "other-provider-model", available: ["other-catalog"]
        };
        return structuredClone(persisted);
      }
    }
  });
  vm.runInContext(routingSource, context);
  return { context, saves, calls };
}

test("both routing fields autosave to their own provider without overwriting the other stage", async () => {
  const { context, saves } = createHarness();
  context.handleModelInput({ target: context.transcriptionModel });
  context.handleModelInput({ target: context.instructionModel });
  await context.flushModelSaves();
  assert.deepEqual(saves, [
    { profileId: "speech", transcription: "speech-draft" },
    { profileId: "instructions", instruction: "instruction-draft", instructionReasoning: "high", searchTool: "openrouter" }
  ]);
  assert.equal(context.runtimeConfig.activeProfileId, "speech");
  assert.equal(context.transcriptionModel.value, "speech-draft");
  assert.equal(context.instructionModel.value, "instruction-draft");
});

test("switching a routed provider saves the pending draft to the original provider first", async () => {
  const { context, saves, calls } = createHarness();
  context.handleModelInput({ target: context.transcriptionModel });
  context.routingControls.transcription.provider.value = "instructions";
  await context.switchRoutingProvider("transcription");
  assert.deepEqual(calls, ["models", "routing"]);
  assert.deepEqual(saves, [{ profileId: "speech", transcription: "speech-draft" }]);
  assert.equal(context.runtimeConfig.routing.transcription.profileId, "instructions");
  assert.equal(context.transcriptionModel.value, "other-provider-model");
  assert.equal(context.instructionModel.value, "instruction-draft");
  assert.equal(context.runtimeConfig.activeProfileId, "speech");
  assert.equal(context.routingControls.transcription.provider.disabled, false);
});

test("a failed autosave preserves the draft and prevents switching its provider", async () => {
  const { context, calls } = createHarness();
  let fail = true;
  const save = context.bridge.saveModelSelections;
  context.bridge.saveModelSelections = (value) => {
    if (fail) return Promise.reject(new Error("Could not reach the server."));
    return save(value);
  };
  context.handleModelInput({ target: context.transcriptionModel });
  context.routingControls.transcription.provider.value = "instructions";
  await context.switchRoutingProvider("transcription");
  assert.deepEqual(calls, []);
  assert.equal(context.transcriptionModel.value, "speech-draft");
  assert.equal(context.routingControls.transcription.provider.value, "speech");
  assert.equal(context.runtimeConfig.routing.transcription.profileId, "speech");
  assert.equal(context.routingControls.transcription.status.dataset.state, "error");
  fail = false;
  context.routingControls.transcription.provider.value = "instructions";
  await context.switchRoutingProvider("transcription");
  assert.deepEqual(calls, ["models", "routing"]);
  assert.equal(context.modelSaveFailures.size, 0);
});

test("saving one model does not overwrite the other stage's routing with an older response", async () => {
  const { context } = createHarness();
  context.runtimeConfig.routing.instruction.profileId = "speech";
  await context.saveModelSelections("transcription");
  assert.equal(context.runtimeConfig.routing.instruction.profileId, "speech");
});
