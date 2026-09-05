const BLOCK_START = /^(?:#{1,6}\s+|```|>\s?|[-+*]\s+|\d+[.)]\s+)/;
const INLINE_TOKEN = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\([^\s)]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;

export function isSafeWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseInlineMarkdown(source) {
  const value = String(source ?? "");
  const nodes = [];
  let offset = 0;

  for (const match of value.matchAll(INLINE_TOKEN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > offset) nodes.push({ type: "text", value: value.slice(offset, index) });

    if (token.startsWith("`")) {
      nodes.push({ type: "code", value: token.slice(1, -1) });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push({ type: "strong", children: parseInlineMarkdown(token.slice(2, -2)) });
    } else if (token.startsWith("[")) {
      const closeLabel = token.indexOf("](");
      const label = token.slice(1, closeLabel);
      const url = token.slice(closeLabel + 2, -1);
      if (isSafeWebUrl(url)) {
        nodes.push({ type: "link", url, children: parseInlineMarkdown(label) });
      } else {
        nodes.push({ type: "text", value: token });
      }
    } else {
      nodes.push({ type: "emphasis", children: parseInlineMarkdown(token.slice(1, -1)) });
    }
    offset = index + token.length;
  }

  if (offset < value.length) nodes.push({ type: "text", value: value.slice(offset) });
  return nodes.reduce((merged, node) => {
    const previous = merged.at(-1);
    if (node.type === "text" && previous?.type === "text") previous.value += node.value;
    else merged.push(node);
    return merged;
  }, []);
}

export function parseMarkdown(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([^`]*)$/);
    if (fence) {
      const content = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "codeBlock", language: fence[1].trim(), value: content.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInlineMarkdown(heading[2])
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", children: parseInlineMarkdown(quoted.join(" ")) });
      continue;
    }

    const listItem = line.match(/^([-+*]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      const ordered = /^\d/.test(listItem[1]);
      const items = [];
      const matcher = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-+*]\s+(.+)$/;
      while (index < lines.length) {
        const item = lines[index].match(matcher);
        if (!item) break;
        items.push(parseInlineMarkdown(item[1]));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !BLOCK_START.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInlineMarkdown(paragraph.join(" ")) });
  }

  return blocks;
}

function appendInline(parent, nodes, documentRef) {
  for (const node of nodes) {
    if (node.type === "text") {
      parent.append(documentRef.createTextNode(node.value));
      continue;
    }
    if (node.type === "code") {
      const code = documentRef.createElement("code");
      code.textContent = node.value;
      parent.append(code);
      continue;
    }

    const tagName = node.type === "strong"
      ? "strong"
      : node.type === "emphasis"
        ? "em"
        : "a";
    const element = documentRef.createElement(tagName);
    if (node.type === "link") {
      element.href = node.url;
      element.dataset.externalUrl = node.url;
      element.rel = "noreferrer noopener";
    }
    appendInline(element, node.children, documentRef);
    parent.append(element);
  }
}

export function renderMarkdown(container, source) {
  const documentRef = container.ownerDocument;
  const fragment = documentRef.createDocumentFragment();

  for (const block of parseMarkdown(source)) {
    if (block.type === "codeBlock") {
      const pre = documentRef.createElement("pre");
      const code = documentRef.createElement("code");
      code.textContent = block.value;
      if (block.language) code.dataset.language = block.language;
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    if (block.type === "list") {
      const list = documentRef.createElement(block.ordered ? "ol" : "ul");
      for (const children of block.items) {
        const item = documentRef.createElement("li");
        appendInline(item, children, documentRef);
        list.append(item);
      }
      fragment.append(list);
      continue;
    }

    const element = documentRef.createElement(
      block.type === "heading"
        ? `h${block.level}`
        : block.type === "blockquote"
          ? "blockquote"
          : "p"
    );
    appendInline(element, block.children, documentRef);
    fragment.append(element);
  }

  container.replaceChildren(fragment);
}
