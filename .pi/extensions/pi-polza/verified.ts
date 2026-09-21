/**
 * Tool support verified by a REAL agent loop through Polza (ТЗ v2 §13).
 *
 * `declaredToolSupport` comes from metadata; this registry is written only after a successful
 * request → tool call → execution → tool result → continuation cycle. Keep it small and factual.
 *
 * Verified: openai/gpt-oss-20b — see notes/native-rub-accounting.md (tool-loop evidence).
 */
export const VERIFIED_TOOL_SUPPORT: Record<string, boolean> = {
  "openai/gpt-oss-20b": true,
};
