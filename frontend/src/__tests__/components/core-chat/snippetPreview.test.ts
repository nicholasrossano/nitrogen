import {
  extractPrimaryStructuredHtml,
  getSnippetPreviewKind,
  looksLikeVisualPdfChunk,
} from '@/components/core-chat/snippetPreview';

describe('snippetPreview helpers', () => {
  it('keeps the nearest heading with the first table preview', () => {
    const html = [
      '<p>Intro copy</p>',
      '<h3>Indicative Theory of Change</h3>',
      '<table><tr><th>Goal</th></tr><tr><td>Impact</td></tr></table>',
      '<p>Trailing notes</p>',
    ].join('');

    expect(extractPrimaryStructuredHtml(html)).toBe(
      '<h3>Indicative Theory of Change</h3>\n<table><tr><th>Goal</th></tr><tr><td>Impact</td></tr></table>',
    );
  });

  it('detects layout-heavy PDF chunks as visual previews', () => {
    const chunk = [
      'GOAL/IMPACT',
      'Enhanced economic opportunity for off-grid energy companies',
      'SECTOR OUTCOME',
      'Inclusive, diversified, green economic transformation accelerated',
      'CLIENT OUTCOME',
      'Women, Youth & People with Disabilities lens',
      'RESULTS BASED FINANCING',
      'Knowledge Sharing, Research, Training, Workshops and Visits',
    ].join('\n');

    expect(looksLikeVisualPdfChunk(chunk)).toBe(true);
  });

  it('keeps prose chunks as text excerpts', () => {
    const prose = [
      'The project expands access to productive-use energy services in rural Malawi.',
      'It focuses on business development support, financing pathways, and adoption risks.',
      'These findings come from a narrative section rather than a figure or table.',
    ].join(' ');

    expect(looksLikeVisualPdfChunk(prose)).toBe(false);
    expect(
      getSnippetPreviewKind({
        fileType: 'pdf',
        hasStructuredHtml: false,
        hasTableHtml: false,
        hasSpreadsheetRows: false,
        hasPagePreview: true,
        preferVisualPdfPreview: false,
      }),
    ).toBe('text');
  });
});
