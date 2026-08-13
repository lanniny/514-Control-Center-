import vm from "node:vm";
import { parentPort, workerData } from "node:worker_threads";

const EVAL_TIMEOUT_MS = 1000;

const context = vm.createContext(Object.create(null), {
  codeGeneration: { strings: false, wasm: false },
});

function sendAfterMicrotasks(message) {
  // setImmediate only runs after Promise microtasks. A script that schedules an
  // infinite microtask therefore cannot race a success message; the parent hard
  // timeout terminates this worker without blocking the Control Center process.
  setImmediate(() => parentPort?.postMessage(message));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function compile(scriptSource) {
  try {
    const requestJson = vm.runInContext(
      `globalThis.__forgeUsageConfig = (${scriptSource});\n`
        + `if (typeof globalThis.__forgeUsageConfig !== "object" || globalThis.__forgeUsageConfig === null) { throw new TypeError("config must be an object"); }\n`
        + "JSON.stringify(globalThis.__forgeUsageConfig.request)",
      context,
      { timeout: EVAL_TIMEOUT_MS },
    );
    if (typeof requestJson !== "string") throw new TypeError("request config is missing or not serializable");
    sendAfterMicrotasks({ type: "compiled", requestJson });
  } catch (error) {
    sendAfterMicrotasks({ type: "error", phase: "compile", message: errorMessage(error) });
  }
}

function extract(responseJson) {
  try {
    const serializedResponse = JSON.stringify(responseJson);
    const resultJson = vm.runInContext(
      `globalThis.__forgeUsageResponse = JSON.parse(${JSON.stringify(serializedResponse)});\n`
        + `if (typeof globalThis.__forgeUsageConfig.extractor !== "function") { throw new TypeError("extractor must be a function"); }\n`
        + "JSON.stringify(globalThis.__forgeUsageConfig.extractor(globalThis.__forgeUsageResponse))",
      context,
      { timeout: EVAL_TIMEOUT_MS },
    );
    if (typeof resultJson !== "string") throw new TypeError("extractor result is not serializable");
    sendAfterMicrotasks({ type: "extracted", resultJson });
  } catch (error) {
    sendAfterMicrotasks({ type: "error", phase: "extract", message: errorMessage(error) });
  }
}

parentPort?.on("message", (message) => {
  if (message?.type === "extract") extract(message.responseJson);
});

compile(String(workerData?.scriptSource ?? ""));
