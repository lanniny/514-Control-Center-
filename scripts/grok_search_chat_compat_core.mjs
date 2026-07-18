const SOURCE_URL_INSTRUCTION =
  "When citing a source, include its full absolute URL starting with https:// in the answer.";

export const GROK_COMPAT_ENV = Object.freeze({
  apiUrl: "GROK_SEARCH_RS_COMPAT_API_URL",
  apiKey: "GROK_SEARCH_RS_COMPAT_API_KEY",
  model: "GROK_SEARCH_RS_COMPAT_MODEL",
});

const STRIPPED_CHILD_ENV_NAMES = new Set([
  ...Object.values(GROK_COMPAT_ENV),
  "GROK_SEARCH_API_KEY",
  "GROK_SEARCH_API_URL",
  "GROK_SEARCH_URL",
  "GROK_SEARCH_MODEL",
  "GROK_SEARCH_WEB_SEARCH",
  "OPENAI_COMPATIBLE_API_URL",
  "OPENAI_COMPATIBLE_API_KEY",
  "OPENAI_COMPATIBLE_MODEL",
].map((name) => name.toUpperCase()));

export function buildChildEnvironment(baseEnv, { localBase, localKey, model }) {
  const childEnv = { ...baseEnv };
  for (const name of Object.keys(childEnv)) {
    if (STRIPPED_CHILD_ENV_NAMES.has(name.toUpperCase())) delete childEnv[name];
  }

  childEnv.OPENAI_COMPATIBLE_API_URL = localBase;
  childEnv.OPENAI_COMPATIBLE_API_KEY = localKey;
  childEnv.OPENAI_COMPATIBLE_MODEL = model;
  childEnv.GROK_SEARCH_WEB_SEARCH = "false";
  return childEnv;
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function cleanUrl(candidate) {
  return candidate.replace(/[.,;:!?*_)}\]。；，！？]+$/g, "");
}

export function extractUrls(content) {
  const text = contentToText(content);
  if (!text) return [];

  const urls = [];
  for (const candidate of text.match(/https?:\/\/[^\s<>"'`\[\]{}]+/gi) || []) {
    urls.push(cleanUrl(candidate));
  }

  const bareDomain =
    /(?:^|[\s([{"'>])((?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|dev|ai|app|xyz|cn|co|edu|gov|info|me|tech|site)(?:\/[^\s<>"'`\[\]{}]*)?)/gim;
  for (const match of text.matchAll(bareDomain)) {
    urls.push(`https://${cleanUrl(match[1])}`);
  }

  return [...new Set(urls.filter(Boolean))];
}

export function normalizeRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (Array.isArray(payload.tools)) {
    const tools = payload.tools.filter(
      (tool) => tool?.type !== "web_search" && tool?.type !== "web_search_preview",
    );
    if (tools.length) payload.tools = tools;
    else delete payload.tools;
  }
  delete payload.web_search_options;
  delete payload.search_parameters;

  if (Array.isArray(payload.messages)) {
    const systemMessage = payload.messages.find(
      (message) => message?.role === "system" && typeof message.content === "string",
    );
    if (systemMessage) {
      if (!systemMessage.content.includes(SOURCE_URL_INSTRUCTION)) {
        systemMessage.content = `${systemMessage.content.trimEnd()}\n${SOURCE_URL_INSTRUCTION}`;
      }
    } else {
      payload.messages.unshift({ role: "system", content: SOURCE_URL_INSTRUCTION });
    }
  }
  return payload;
}

export function injectCitations(payload) {
  if (!payload || !Array.isArray(payload.choices)) return payload;
  for (const choice of payload.choices) {
    const message = choice?.message;
    if (!message || !Array.isArray(message.citations) || message.citations.length === 0) {
      const urls = extractUrls(message?.content);
      if (urls.length && message) message.citations = urls;
    }
  }
  return payload;
}
