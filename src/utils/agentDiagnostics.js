// Claude emits this model-alias diagnostic even when the provider answers normally.
// Remove only the known diagnostic line, preserving authentication and other errors.
export const cleanAgentDiagnostic = value => String(value || '')
  .split(/\r?\n/)
  .filter(line => !/^\s*\[claude-code:unrecognized_model\](?:\s*\{[^\r\n]*\})?\s*$/.test(line))
  .join('\n').trim()
