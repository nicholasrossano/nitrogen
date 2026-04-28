import { api } from '@/lib/api';

export async function persistChatWidgetUpdate({
  initiativeId,
  messageId,
  widgetData,
  source,
}: {
  initiativeId?: string;
  messageId?: string;
  widgetData: Record<string, any>;
  source: string;
}): Promise<boolean> {
  if (!messageId) return true;

  try {
    await api.updateMessageWidget(initiativeId, messageId, widgetData);
    window.dispatchEvent(new CustomEvent('nitrogen:chat-widget-updated', {
      detail: { messageId, widgetData },
    }));
    return true;
  } catch (err) {
    console.error(`[${source}] failed to persist widget update:`, err);
    return false;
  }
}
