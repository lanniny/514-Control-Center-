import JSON5 from "json5";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const STRUCTURED_KEY = /(?:^|[,{\s])(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([A-Za-z_][A-Za-z0-9_.-]*))\s*[:=]/gm;

function suspiciousStructuredText(text, isSensitiveKey) {
  if (typeof isSensitiveKey !== "function") return false;
  const matcher = new RegExp(STRUCTURED_KEY.source, STRUCTURED_KEY.flags);
  for (const match of String(text).matchAll(matcher)) {
    const key = match[1] ?? match[2] ?? match[3] ?? "";
    if (isSensitiveKey(key)) return true;
  }
  return false;
}

function defaultJsonSerializer(value, source) {
  return /\r|\n/.test(source) ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

function assignmentKeyBefore(source, start) {
  let index = start - 1;
  while (index >= 0 && /\s/.test(source[index])) index -= 1;
  if (source[index] !== ":" && source[index] !== "=") return "";
  index -= 1;
  while (index >= 0 && /[ \t]/.test(source[index])) index -= 1;
  if (index < 0) return "";

  if (source[index] === '"' || source[index] === "'") {
    const quote = source[index];
    const end = index;
    index -= 1;
    while (index >= 0) {
      if (source[index] === quote) {
        let slashCount = 0;
        for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
        if (slashCount % 2 === 0) return source.slice(index + 1, end);
      }
      if (source[index] === "\n" || source[index] === "\r") return "";
      index -= 1;
    }
    return "";
  }

  const end = index + 1;
  while (index >= 0 && /[A-Za-z0-9_.-]/.test(source[index])) index -= 1;
  const key = source.slice(index + 1, end);
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : "";
}

function sensitiveFlagKey(value, isSensitiveKey) {
  if (typeof value !== "string" || typeof isSensitiveKey !== "function") return "";
  const match = /^--?([A-Za-z][A-Za-z0-9_-]*)(?:=.*)?$/.exec(value.trim());
  return match && isSensitiveKey(match[1]) ? match[1] : "";
}

function sanitizeCommandArguments(value, sanitizeValue, isSensitiveKey) {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const previousKey = index > 0 ? sensitiveFlagKey(value[index - 1], isSensitiveKey) : "";
      return previousKey
        ? sanitizeValue(item, previousKey)
        : sanitizeCommandArguments(item, sanitizeValue, isSensitiveKey);
    });
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      sanitizeCommandArguments(child, sanitizeValue, isSensitiveKey),
    ]));
  }
  if (typeof value === "string") {
    const separator = value.indexOf("=");
    if (separator > 0) {
      const key = sensitiveFlagKey(value.slice(0, separator), isSensitiveKey);
      if (key) return `${value.slice(0, separator + 1)}${sanitizeValue(value.slice(separator + 1), key)}`;
    }
  }
  return value;
}

/**
 * Redacts disjoint embedded JSON/JSON5 values in one forward pass. Nested
 * delimiters belong to the current candidate, so adversarial unmatched
 * openers cannot trigger repeated scans of the remaining suffix.
 */
export function sanitizeEmbeddedJson(text, {
  sanitizeValue,
  scrubText,
  isSensitiveKey,
  serializeJson = defaultJsonSerializer,
  invalidMarker = "[REDACTED INVALID STRUCTURED OUTPUT]",
} = {}) {
  const source = String(text ?? "");
  if (typeof sanitizeValue !== "function" || typeof scrubText !== "function") {
    throw new TypeError("structured redaction requires sanitizeValue and scrubText");
  }

  const replacements = [];
  let start = -1;
  let stack = [];
  let quote = null;
  let escaped = false;
  let parentKey = "";

  const finishCandidate = (end, balanced) => {
    const segment = source.slice(start, end);
    const sensitiveParent = Boolean(parentKey && isSensitiveKey?.(parentKey));
    if (balanced) {
      try {
        const parsed = JSON5.parse(segment);
        if (!parsed || typeof parsed !== "object") throw new Error("structured value required");
        const sanitized = sanitizeCommandArguments(sanitizeValue(parsed, parentKey), sanitizeValue, isSensitiveKey);
        replacements.push({ start, end, value: serializeJson(sanitized, segment) });
      } catch {
        if (sensitiveParent || suspiciousStructuredText(segment, isSensitiveKey)) {
          replacements.push({ start, end, value: invalidMarker });
        }
      }
    } else if (sensitiveParent || suspiciousStructuredText(segment, isSensitiveKey)) {
      replacements.push({ start, end, value: invalidMarker });
    }
    start = -1;
    stack = [];
    quote = null;
    escaped = false;
    parentKey = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (start < 0) {
      if (char === "{" || char === "[") {
        start = index;
        stack = [char];
        parentKey = assignmentKeyBefore(source, index);
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char !== "}" && char !== "]") continue;
    const expected = char === "}" ? "{" : "[";
    if (stack.at(-1) !== expected) {
      finishCandidate(index + 1, false);
      continue;
    }
    stack.pop();
    if (!stack.length) finishCandidate(index + 1, true);
  }
  if (start >= 0) finishCandidate(source.length, false);
  if (!replacements.length) return null;

  let cursor = 0;
  let output = "";
  for (const replacement of replacements) {
    output += scrubText(source.slice(cursor, replacement.start));
    output += replacement.value;
    cursor = replacement.end;
  }
  return `${output}${scrubText(source.slice(cursor))}`;
}

export function sanitizeStructuredText(value, {
  sanitizeValue,
  scrubText,
  isSensitiveKey,
  serializeJson = defaultJsonSerializer,
  serializeYaml = (sanitized) => stringifyYaml(sanitized).trim(),
  invalidMarker,
} = {}) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON5.parse(text);
      if (parsed && typeof parsed === "object") {
        const sanitized = sanitizeCommandArguments(sanitizeValue(parsed), sanitizeValue, isSensitiveKey);
        return serializeJson(sanitized, text);
      }
    } catch {
      // Mixed diagnostic text may still contain one or more valid embedded values.
    }
  }

  let suspiciousYaml = false;
  const looksLikeYaml = /^\s*---(?:\s|$)/.test(text)
    || /^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_.-]*)\s*:(?:[ \t]|$)/m.test(text);
  if (looksLikeYaml) {
    try {
      const parsed = parseYaml(text);
      if (parsed && typeof parsed === "object") {
        const sanitized = sanitizeCommandArguments(sanitizeValue(parsed), sanitizeValue, isSensitiveKey);
        return serializeYaml(sanitized, text);
      }
    } catch {
      suspiciousYaml = suspiciousStructuredText(text, isSensitiveKey);
    }
  }
  const embedded = sanitizeEmbeddedJson(text, {
    sanitizeValue,
    scrubText,
    isSensitiveKey,
    serializeJson,
    invalidMarker,
  });
  if (embedded != null) return embedded;
  if (suspiciousYaml) return invalidMarker || "[REDACTED INVALID STRUCTURED OUTPUT]";
  return null;
}
