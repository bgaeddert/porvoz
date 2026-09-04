import { createIcon } from "./icons.js";

const desktopBridge = window.porvozDesktop;
const logCount = document.querySelector("#log-count");
const logCountLabel = document.querySelector("#log-count-label");
const clearLogsButton = document.querySelector("#clear-logs");
const logList = document.querySelector("#log-list");
const logsEmpty = document.querySelector("#logs-empty");
const logsStatus = document.querySelector("#logs-status");
const clearLogsDialog = document.querySelector("#clear-logs-dialog");
const confirmClearLogsButton = document.querySelector("#confirm-clear-logs");
const cancelClearLogsButton = document.querySelector("#cancel-clear-logs");
const logFilter = document.querySelector("#log-filter");

let logs = [];
let filterTerm = "";

if (desktopBridge?.isElectron) {
  desktopBridge.onLogsUpdated(() => refreshLogs("Updated just now"));
  window.addEventListener("focus", () => refreshLogs("Updated just now"));
  window.addEventListener("pageshow", () => refreshLogs("Updated just now"));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshLogs("Updated just now");
  });
} else {
  setArchiveStatus("Logs are available in the Electron app.", "error");
}

clearLogsButton.addEventListener("click", () => clearLogsDialog.showModal());
cancelClearLogsButton.addEventListener("click", () => clearLogsDialog.close());
confirmClearLogsButton.addEventListener("click", clearAllLogs);
logFilter?.addEventListener("input", () => {
  filterTerm = logFilter.value.trim().toLocaleLowerCase();
  renderLogs(logs);
});

await refreshLogs();

async function refreshLogs(statusMessage = "Stored locally") {
  if (!desktopBridge?.isElectron) {
    renderLogs([]);
    return;
  }

  try {
    logs = (await desktopBridge.getLogs()).map(normalizeLog).filter(Boolean);
    renderLogs(logs);
    setArchiveStatus(statusMessage, "success");
  } catch (error) {
    console.error("Could not load response logs:", error);
    renderLogs([]);
    setArchiveStatus(error.message || "Could not load response logs.", "error");
  }
}

function renderLogs(entries) {
  const orderedLogs = [...entries]
    .filter(matchesFilter)
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
  const count = orderedLogs.length;
  logCount.textContent = count.toLocaleString();
  logCountLabel.textContent = filterTerm
    ? (count === 1 ? "event matches" : "events match")
    : (count === 1 ? "event stored" : "events stored");
  clearLogsButton.disabled = entries.length === 0;
  logList.replaceChildren(...buildLogGroups(orderedLogs).map(createLogGroup));
  logsEmpty.hidden = count > 0;
  setEmptyStateCopy(entries.length > 0 && count === 0);
}

function matchesFilter(log) {
  if (!filterTerm) return true;
  return [log.text, log.prefix, log.model, log.stage, log.errorCode, log.instructions, log.input]
    .some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(filterTerm));
}

function setEmptyStateCopy(isFilteredOut) {
  const heading = logsEmpty.querySelector("h2");
  const body = logsEmpty.querySelector("p");
  if (!heading || !body) return;
  if (isFilteredOut) {
    heading.textContent = "Nothing matches that filter";
    body.textContent = "No stored transcript, response, or error contains that text. Clear the filter to see everything again.";
    return;
  }
  heading.textContent = "No activity yet";
  body.textContent = "Start a transcription to place the first event here. Successful responses and operational errors are saved automatically.";
}

function buildLogGroups(orderedLogs) {
  const groups = [];
  const explicitGroups = new Map();
  const groupedLogs = new Set();

  orderedLogs.forEach((log) => {
    if (!log.groupId) return;
    if (!explicitGroups.has(log.groupId)) explicitGroups.set(log.groupId, []);
    explicitGroups.get(log.groupId).push(log);
    groupedLogs.add(log);
  });

  for (let index = 0; index < orderedLogs.length; index += 1) {
    const log = orderedLogs[index];
    if (log.groupId) {
      if (explicitGroups.get(log.groupId)[0] === log) groups.push(explicitGroups.get(log.groupId));
      continue;
    }

    const nextLog = orderedLogs[index + 1];
    if (isLinkedPair(log, nextLog) && !groupedLogs.has(nextLog)) {
      groups.push([log, nextLog]);
      index += 1;
      continue;
    }
    groups.push([log]);
  }

  return groups;
}

function isLinkedPair(first, second) {
  if (!first || !second || first.groupId || second.groupId) return false;
  if (first.type !== "instruction" || second.type !== "transcript") return false;
  return Math.abs(Date.parse(first.createdAt) - Date.parse(second.createdAt)) <= 10 * 60 * 1000;
}

function createLogGroup(group) {
  const entries = [...group].sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt));
  const hasError = entries.some((entry) => entry.type === "error");
  const session = document.createElement("article");
  session.className = `log-session ${entries.length > 1 ? "log-session-linked" : "log-session-single"}${hasError ? " log-session-error" : ""}`;

  const header = document.createElement("header");
  header.className = "log-session-header";

  const heading = document.createElement("div");
  heading.className = "log-session-heading";
  const label = document.createElement("span");
  label.className = "log-session-label";
  const error = entries.find((entry) => entry.type === "error");
  label.textContent = error
    ? `${formatStage(error.stage)} failure`
    : entries.length > 1 ? "Transcript → instruction" : "Single response";
  const count = document.createElement("span");
  count.className = "log-session-count";
  count.textContent = entries.length > 1
    ? `${entries.length} ${error ? "events" : "stages"}`
    : error ? "error" : entries[0].type;
  heading.append(label, count);

  const time = document.createElement("time");
  time.className = "log-session-time";
  time.dateTime = entries[entries.length - 1].createdAt;
  time.textContent = formatTimestamp(entries[entries.length - 1].createdAt);
  header.append(heading, time);

  const stages = document.createElement("div");
  stages.className = "log-session-stages";
  entries.forEach((log, index) => {
    if (index > 0) stages.append(createStageConnector(log));
    stages.append(createLogStage(log));
  });

  session.append(header, stages);
  return session;
}

function createStageConnector(log) {
  const connector = document.createElement("div");
  connector.className = "log-stage-connector";
  const label = document.createElement("span");
  label.textContent = log.type === "error"
    ? `${formatStage(log.stage)} failure`
    : log.prefix ? `Prefix applied · ${log.prefix}` : "Instruction applied";
  const arrow = document.createElement("span");
  arrow.className = "log-stage-arrow";
  arrow.append(createIcon("arrow-down", "log-stage-arrow-icon"));
  connector.append(label, arrow);
  return connector;
}

function createLogStage(log) {
  const stage = document.createElement("article");
  stage.className = `log-stage log-stage-${log.type}`;

  const meta = document.createElement("aside");
  meta.className = "log-stage-meta";

  const type = document.createElement("span");
  type.className = "log-stage-type";
  type.textContent = log.type === "error"
    ? `${formatStage(log.stage)} error`
    : log.type === "transcript" ? "Transcript" : "Instruction";

  const time = document.createElement("time");
  time.className = "log-stage-time";
  time.dateTime = log.createdAt;
  time.textContent = formatTimestamp(log.createdAt);

  meta.append(type, time);
  // Every chip reads "Label · value" so the row scans as one list, not a mix.
  if (log.stage) meta.append(createMetaChip(`Stage · ${formatStage(log.stage)}`));
  if (log.status !== null) meta.append(createMetaChip(`Status · HTTP ${log.status}`));
  if (log.errorCode) meta.append(createMetaChip(`Code · ${log.errorCode}`));
  if (log.model) meta.append(createMetaChip(`Model · ${log.model}`));
  if (log.mimeType) meta.append(createMetaChip(`Format · ${log.mimeType}`));
  if (log.bytes !== null) meta.append(createMetaChip(`Size · ${log.bytes.toLocaleString()} bytes`));
  if (log.prefix) meta.append(createMetaChip(`Prefix · ${log.prefix}`));
  // Access grants are a different class of fact and get their own styling.
  if (log.searchEnabled || log.clipboardEnabled) {
    const access = document.createElement("div");
    access.className = "log-stage-access";
    if (log.searchEnabled) access.append(createMetaChip("Access · Search"));
    if (log.clipboardEnabled) access.append(createMetaChip("Access · Clipboard"));
    meta.append(access);
  }
  meta.append(createStageActions(log));

  const content = document.createElement("div");
  content.className = "log-stage-content";
  const label = document.createElement("p");
  label.className = "log-stage-label";
  label.textContent = log.type === "error"
    ? "Failure details"
    : log.type === "transcript" ? "Captured voice" : "Routed output";
  const response = document.createElement("p");
  response.className = "log-stage-response";
  response.textContent = log.text;
  content.append(label, response);
  if (log.instructions || log.input) content.append(createPromptDetails(log));

  stage.append(meta, content);
  return stage;
}

function createStageActions(log) {
  const actions = document.createElement("div");
  actions.className = "log-stage-actions";

  // A failure that names the provider settings should be able to open them.
  if (log.type === "error" && (log.stage === "transcription" || log.stage === "instruction")) {
    const recovery = document.createElement("a");
    recovery.className = "log-recovery-link";
    recovery.href = "settings.html#provider";
    recovery.textContent = "Open provider settings";
    actions.append(recovery);
  }

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "button-secondary button-with-icon log-copy-button";
  copyButton.append(createIcon("copy"), createButtonLabel("Copy"));
  copyButton.setAttribute("aria-label", "Copy this text to the clipboard");
  copyButton.addEventListener("click", () => copyStageText(log.text, copyButton));
  actions.append(copyButton);

  return actions;
}

function createButtonLabel(text) {
  const label = document.createElement("span");
  label.className = "button-label";
  label.textContent = text;
  return label;
}

async function copyStageText(text, button) {
  const label = button.querySelector(".button-label");
  try {
    if (desktopBridge?.writeClipboardText) await desktopBridge.writeClipboardText(text);
    else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else throw new Error("Clipboard access is unavailable.");
    label.textContent = "Copied";
  } catch (error) {
    console.error("Could not copy the entry:", error);
    label.textContent = "Copy failed";
  }
  setTimeout(() => {
    label.textContent = "Copy";
  }, 1600);
}

function createPromptDetails(log) {
  const details = document.createElement("details");
  details.className = "log-prompt-details";
  const summary = document.createElement("summary");
  summary.textContent = "Show exact prompt sent";
  const prompt = document.createElement("div");
  prompt.className = "log-prompt-body";
  if (log.instructions) prompt.append(createPromptBlock("Instructions", log.instructions));
  if (log.input) prompt.append(createPromptBlock("Input", log.input));
  details.append(summary, prompt);
  return details;
}

function createPromptBlock(labelText, value) {
  const block = document.createElement("section");
  block.className = "log-prompt-block";
  const label = document.createElement("h3");
  label.textContent = labelText;
  const text = document.createElement("pre");
  text.textContent = value;
  block.append(label, text);
  return block;
}

function createMetaChip(text) {
  const chip = document.createElement("span");
  chip.className = "log-meta-chip";
  chip.textContent = text;
  return chip;
}

async function clearAllLogs() {
  confirmClearLogsButton.disabled = true;
  cancelClearLogsButton.disabled = true;
  setArchiveStatus("Clearing response archive…", "loading");
  try {
    if (!desktopBridge?.isElectron) throw new Error("Logs are available in the Electron app.");
    logs = await desktopBridge.clearLogs();
    renderLogs(logs);
    clearLogsDialog.close();
    setArchiveStatus("Archive cleared", "success");
  } catch (error) {
    console.error("Could not clear response logs:", error);
    setArchiveStatus(error.message || "Could not clear response logs.", "error");
  } finally {
    confirmClearLogsButton.disabled = false;
    cancelClearLogsButton.disabled = false;
  }
}

function normalizeLog(log) {
  if (!log || typeof log !== "object") return null;
  if (!["transcript", "instruction", "error"].includes(log.type) || typeof log.text !== "string" || !log.text.trim()) return null;
  const text = log.type === "instruction" ? log.text : log.text.trim();
  return {
    type: log.type,
    text,
    createdAt: typeof log.createdAt === "string" && Number.isFinite(Date.parse(log.createdAt))
      ? log.createdAt
      : new Date().toISOString(),
    groupId: typeof log.groupId === "string" ? log.groupId.trim() : "",
    model: typeof log.model === "string" ? log.model.trim() : "",
    prefix: typeof log.prefix === "string" ? log.prefix.trim() : "",
    instructions: typeof log.instructions === "string" ? log.instructions : "",
    input: typeof log.input === "string" ? log.input : "",
    searchEnabled: log.searchEnabled === true,
    clipboardEnabled: log.clipboardEnabled === true,
    stage: typeof log.stage === "string" ? log.stage.trim() : "",
    status: Number.isInteger(Number(log.status)) && Number(log.status) >= 100 && Number(log.status) <= 599
      ? Number(log.status)
      : null,
    errorCode: typeof log.errorCode === "string" ? log.errorCode.trim() : "",
    mimeType: typeof log.mimeType === "string" ? log.mimeType.trim() : "",
    bytes: Number.isSafeInteger(Number(log.bytes)) && Number(log.bytes) >= 0 && log.bytes !== null
      ? Number(log.bytes)
      : null
  };
}

function formatStage(value) {
  const stage = typeof value === "string" ? value.trim() : "application";
  return stage ? stage[0].toLocaleUpperCase() + stage.slice(1) : "Application";
}

function formatTimestamp(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function setArchiveStatus(message, state) {
  logsStatus.textContent = message;
  logsStatus.dataset.state = state;
}
