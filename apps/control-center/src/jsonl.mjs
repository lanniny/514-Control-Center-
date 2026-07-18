import { StringDecoder } from "node:string_decoder";

export function encodeJsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

export function attachLfJsonl(stream, onMessage, onError = () => {}) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  const consume = () => {
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch (error) {
        onError(error, line);
      }
    }
  };

  stream.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    consume();
  });
  stream.on("end", () => {
    buffer += decoder.end();
    if (!buffer.trim()) return;
    let line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
    try {
      onMessage(JSON.parse(line));
    } catch (error) {
      onError(error, line);
    }
  });

  return () => {
    stream.removeAllListeners("data");
    stream.removeAllListeners("end");
  };
}
