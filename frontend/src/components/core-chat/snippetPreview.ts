export type SnippetPreviewKind = 'page' | 'table' | 'formatted' | 'text';

export function hasTableMarkup(html?: string | null): boolean {
  return Boolean(html && /<table[\s>]/i.test(html));
}

export function extractPrimaryStructuredHtml(html: string): string {
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return html;

  const tableHtml = tableMatch[0];
  const tableIndex = tableMatch.index ?? 0;
  const prefix = html.slice(0, tableIndex);
  const labelMatches = Array.from(
    prefix.matchAll(/<(h[1-6]|p)[^>]*>[\s\S]*?<\/\1>/gi),
  );
  const labelHtml = labelMatches.at(-1)?.[0]?.trim();

  return labelHtml ? `${labelHtml}\n${tableHtml}` : tableHtml;
}

export function normalizeSpreadsheetText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

export function hasTabularRows(text: string): boolean {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.some((line) => line.includes('\t') && line.split('\t').length > 1);
}

export function looksLikeVisualPdfChunk(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return true;

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 4) return false;

  const wordsPerLine = lines.map((line) => line.split(/\s+/).filter(Boolean).length);
  const shortLineRatio = wordsPerLine.filter((count) => count <= 7).length / lines.length;
  const avgWordsPerLine = wordsPerLine.reduce((sum, count) => sum + count, 0) / lines.length;
  const sentenceishLineRatio = lines.filter((line) => /[.!?]$/.test(line)).length / lines.length;
  const digitAndSymbolRatio = ((normalized.match(/[0-9%$#@/\\()[\]{}<>|+=_*~-]/g) ?? []).length) / normalized.length;
  const alphaWordCount = (normalized.match(/[A-Za-z]{4,}/g) ?? []).length;

  return (
    (shortLineRatio >= 0.6 && avgWordsPerLine <= 8 && sentenceishLineRatio <= 0.3) ||
    (lines.length >= 6 && digitAndSymbolRatio >= 0.12 && alphaWordCount < 24)
  );
}

export function getSnippetPreviewKind({
  fileType,
  hasStructuredHtml,
  hasTableHtml,
  hasSpreadsheetRows,
  hasPagePreview,
  preferVisualPdfPreview,
}: {
  fileType: string | null;
  hasStructuredHtml: boolean;
  hasTableHtml: boolean;
  hasSpreadsheetRows: boolean;
  hasPagePreview: boolean;
  preferVisualPdfPreview: boolean;
}): SnippetPreviewKind {
  if (hasPagePreview && (fileType === 'pdf') && preferVisualPdfPreview) {
    return 'page';
  }
  if (hasSpreadsheetRows || hasTableHtml) {
    return 'table';
  }
  if (hasStructuredHtml) {
    return 'formatted';
  }
  return 'text';
}

export function getSnippetPreviewLabel(kind: SnippetPreviewKind): string {
  switch (kind) {
    case 'page':
      return 'Page preview';
    case 'table':
      return 'Table preview';
    case 'formatted':
      return 'Formatted excerpt';
    case 'text':
    default:
      return 'Text excerpt';
  }
}
