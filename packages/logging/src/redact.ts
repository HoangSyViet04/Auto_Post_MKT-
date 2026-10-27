export const REDACTED = '[REDACTED]';

// Match camelCase, snake_case, hyphenated headers and vendor-prefixed keys.
const sensitiveKey = /cookie|token|auth|pass|pwd|secret|apikey|credential|sessionid/i;
const opaqueKey = /^(body|rawbody|payload|headers)$/i;
const sensitiveText = /cookie|token|authorization|password|passwd|proxy[\s_-]*pass|\b(?:pass|pwd|auth)\s*[:=]|secret|api[\s_-]*key|credential|session[\s_-]*id|\b(?:c_user|xs|datr)\s*=|\b(?:bearer|basic)\s+\S+|[a-z][a-z\d+.-]*:\/\/[^\s/]*@/i;

function unsafeText(value: string): boolean {
  // Query strings can carry percent-encoded field names/credentials.
  for (let i = 0; i < 3; i++) {
    if (sensitiveText.test(value)) return true;
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch { break; }
  }
  return false;
}

/** Conservative, non-mutating filter. Opaque request bodies are never logged. */
export function redactSecrets(value: unknown): unknown {
  const seen = new WeakSet<object>();
  function visit(input: unknown, depth: number): unknown {
    if (typeof input === 'string') return unsafeText(input) ? REDACTED : input;
    if (input === null || typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input !== 'object') return String(input);
    if (depth > 32) return '[MaxDepth]';
    if (seen.has(input)) return '[Circular]';
    seen.add(input);
    if (Array.isArray(input)) return input.map((item) => visit(item, depth + 1));
    const output: Record<string, unknown> = Object.create(null);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    // Header/form entries are also commonly represented as { name/key, value }.
    const label = descriptors.name?.value ?? descriptors.key?.value;
    if (typeof label === 'string' && unsafeText(label)) return REDACTED;
    // Include Error.message/stack/cause, without invoking getters or toJSON.
    for (const [key, descriptor] of Object.entries(descriptors)) {
      const normalized = key.replace(/[^a-z\d]/gi, '');
      if (sensitiveKey.test(normalized) || opaqueKey.test(normalized) || unsafeText(key)) {
        output[key] = REDACTED;
      } else {
        output[key] = 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[Accessor]';
      }
    }
    return output;
  }
  return visit(value, 0);
}
