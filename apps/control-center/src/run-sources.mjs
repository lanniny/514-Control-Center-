import { basename, isAbsolute } from "node:path";

const MAX_RUN_SOURCES = 16;
const MAX_SOURCE_PATH_LENGTH = 4_096;
const LEGACY_ATTACHMENT_MARKERS = [
  "[附件资料——请读取以下文件作为本任务的上下文]",
  "[附件资料——仅在本轮 CLI 进程内可见，请按需读取]",
];
const NAMED_ATTACHMENT_MARKER = "[附件资料——仅在本轮 CLI 进程内可见，请按需读取]";

export function normalizeRunSources(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw Object.assign(new Error("sources must be an array"), { code: "VALIDATION_FAILED" });
  if (value.length > MAX_RUN_SOURCES) {
    throw Object.assign(new Error(`sources exceeds ${MAX_RUN_SOURCES} items`), { code: "VALIDATION_FAILED" });
  }
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    const path = String(typeof raw === "string" ? raw : raw?.path ?? "").trim();
    if (!path || path.length > MAX_SOURCE_PATH_LENGTH || path.includes("\0") || !isAbsolute(path)) {
      throw Object.assign(new Error("source path must be an absolute local path"), { code: "VALIDATION_FAILED" });
    }
    const key = process.platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: "file", path, name: basename(path) || "source" });
  }
  return result;
}

export function publicSourceEntries(sources) {
  return (Array.isArray(sources) ? sources : []).map((source) => ({
    path: String(source?.path || ""),
    name: String(source?.name || basename(String(source?.path || "source"))).slice(0, 180),
    kind: String(source?.kind || "file"),
  }));
}

function replaceSourcePath(text, path, replacement) {
  if (!path) return text;
  if (process.platform !== "win32") return text.replaceAll(path, replacement);
  const needle = path.toLowerCase();
  let remaining = text;
  let folded = remaining.toLowerCase();
  let output = "";
  for (let index = folded.indexOf(needle); index >= 0; index = folded.indexOf(needle)) {
    output += `${remaining.slice(0, index)}${replacement}`;
    remaining = remaining.slice(index + path.length);
    folded = folded.slice(index + path.length);
  }
  return output + remaining;
}

function redactLegacyAttachmentBlock(text) {
  let value = text;
  for (const marker of LEGACY_ATTACHMENT_MARKERS) {
    const markerIndex = value.lastIndexOf(marker);
    if (markerIndex < 0) continue;
    const lineStart = markerIndex + marker.length;
    const suffix = value.slice(lineStart);
    const leadingBreak = /^(\r?\n)/.exec(suffix)?.[0] ?? "";
    if (!leadingBreak) continue;
    const lines = suffix.slice(leadingBreak.length).split(/\r?\n/);
    let changed = false;
    const projected = lines.map((line) => {
      const match = /^-\s+(.+)$/.exec(line);
      if (!match) return line;
      let path = match[1].trim();
      const namedPath = marker === NAMED_ATTACHMENT_MARKER ? /^(.*)\s+\(([^()]*)\)$/.exec(path) : null;
      if (namedPath && isAbsolute(namedPath[1])) path = namedPath[1];
      if (!isAbsolute(path)) return line;
      changed = true;
      return `- [附件:${basename(path) || "source"}]`;
    });
    if (changed) value = `${value.slice(0, lineStart)}${leadingBreak}${projected.join("\n")}`;
  }
  return value;
}

export function redactSourcePaths(value, sources) {
  const entries = publicSourceEntries(sources)
    .filter((source) => source.path)
    .sort((left, right) => right.path.length - left.path.length);
  const seen = new WeakSet();
  const redact = (item) => {
    if (typeof item === "string") {
      let text = redactLegacyAttachmentBlock(item);
      for (const source of entries) {
        const replacement = `[附件:${source.name}]`;
        text = replaceSourcePath(text, source.path, replacement);
        const alternate = source.path.includes("\\") ? source.path.replaceAll("\\", "/") : source.path.replaceAll("/", "\\");
        if (alternate !== source.path) text = replaceSourcePath(text, alternate, replacement);
      }
      return text;
    }
    if (!item || typeof item !== "object") return item;
    if (seen.has(item)) return item;
    seen.add(item);
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index += 1) item[index] = redact(item[index]);
    } else {
      for (const key of Object.keys(item)) item[key] = redact(item[key]);
    }
    return item;
  };
  return redact(structuredClone(value));
}

export function promptWithRunSources(prompt, sources) {
  const items = Array.isArray(sources) ? sources : [];
  if (!items.length) return String(prompt ?? "");
  const lines = items.slice(0, MAX_RUN_SOURCES).map((source) => `- ${String(source?.path || "")} (${String(source?.name || "source")})`);
  return `${String(prompt ?? "")}\n\n[附件资料——仅在本轮 CLI 进程内可见，请按需读取]\n${lines.join("\n")}`;
}

export function extractLegacyRunSources(prompt, sources = []) {
  const text = String(prompt ?? "").trim();
  const existing = normalizeRunSources(sources);
  for (const marker of LEGACY_ATTACHMENT_MARKERS) {
    const separator = `\n\n${marker}\n`;
    const markerIndex = text.lastIndexOf(separator);
    if (markerIndex < 0) continue;
    const lines = text.slice(markerIndex + separator.length).split(/\r?\n/).filter(Boolean);
    const paths = [];
    let valid = lines.length > 0;
    for (const line of lines) {
      const match = /^-\s+(.+)$/.exec(line);
      if (!match) {
        valid = false;
        break;
      }
      let path = match[1].trim();
      const namedPath = marker === NAMED_ATTACHMENT_MARKER ? /^(.*)\s+\(([^()]*)\)$/.exec(path) : null;
      if (namedPath && isAbsolute(namedPath[1])) path = namedPath[1];
      if (!isAbsolute(path)) {
        valid = false;
        break;
      }
      paths.push(path);
    }
    if (!valid) continue;
    return {
      prompt: text.slice(0, markerIndex).trim(),
      sources: normalizeRunSources([...existing, ...paths]),
      migrated: true,
    };
  }
  return { prompt: text, sources: existing, migrated: false };
}
