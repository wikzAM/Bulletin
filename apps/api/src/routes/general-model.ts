import { claudeModelCall, withFallback, type ModelCall } from "../general";

export function createGeneralCall(
  role: { model: string; fallback?: string },
  createCall: (model: string) => ModelCall = claudeModelCall,
): ModelCall {
  const primary = createCall(role.model);
  return role.fallback ? withFallback(primary, createCall(role.fallback)) : primary;
}
