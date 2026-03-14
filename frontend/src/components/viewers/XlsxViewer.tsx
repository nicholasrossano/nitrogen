'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ZoomableContainer } from './ZoomableContainer';

interface XlsxViewerProps {
  fileData: ArrayBuffer;
}

interface SheetData {
  name: string;
  rows: (string | number | boolean | null)[][];
  colCount: number;
}

function colLabel(index: number): string {
  let label = '';
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

export function XlsxViewer({ fileData }: XlsxViewerProps) {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(fileData, { type: 'array' });

        const parsed: SheetData[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const json: any[][] = XLSX.utils.sheet_to_json(ws, {
            header: 1,
            defval: '',
          });
          const maxCols = json.reduce((m, r) => Math.max(m, r.length), 0);
          return { name, rows: json, colCount: maxCols };
        });

        if (!cancelled) {
          setSheets(parsed);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to parse spreadsheet');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileData]);

  const sheet = sheets[activeSheet];

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-accent" />
          <span className="text-xs text-text-tertiary">Loading spreadsheet…</span>
        </div>
      </div>
    );
  }

  if (error || !sheet) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <p className="text-sm text-text-tertiary">{error || 'No data'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {sheets.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-divider bg-surface-subtle flex-shrink-0 overflow-x-auto">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActiveSheet(i)}
              className={`px-3 py-1 text-xs rounded-t whitespace-nowrap transition-colors ${
                i === activeSheet
                  ? 'bg-surface text-text-primary font-medium border border-b-0 border-stroke-subtle'
                  : 'text-text-tertiary enabled:hover:text-text-secondary enabled:hover:bg-surface/50'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <ZoomableContainer className="flex-1">
        <table className="border-collapse text-xs leading-tight">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="bg-[#f0ede8] border border-stroke-subtle px-2 py-1.5 text-text-tertiary font-normal w-10 text-center sticky left-0 z-20" />
              {Array.from({ length: sheet.colCount }, (_, ci) => (
                <th
                  key={ci}
                  className="bg-[#f0ede8] border border-stroke-subtle px-2 py-1.5 text-text-tertiary font-medium text-center min-w-[80px] whitespace-nowrap"
                >
                  {colLabel(ci)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-surface-subtle/50'}>
                <td className="bg-[#f0ede8] border border-stroke-subtle px-2 py-1 text-text-tertiary text-center font-normal sticky left-0 z-10 tabular-nums">
                  {ri + 1}
                </td>
                {Array.from({ length: sheet.colCount }, (_, ci) => {
                  const val = row[ci];
                  const display = val != null && val !== '' ? String(val) : '';
                  const isNum = typeof val === 'number';
                  return (
                    <td
                      key={ci}
                      className={`border border-stroke-subtle px-2 py-1 text-text-primary whitespace-nowrap ${
                        isNum ? 'text-right tabular-nums' : ''
                      }`}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ZoomableContainer>
    </div>
  );
}
