import { StringDecoder } from "node:string_decoder";

export const DEFAULT_JSONL_MAX_LINE_CHARS = 1024 * 1024;

export function encodeJsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

function lineLimitError(limit) {
  const error = new Error(`JSONL line exceeds ${limit} characters`);
  error.code = "JSONL_LINE_TOO_LONG";
  return error;
}

export function createLfJsonlCollector(
  onMessage,
  onError = () => {},
  { maxLineChars = DEFAULT_JSONL_MAX_LINE_CHARS } = {},
) {
  if (!Number.isSafeInteger(maxLineChars) || maxLineChars < 1) {
    throw Object.assign(new Error("maxLineChars must be a positive safe integer"), { code: "INVALID_JSONL_LIMIT" });
  }
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let droppingOversizedLine = false;

  const parse = (rawLine) => {
    let line = rawLine;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim()) return;
    try {
      onMessage(JSON.parse(line));
    } catch (error) {
      onError(error, line);
    }
  };

  const append = (decoded) => {
    let offset = 0;
    while (offset < decoded.length) {
      if (droppingOversizedLine) {
        const newline = decoded.indexOf("\n", offset);
        if (newline < 0) return;
        droppingOversizedLine = false;
        offset = newline + 1;
        continue;
      }

      const newline = decoded.indexOf("\n", offset);
      const end = newline < 0 ? decoded.length : newline;
      const piece = decoded.slice(offset, end);
      const room = maxLineChars - buffer.length;
      if (piece.length > room) {
        if (room > 0) buffer += piece.slice(0, room);
        onError(lineLimitError(maxLineChars), buffer.slice(0, 240));
        buffer = "";
        droppingOversizedLine = newline < 0;
      } else {
        buffer += piece;
        if (newline >= 0) {
          parse(buffer);
          buffer = "";
        }
      }
      offset = newline < 0 ? decoded.length : newline + 1;
    }
  };

  return {
    push(chunk) {
      append(typeof chunk === "string" ? chunk : decoder.write(chunk));
    },
    end() {
      append(decoder.end());
      if (!droppingOversizedLine && buffer) parse(buffer);
      buffer = "";
      droppingOversizedLine = false;
    },
  };
}

export function attachLfJsonl(stream, onMessage, onError = () => {}, options = {}) {
  const collector = createLfJsonlCollector(onMessage, onError, options);
  const onData = (chunk) => collector.push(chunk);
  const onEnd = () => collector.end();
  stream.on("data", onData);
  stream.on("end", onEnd);

  return () => {
    stream.off("data", onData);
    stream.off("end", onEnd);
  };
}
