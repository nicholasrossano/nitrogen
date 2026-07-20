import { fetchApi } from './client';

export const feedbackApi = {
  submitFeedback: (message: string, subject: string) =>
    fetchApi<{ ok: boolean }>('/api/v1/feedback', {
      method: 'POST',
      body: JSON.stringify({
        message,
        subject,
      }),
    }),
};
