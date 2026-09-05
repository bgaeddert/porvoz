import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createSelectedTextReader, normalizeSelectedText } from "../electron/selected-text.js";

test("Windows selected text is read through the native UI Automation worker", async () => {
  const workers = [];
  class FakeWorker extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
      workers.push(this);
    }
    postMessage({ requestId }) {
      queueMicrotask(() => this.emit("message", { requestId, text: "selected from application" }));
    }
    terminate() { return Promise.resolve(); }
  }
  const reader = createSelectedTextReader({ platform: "win32", WorkerImpl: FakeWorker });

  assert.equal(await reader.read(), "selected from application");
  assert.match(workers[0].url.pathname, /selected-text-windows-worker\.js$/);
  reader.dispose();
});

test("Linux selected text is read through the native AT-SPI worker", async () => {
  const workers = [];
  class FakeWorker extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
      workers.push(this);
    }
    postMessage({ requestId }) {
      queueMicrotask(() => this.emit("message", { requestId, text: "selected on Linux" }));
    }
    terminate() { return Promise.resolve(); }
  }
  const reader = createSelectedTextReader({ platform: "linux", WorkerImpl: FakeWorker });

  assert.equal(await reader.read(), "selected on Linux");
  assert.match(workers[0].url.pathname, /selected-text-linux-worker\.js$/);
  reader.dispose();
});

test("selected text is omitted when accessibility returns no usable text", async () => {
  class EmptyWorker extends EventEmitter {
    postMessage({ requestId }) {
      queueMicrotask(() => this.emit("message", { requestId, text: " \r\n\t " }));
    }
    terminate() { return Promise.resolve(); }
  }
  const reader = createSelectedTextReader({ platform: "win32", WorkerImpl: EmptyWorker });

  assert.equal(await reader.read(), "");
  assert.equal(normalizeSelectedText(null), "");
  reader.dispose();
});

test("a timed-out worker cannot disrupt its replacement", async () => {
  let workerNumber = 0;
  class RestartingWorker extends EventEmitter {
    constructor() {
      super();
      this.number = ++workerNumber;
    }
    postMessage({ requestId }) {
      if (this.number === 2) {
        setTimeout(() => this.emit("message", { requestId, text: "replacement result" }), 5);
      } else {
        this.keepAlive = setTimeout(() => {}, 20);
      }
    }
    terminate() {
      clearTimeout(this.keepAlive);
      setTimeout(() => this.emit("exit", 1), 2);
      return Promise.resolve();
    }
  }
  const reader = createSelectedTextReader({
    platform: "linux",
    WorkerImpl: RestartingWorker,
    timeoutMs: 10
  });

  assert.equal(await reader.read(), "");
  assert.equal(await reader.read(), "replacement result");
  reader.dispose();
});

test("unsupported platforms report no selected text", async () => {
  const reader = createSelectedTextReader({ platform: "darwin" });
  assert.equal(await reader.read(), "");
  reader.dispose();
});
