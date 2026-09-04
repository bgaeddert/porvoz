import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const settingsSource = readFileSync(new URL("../public/settings.js", import.meta.url), "utf8");
const functionStart = settingsSource.indexOf("async function refreshPrefixes()");
const functionEnd = settingsSource.indexOf("\nfunction ", functionStart);
const refreshPrefixesSource = settingsSource.slice(functionStart, functionEnd);

test("refresh prefixes waits for saves and replaces the displayed server registry", async () => {
  let finishSave;
  let runtimeRequested = false;
  let renders = 0;
  const prefixSaveQueue = new Promise((resolve) => { finishSave = resolve; });
  const context = vm.createContext({
    console,
    prefixSaveQueue,
    refreshPrefixesButton: { disabled: false },
    prefixStatus: { textContent: "", dataset: {} },
    runtimeConfig: { prefixes: [{ id: "old" }] },
    prefixConfig: [{ id: "old" }],
    loadRuntimeConfig: async () => {
      runtimeRequested = true;
      return { prefixes: [{ id: "new", name: "Remote prefix" }] };
    },
    normalizePrefix: (prefix) => ({ ...prefix, normalized: true }),
    renderPrefixes: () => { renders += 1; }
  });
  vm.runInContext(refreshPrefixesSource, context);

  const refresh = context.refreshPrefixes();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtimeRequested, false);
  assert.equal(context.refreshPrefixesButton.disabled, true);

  finishSave();
  await refresh;

  assert.equal(runtimeRequested, true);
  assert.equal(renders, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(context.prefixConfig)), [
    { id: "new", name: "Remote prefix", normalized: true }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.runtimeConfig.prefixes)), [
    { id: "new", name: "Remote prefix", normalized: true }
  ]);
  assert.equal(context.prefixStatus.textContent, "Prefixes refreshed from the server.");
  assert.equal(context.prefixStatus.dataset.state, "success");
  assert.equal(context.refreshPrefixesButton.disabled, false);
});
