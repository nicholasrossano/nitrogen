import { fetchApi } from './client';

export const feedbackApi = {
  getFeedbackStatus: () =>
    fetchApi<{ email_configured: boolean }>('/api/v1/feedback/status'),
  submitFeedback: (message: string, subject: string) =>
    fetchApi<{ ok: boolean }>('/api/v1/feedback', {
      method: 'POST',
      body: JSON.stringify({
        message,
        subject,
      }),
    }),
};
