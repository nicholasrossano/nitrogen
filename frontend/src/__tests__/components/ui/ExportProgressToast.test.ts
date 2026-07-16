import {
  advanceExportToastSteps,
  buildExportToastSteps,
  markExportToastComplete,
  markExportToastFailed,
} from '@/components/ui/ExportProgressToast';

describe('ExportProgressToast helpers', () => {
  it('builds narrative steps for docx exports', () => {
    const steps = buildExportToastSteps('docx');
    expect(steps.map((step) => step.id)).toEqual(['enrich', 'writeup', 'download']);
    expect(steps.map((step) => step.label)).toEqual([
      'Filling remaining research',
      'Drafting the report',
      'Opening',
    ]);
    expect(steps[0].status).toBe('active');
    expect(steps[1].status).toBe('pending');
  });

  it('advances and completes steps', () => {
    const started = buildExportToastSteps('docx');
    const advanced = advanceExportToastSteps(started);
    expect(advanced[0].status).toBe('done');
    expect(advanced[1].status).toBe('active');

    const done = markExportToastComplete(advanced);
    expect(done.every((step) => step.status === 'done')).toBe(true);

    const failed = markExportToastFailed(advanced);
    expect(failed[1].status).toBe('error');
  });
});
