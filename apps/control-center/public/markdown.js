// escape-first Markdown 渲染器——用户友好呈现 CLI 输出，不吐源码，也不给注入面。
// 安全模型：raw 先 redact 再全量 escapeHtml，之后只在"已转义文本"上构造固定白名单标签
// （p/strong/em/code/pre/ul/ol/li/blockquote/a/div）。用户内容里的 < > " ' & 已成实体，
// 无法击穿属性或注入标签；链接仅放行 http(s)，其余协议保持纯文本。零第三方依赖。
// 这份 escapeHtml 与 app.js 的同名函数刻意各自内联：安全边界不依赖外部实现，改动别处不破渲染。

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mdInline(escaped) {
  return escaped
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(（])\*([^*\s][^*\n]*?)\*(?=[\s).,;:，。）]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>`);
}

function mdBlocks(escaped) {
  const lines = escaped.split("\n");
  const out = [];
  let list = null; // { tag: "ul"|"ol", items: [] }
  let quote = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${mdInline(paragraph.join("<br>"))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${mdInline(item)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${mdInline(quote.join("<br>"))}</blockquote>`);
    quote = [];
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const quoted = line.match(/^&gt;\s?(.*)$/); // 已转义文本里的 "> "
    if (heading) {
      flushParagraph(); flushList(); flushQuote();
      out.push(`<div class="md-h md-h${heading[1].length}">${mdInline(heading[2])}</div>`);
    } else if (bullet || ordered) {
      flushParagraph(); flushQuote();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((bullet || ordered)[1]);
    } else if (quoted) {
      flushParagraph(); flushList();
      quote.push(quoted[1]);
    } else if (!line.trim()) {
      flushParagraph(); flushList(); flushQuote();
    } else {
      flushList(); flushQuote();
      paragraph.push(line);
    }
  }
  flushParagraph(); flushList(); flushQuote();
  return out.join("");
}

/** raw → 安全 HTML。redact 是可选脱敏钩子（默认恒等），在转义前作用于原文。 */
export function renderMarkdown(raw, redact = (value) => value) {
  const segments = escapeHtml(redact(String(raw ?? ""))).split("```");
  let html = "";
  segments.forEach((segment, index) => {
    if (index % 2 === 1) {
      // fence 内不解析任何行内元素，保持代码原貌
      const newline = segment.indexOf("\n");
      const lang = newline >= 0 ? segment.slice(0, newline).trim() : "";
      const code = (newline >= 0 ? segment.slice(newline + 1) : segment).replace(/\n$/, "");
      html += `<pre class="md-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><code>${code}</code></pre>`;
    } else {
      html += mdBlocks(segment);
    }
  });
  return html || "<p></p>";
}
