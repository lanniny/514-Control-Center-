import { createHash } from "node:crypto";

export const UI_EVENT_TEXT_LIMIT = 32 * 1024;
export const UI_EVENT_INPUT_LIMIT = 8 * 1024;
export const UI_EVENT_DEFAULT_STRING_LIMIT = 4 * 1024;
export const UI_EVENT_COLLECTION_LIMIT = 32;
export const UI_EVENT_PROPERTY_LIMIT = 64;
export const UI_EVENT_DEPTH_LIMIT = 6;
export const UI_EVENT_STRING_BUDGET = 64 * 1024;
export const UI_EVENT_NODE_BUDGET = 1_024;

const IDENTITY_KEYS = new Set([
  "eventId",
  "event_id",
  "id",
  "runId",
  "run_id",
  "sessionId",
  "session_id",
  "correlationId",
  "correlation_id",
  "agentId",
  "agent_id",
]);
const ENVELOPE_STRING_KEYS = new Set(["type", "event_type", "timestamp", "occurred_at", "created_at"]);
const TOP_LEVEL_PROTOCOL_KEYS = [
  "schemaVersion",
  "eventId",
  "event_id",
  "id",
  "type",
  "event_type",
  "sequence",
  "seq",
  "timestamp",
  "occurred_at",
  "created_at",
  "runId",
  "run_id",
  "sessionId",
  "session_id",
  "correlationId",
  "correlation_id",
  "agentId",
  "agent_id",
];
const TOP_LEVEL_PROTOCOL_KEY_SET = new Set(TOP_LEVEL_PROTOCOL_KEYS);

function uiStringLimit(key) {
  if (["text", "content", "message", "summary", "delta"].includes(key)) return UI_EVENT_TEXT_LIMIT;
  if (["input", "command"].includes(key)) return UI_EVENT_INPUT_LIMIT;
  return UI_EVENT_DEFAULT_STRING_LIMIT;
}

function hashedIdentity(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("base64url")}`;
}

function compactIdentity(value) {
  return value.length <= 512 ? value : hashedIdentity(value);
}

function compactKey(key, index) {
  return key.length <= 128 ? key : `omittedKey${index + 1}`;
}

function consumeString(value, context) {
  if (value.length > context.remainingCharacters) return null;
  context.remainingCharacters -= value.length;
  return value;
}

function* projectionKeys(value, depth) {
  if (depth === 0) {
    for (const key of TOP_LEVEL_PROTOCOL_KEYS) {
      if (Object.hasOwn(value, key)) yield key;
    }
  }
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (depth === 0 && TOP_LEVEL_PROTOCOL_KEY_SET.has(key)) continue;
    yield key;
  }
}

function compactRecord(value, depth = 0, context = null) {
  context ??= {
    remainingCharacters: UI_EVENT_STRING_BUDGET,
    remainingNodes: UI_EVENT_NODE_BUDGET,
  };
  if (context.remainingNodes <= 0) return { omitted: true, reason: "node-budget" };
  context.remainingNodes -= 1;
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > UI_EVENT_DEFAULT_STRING_LIMIT) return "";
    return consumeString(value, context) ?? "";
  }
  if (depth >= UI_EVENT_DEPTH_LIMIT) return { omitted: true, reason: "depth-limit" };
  if (Array.isArray(value)) {
    const output = [];
    const limit = Math.min(value.length, UI_EVENT_COLLECTION_LIMIT);
    for (let index = 0; index < limit && context.remainingNodes > 0; index += 1) {
      output.push(compactRecord(value[index], depth + 1, context));
    }
    return output;
  }
  if (typeof value !== "object") {
    const text = String(value);
    if (text.length > UI_EVENT_DEFAULT_STRING_LIMIT) return "";
    return consumeString(text, context) ?? "";
  }

  const output = Object.create(null);
  const markers = [];
  let propertyCount = 0;
  let propertiesTruncated = false;
  for (const rawKey of projectionKeys(value, depth)) {
    if (propertyCount >= UI_EVENT_PROPERTY_LIMIT || context.remainingNodes <= 0) {
      propertiesTruncated = true;
      break;
    }
    const key = compactKey(rawKey, propertyCount);
    const item = value[rawKey];
    propertyCount += 1;
    context.remainingNodes -= 1;
    if (typeof item === "string") {
      if (IDENTITY_KEYS.has(rawKey)) {
        let identity = compactIdentity(item);
        if (identity.length > context.remainingCharacters) identity = hashedIdentity(item);
        output[key] = identity;
        context.remainingCharacters = Math.max(0, context.remainingCharacters - identity.length);
        continue;
      }
      if (depth === 0 && ENVELOPE_STRING_KEYS.has(rawKey)) {
        if (item.length > 512) {
          output[key] = "";
          markers.push([`${key}Length`, item.length], [`${key}Omitted`, true]);
        } else {
          output[key] = item;
          context.remainingCharacters = Math.max(0, context.remainingCharacters - item.length);
        }
        continue;
      }
      const limit = uiStringLimit(rawKey);
      const compacted = item.length <= limit ? consumeString(item, context) : null;
      if (compacted == null) {
        output[key] = "";
        markers.push([`${key}Length`, item.length], [`${key}Omitted`, true]);
      } else {
        output[key] = compacted;
      }
      continue;
    }
    if (Array.isArray(item)) {
      const projected = [];
      const limit = Math.min(item.length, UI_EVENT_COLLECTION_LIMIT);
      for (let index = 0; index < limit && context.remainingNodes > 0; index += 1) {
        projected.push(compactRecord(item[index], depth + 1, context));
      }
      output[key] = projected;
      if (projected.length < item.length) markers.push([`${key}Total`, item.length]);
      continue;
    }
    output[key] = compactRecord(item, depth + 1, context);
  }
  if (propertiesTruncated) output.propertiesOmitted = true;
  // Generated markers win over untrusted companion fields already present in the payload.
  for (const [key, item] of markers) output[key] = item;
  return output;
}

export function eventForUi(event) {
  return compactRecord(event);
}
