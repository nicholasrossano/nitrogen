import { api } from '@/lib/api';

export async function persistChatWidgetUpdate({
  projectId,
  messageId,
  widgetData,
  source,
}: {
  projectId?: string;
  messageId?: string;
  widgetData: Record<string, any>;
  source: string;
}): Promise<boolean> {
  if (!messageId) return true;

  try {
    await api.updateMessageWidget(projectId, messageId, widgetData);
    window.dispatchEvent(new CustomEvent('nitrogen:chat-widget-updated', {
      detail: { messageId, widgetData },
    }));
    return true;
  } catch (err) {
    console.error(`[${source}] failed to persist widget update:`, err);
    return false;
  }
}
