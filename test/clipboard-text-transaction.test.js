import assert from "node:assert/strict";
import test from "node:test";
import { createClipboardTextTransaction } from "../electron/clipboard-text-transaction.js";

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

function createTransaction(clipboard, { platform } = {}) {
  return createClipboardTextTransaction({
    clipboard,
    ClipboardItem: FakeClipboardItem,
    Blob: FakeBlob,
    delay: async () => {},
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
    ["text/plain", "original text"],
    ["text/html", "<p>original text</p>"]
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
