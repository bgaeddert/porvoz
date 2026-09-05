import assert from "node:assert/strict";
import test from "node:test";
import { isSafeWebUrl, parseMarkdown } from "../public/markdown-renderer.js";

test("parses the demonstrated bold text and inline link", () => {
  const [paragraph] = parseMarkdown(
    "The text is from **OpenRouter’s website**. ([qzweng.com](https://qzweng.com/?utm_source=openai))"
  );

  assert.equal(paragraph.type, "paragraph");
  assert.deepEqual(paragraph.children, [
    { type: "text", value: "The text is from " },
    { type: "strong", children: [{ type: "text", value: "OpenRouter’s website" }] },
    { type: "text", value: ". (" },
    {
      type: "link",
      url: "https://qzweng.com/?utm_source=openai",
      children: [{ type: "text", value: "qzweng.com" }]
    },
    { type: "text", value: ")" }
  ]);
});

test("parses common block formatting", () => {
  const blocks = parseMarkdown([
    "## Result",
    "",
    "- **First** item",
    "- Second item",
    "",
    "> A useful note",
    "",
    "```js",
    "const answer = true;",
    "```"
  ].join("\n"));

  assert.deepEqual(blocks.map(({ type }) => type), ["heading", "list", "blockquote", "codeBlock"]);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[3].language, "js");
  assert.equal(blocks[3].value, "const answer = true;");
});

test("only turns normal web URLs into links", () => {
  assert.equal(isSafeWebUrl("https://example.com/path"), true);
  assert.equal(isSafeWebUrl("http://example.com/path"), true);
  assert.equal(isSafeWebUrl("javascript:alert(1)"), false);
  assert.equal(isSafeWebUrl("file:///tmp/private"), false);

  const [paragraph] = parseMarkdown("[unsafe](javascript:alert(1))");
  assert.deepEqual(paragraph.children, [{ type: "text", value: "[unsafe](javascript:alert(1))" }]);
});
