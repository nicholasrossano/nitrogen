'use client';

type ChatDebugPayload = Record<string, unknown>;

export function debugChatFlow(event: string, payload: ChatDebugPayload): void {
  if (process.env.NODE_ENV === 'production') return;

  // Keep debug output structured so proposal-flow troubleshooting can follow
  // the same fields across composer, transport, and widget boundaries.
  console.debug('[chat-debug]', event, payload);
}
