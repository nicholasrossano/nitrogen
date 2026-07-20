/**
 * Format variable values for tables and detail panes.
 *
 * Percent storage is inconsistent in the wild: LLM extraction often writes
 * percentage points (22, 8) while LCOE/carbon engines use 0–1 fractions
 * (0.22, 0.08). When the unit is `%` (or value_type is percent), treat
 * |value| ≤ 1 as a fraction for *display* so we never show "0.22 %".
 */

export function percentDisplayNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) > 0 && Math.abs(value) <= 1) return value * 100;
  return value;
}

function formatNumeric(value: number, valueType?: string | null): string {
  if (!Number.isFinite(value)) return String(value);
  if (valueType === 'currency') {
    // Tariffs like USD/kWh need more than 2 dp; large CAPEX does not.
    const abs = Math.abs(value);
    const digits = abs > 0 && abs < 1 ? 4 : 2;
    return value.toLocaleString(undefined, { maximumFractionDigits: digits });
  }
  if (valueType === 'percent') {
    return percentDisplayNumber(value).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  }
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function formatVariableValue(
  value: unknown,
  unit?: string | null,
  valueType?: string | null,
): string {
  if (value === null || value === undefined || value === '') return '';

  const isPercent = valueType === 'percent' || unit === '%';

  let formatted: string;
  if (typeof value === 'number') {
    if (isPercent) {
      formatted = percentDisplayNumber(value).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });
    } else {
      formatted = formatNumeric(value, valueType);
    }
  } else if (typeof value === 'object') {
    formatted = JSON.stringify(value);
  } else {
    formatted = String(value);
  }

  return unit ? `${formatted} ${unit}` : formatted;
}
