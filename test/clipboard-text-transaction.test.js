import assert from "node:assert/strict";
import test from "node:test";
import {
  createClipboardTextTransaction
} from "../electron/clipboard-text-transaction.js";

class FakeBlob {
  constructor(parts) {
    this.bytes = Buffer.concat(parts.map((part) => {
      if (part instanceof FakeBlob) return part.bytes;
      if (Buffer.isBuffer(part)) return part;
      if (part instanceof ArrayBuffer) return Buffer.from(part);
      if (ArrayBuffer.isView(part)) return Buffer.from(part.buffer, part.byteOffset, part.byteLength);
      return Buffer.from(String(part));
    }));
  }

  async arrayBuffer() {
    return this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength
    );
  }
}

class FakeClipboardItem {
  constructor(values) {
    this.values = values;
    this.types = Object.keys(values);
  }

  async getType(type) {
    const value = this.values[type];
    return value instanceof FakeBlob ? value : new FakeBlob([value]);
  }
}

class UnreadableTransportClipboardItem extends FakeClipboardItem {
  async getType(type) {
    if (type.toLowerCase().startsWith("electron application/osclipboard;")
      || type.toLowerCase() === "text/plain;charset=utf-8") {
      throw new Error(`Transport type '${type}' should not be read.`);
    }
    return super.getType(type);
  }
}

class FakeClipboard {
  constructor(items) {
    this.items = items;
  }

  async read() {
    return this.items;
  }

  async write(items) {
    this.items = items;
  }

  clear() {
    this.items = [];
  }
}

function createTransaction(clipboard, { platform = "win32", delay = async () => {} } = {}) {
  return createClipboardTextTransaction({
    clipboard,
    ClipboardItem: FakeClipboardItem,
    Blob: FakeBlob,
    delay,
    platform
  });
}

async function describeClipboard(clipboard) {
  const items = await clipboard.read();
  return Promise.all(items.map(async (item) => Promise.all(item.types.map(async (type) => {
    const value = await item.getType(type);
    const bytes = Buffer.from(await value.arrayBuffer());
    return [type, bytes.toString("utf8")];
  }))));
}

function originalClipboard() {
  return new FakeClipboard([
    new FakeClipboardItem({
      "text/plain": "original text",
      "text/html": new FakeBlob(["<p>original text</p>"])
    })
  ]);
}

test("clipboard text transaction restores every original format after paste", async () => {
  const clipboard = originalClipboard();
  const transaction = createTransaction(clipboard);

  const result = await transaction.pasteText("transcribed text", async () => {
    assert.deepEqual(await describeClipboard(clipboard), [[
      ["text/plain", "transcribed text"]
    ]]);
  });

  assert.deepEqual(result, { clipboardChanged: false });
  assert.deepEqual(await describeClipboard(clipboard), [[
    ["text/plain", "original text"],
    ["text/html", "<p>original text</p>"]
  ]]);
});

test("clipboard text transaction ignores unreadable Linux transport types", async () => {
  const clipboard = new FakeClipboard([
    new UnreadableTransportClipboardItem({
      "text/plain": "original text",
      "text/html": "<p>original text</p>",
      "electron application/osclipboard;format=TARGETS": "transport metadata",
      "text/plain;charset=utf-8": "duplicate text"
    })
  ]);
  const transaction = createTransaction(clipboard, { platform: "linux" });

  await transaction.pasteText("transcribed text", async () => {
    assert.deepEqual(await describeClipboard(clipboard), [[
      ["text/plain", "transcribed text"]
    ]]);
  });

  assert.deepEqual(await describeClipboard(clipboard), [[
    ['electron application/osclipboard;format="text/plain"', "original text"],
    ['electron application/osclipboard;format="UTF8_STRING"', "original text"],
    ['electron application/osclipboard;format="text/plain;charset=utf-8"', "original text"],
    ['electron application/osclipboard;format="text/html"', "<p>original text</p>"],
    ["application/x-copyq-owner", "porvoz"]
  ]]);
});

test("clipboard text transaction leaves an external clipboard change intact", async () => {
  const clipboard = originalClipboard();
  const transaction = createTransaction(clipboard);

  const result = await transaction.pasteText("transcribed text", async () => {
    clipboard.items = [new FakeClipboardItem({ "text/plain": "external text" })];
  });

  assert.deepEqual(result, { clipboardChanged: true });
  assert.deepEqual(await describeClipboard(clipboard), [[
    ["text/plain", "external text"]
  ]]);
});

test("clipboard text transaction restores the clipboard when paste fails", async () => {
  const clipboard = originalClipboard();
  const transaction = createTransaction(clipboard);
  const pasteError = new Error("paste failed");

  await assert.rejects(
    transaction.pasteText("transcribed text", async () => {
      throw pasteError;
    }),
    pasteError
  );

  assert.deepEqual(await describeClipboard(clipboard), [[
    ["text/plain", "original text"],
    ["text/html", "<p>original text</p>"]
  ]]);
});

test("clipboard text transaction restores the clipboard when canceled", async () => {
  const clipboard = originalClipboard();
  const controller = new AbortController();
  const transaction = createClipboardTextTransaction({
    clipboard,
    ClipboardItem: FakeClipboardItem,
    Blob: FakeBlob,
    platform: "win32"
  });

  const operation = transaction.pasteText("transcribed text", async () => {
    controller.abort();
  }, { signal: controller.signal });

  await assert.rejects(operation, (error) => error.code === "ERR_CANCELED");
  assert.deepEqual(await describeClipboard(clipboard), [[
    ["text/plain", "original text"],
    ["text/html", "<p>original text</p>"]
  ]]);
});

test("synthetic copy returns selected text and restores every original format", async () => {
  const clipboard = originalClipboard();
  const transaction = createTransaction(clipboard);

  const selected = await transaction.readSelectedText(async () => {
    const current = await describeClipboard(clipboard);
    assert.match(current[0][0][1], /^porvoz-selection-sentinel:/);
    clipboard.items = [new FakeClipboardItem({
      "text/plain": "selected from Chrome",
      "text/html": "<b>selected from Chrome</b>"
    })];
  });

  assert.equal(selected, "selected from Chrome");
  assert.deepEqual(await describeClipboard(clipboard), [[
    ["text/plain", "original text"],
    ["text/html", "<p>original text</p>"]
  ]]);
});

test("synthetic copy treats an unchanged sentinel as no selection", async () => {
  const clipboard = originalClipboard();
  const transaction = createTransaction(clipboard);

  assert.equal(await transaction.readSelectedText(async () => {}), "");
  assert.deepEqual(await describeClipboard(clipboard), [[
    ["text/plain", "original text"],
    ["text/html", "<p>original text</p>"]
  ]]);
});

test("synthetic copy does not overwrite a later external clipboard change", async () => {
  const clipboard = originalClipboard();
  let delayCalls = 0;
  const transaction = createTransaction(clipboard, {
    async delay() {
      delayCalls += 1;
      if (delayCalls === 2) {
        clipboard.items = [new FakeClipboardItem({ "text/plain": "new external value" })];
      }
    }
  });

  const selected = await transaction.readSelectedText(async () => {
    clipboard.items = [new FakeClipboardItem({ "text/plain": "brief copied selection" })];
  });

  assert.equal(selected, "");
  assert.deepEqual(await describeClipboard(clipboard), [[
    ["text/plain", "new external value"]
  ]]);
});

test("synthetic copy leaves ambiguous non-text clipboard changes intact", async () => {
  const clipboard = originalClipboard();
  const transaction = createTransaction(clipboard);

  const selected = await transaction.readSelectedText(async () => {
    clipboard.items = [new FakeClipboardItem({ "image/png": new FakeBlob(["image bytes"]) })];
  });

  assert.equal(selected, "");
  assert.deepEqual(await describeClipboard(clipboard), [[
    ["image/png", "image bytes"]
  ]]);
});
