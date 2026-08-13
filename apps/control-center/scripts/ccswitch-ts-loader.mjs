// Generation-only loader for the vendored CC Switch TypeScript preset sources.
// Node strips TypeScript syntax; this hook resolves extensionless imports and
// stubs the two type/config imports needed by the pure preset modules.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "../types" || specifier.endsWith("/types")) {
    return {
      url: "data:text/javascript,export%20const%20ProviderCategory%20%3D%20Object.freeze(%7B%7D)%3B",
      shortCircuit: true,
    };
  }
  if (specifier.endsWith("/utils/grokBuildConfig")) {
    return {
      url: "data:text/javascript,export%20const%20GROK_BUILD_DEFAULT_MODEL%20%3D%20%22grok-4.5%22%3B",
      shortCircuit: true,
    };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z0-9]+$/i.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Preserve Node's original resolution error when no .ts sibling exists.
    }
  }
  return nextResolve(specifier, context);
}
