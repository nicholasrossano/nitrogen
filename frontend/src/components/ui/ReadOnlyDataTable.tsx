'use client';

import { useMemo, useState, type ReactNode } from 'react';

export interface ReadOnlyDataTableColumn<Row extends Record<string, any>> {
  key: keyof Row | string;
  header: string;
  className?: string;
  render?: (row: Row) => ReactNode;
}

export const dataTableHeaderCellClass =
  'text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5';
export const dataTableContainerClass = 'rounded-lg overflow-hidden border border-divider';
export const dataTableTableClass = 'w-full text-sm';
export const dataTableHeaderRowClass = 'bg-black/[0.02]';
export const dataTableBodyClass = 'divide-y divide-divider';
export const dataTableCellClass = 'px-4 py-2.5 text-text-secondary align-top';
export const dataTablePaginationButtonClass =
  'px-2.5 py-1 rounded text-xs text-text-secondary enabled:hover:bg-black/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors';

interface ReadOnlyDataTableProps<Row extends Record<string, any>> {
  columns: ReadOnlyDataTableColumn<Row>[];
  rows: Row[];
  pageSize?: number;
  emptyState: ReactNode;
}

export function ReadOnlyDataTable<Row extends Record<string, any>>({
  columns,
  rows,
  pageSize = 20,
  emptyState,
}: ReadOnlyDataTableProps<Row>) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  const pagedRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  if (!rows.length) {
    return <>{emptyState}</>;
  }

  return (
    <>
      <div className={dataTableContainerClass}>
        <div className="overflow-x-auto">
          <table className={dataTableTableClass}>
            <thead>
              <tr className={dataTableHeaderRowClass}>
                {columns.map((column) => (
                  <th
                    key={String(column.key)}
                    className={[dataTableHeaderCellClass, column.className].filter(Boolean).join(' ')}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={dataTableBodyClass}>
              {pagedRows.map((row, rowIndex) => (
                <tr key={`${rowIndex}-${String(row.id ?? row.entity_id ?? row.module_instance_id ?? 'row')}`}>
                  {columns.map((column) => (
                    <td
                      key={String(column.key)}
                      className={[dataTableCellClass, column.className].filter(Boolean).join(' ')}
                    >
                      {column.render ? column.render(row) : String(row[column.key as keyof Row] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-text-tertiary">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
              className={dataTablePaginationButtonClass}
            >
              Previous
            </button>
            <span className="px-1 text-xs text-text-tertiary">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page === totalPages}
              className={dataTablePaginationButtonClass}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
