import type { FieldContext } from '@/lib/api';

interface InputLike {
  field_name?: string;
  label?: string;
  value?: unknown;
  unit?: string | null;
  status?: string | null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export function buildModelInputsContext(
  modelLabel: string,
  inputs: Record<string, InputLike>,
  fieldContext?: FieldContext | null,
): string {
  const lines: string[] = [];

  if (fieldContext?.field_name) {
    lines.push('### Active Investigation');
    lines.push(
      `- ${fieldContext.label || fieldContext.field_name} (field_name=${fieldContext.field_name}): ${formatValue(fieldContext.current_value)} ${fieldContext.unit || ''} [${fieldContext.status || 'unknown'}]`.trim(),
    );
    lines.push('');
  }

  lines.push(`### ${modelLabel} Inputs`);

  for (const [key, input] of Object.entries(inputs)) {
    const fieldName = input.field_name || key;
    const label = input.label || fieldName;
    const unit = input.unit || '';
    const status = input.status || 'unknown';
    lines.push(
      `- ${label} (field_name=${fieldName}): ${formatValue(input.value)} ${unit} [${status}]`.trim(),
    );
  }

  return lines.join('\n');
}
