import { Worker } from "node:worker_threads";

const MAX_SELECTED_TEXT_CHARACTERS = 200_000;
const SELECTION_QUERY_TIMEOUT_MS = 2_000;

export function createSelectedTextReader({
  platform = process.platform,
  WorkerImpl = Worker,
  timeoutMs = SELECTION_QUERY_TIMEOUT_MS
} = {}) {
  const workerFile = platform === "win32"
    ? "./selected-text-windows-worker.js"
    : platform === "linux"
      ? "./selected-text-linux-worker.js"
      : null;

  if (!workerFile) {
    return {
      async read() { return ""; },
      dispose() {}
    };
  }
  return createWorkerSelectedTextReader({ WorkerImpl, workerFile, timeoutMs });
}

export function normalizeSelectedText(value) {
  if (typeof value !== "string") return "";
  const text = value.replaceAll("\0", "").slice(0, MAX_SELECTED_TEXT_CHARACTERS);
  return text.trim() ? text : "";
}

function createWorkerSelectedTextReader({ WorkerImpl, workerFile, timeoutMs }) {
  let worker;
  let nextRequestId = 0;
  const pending = new Map();
  return { read, dispose };

  async function read() {
    try {
      return normalizeSelectedText(await requestSelection());
    } catch {
      return "";
    }
  }

  function requestSelection() {
    const activeWorker = ensureWorker();
    const requestId = ++nextRequestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("The selected-text query timed out."));
        resetWorker(activeWorker);
      }, timeoutMs);
      timer.unref?.();
      pending.set(requestId, { resolve, reject, timer });
      activeWorker.postMessage({ type: "read", requestId });
    });
  }

  function ensureWorker() {
    if (worker) return worker;
    const activeWorker = new WorkerImpl(new URL(workerFile, import.meta.url), { type: "module" });
    worker = activeWorker;
    activeWorker.on("message", ({ requestId, text = "" } = {}) => {
      const request = pending.get(requestId);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(requestId);
      request.resolve(text);
    });
    activeWorker.on("error", (error) => {
      if (worker !== activeWorker) return;
      worker = undefined;
      rejectPending(error);
    });
    activeWorker.on("exit", () => {
      if (worker !== activeWorker) return;
      worker = undefined;
      rejectPending(new Error("The selected-text worker stopped."));
    });
    return activeWorker;
  }

  function resetWorker(activeWorker) {
    if (worker !== activeWorker) return;
    worker = undefined;
    rejectPending(new Error("The selected-text worker was reset."));
    activeWorker.terminate().catch?.(() => {});
  }

  function rejectPending(error) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  }

  function dispose() {
    const activeWorker = worker;
    worker = undefined;
    rejectPending(new Error("The selected-text reader was disposed."));
    activeWorker?.terminate().catch?.(() => {});
  }
}
