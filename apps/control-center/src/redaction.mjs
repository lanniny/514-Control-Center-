const secretKey = /(?:api[_-]?key|access[_-]?key|token|secret|password|authorization|cookie|private[_-]?key|credential)/i;
const privateReasoningKey = /^(?:thinking|chain[_-]?of[_-]?thought|reasoning[_-]?content|internal[_-]?monologue)$/i;

const secretPatterns = [
  { name: "provider credential", pattern: /\b(?:sk-(?:proj-)?|xai-|gh[pousr]_|github_pat_|pat-)[A-Za-z0-9_\-.]{12,}\b/g },
  { name: "Google API credential", pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: "bearer credential", pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi },
  { name: "basic-auth credential", pattern: /\bBasic\s+[A-Za-z0-9+/]{12,}={0,2}\b/gi },
  { name: "JWT-like credential", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

export function redactString(value) {
  let output = value;
  for (const { pattern } of secretPatterns) output = output.replace(pattern, "[REDACTED]");
  return output;
}

export function sanitizeForPersistence(value, key = "") {
  if (privateReasoningKey.test(key)) return "[NOT_PERSISTED]";
  // 键名疑似凭据时只遮字符串——数字/布尔不可能是密钥（否则 tokens 计量字段被误伤成 [REDACTED]）
  if (secretKey.test(key)) {
    return value == null || typeof value === "number" || typeof value === "boolean" ? value : "[REDACTED]";
  }
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForPersistence(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeForPersistence(childValue, childKey),
      ]),
    );
  }
  return value;
}

export function findSecretCandidates(content) {
  const blockers = new Set();
  for (const { name, pattern } of secretPatterns) {
    const tester = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    if (tester.test(content)) blockers.add(`${name} is not allowed in repository configuration`);
  }
  const assignment = /["']?(?:api[_-]?key|access[_-]?key(?:_id)?|token|secret|password|passwd|authorization|cookie|private[_-]?key|credential)["']?\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s,#}]+))/gi;
  for (const match of content.matchAll(assignment)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (!/^\$\{[A-Z0-9_]+\}$/i.test(value) && !/^(?:env|credential):/i.test(value)) {
      if (value.length >= 12 || /^(?:Basic|Bearer)\s+/i.test(value)) {
        blockers.add("secret-like literal detected; use an environment or OS credential reference");
      }
      break;
    }
  }
  return [...blockers];
}
