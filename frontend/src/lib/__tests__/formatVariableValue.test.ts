import { formatVariableValue, percentDisplayNumber } from '@/lib/formatVariableValue';

describe('formatVariableValue', () => {
  it('renders fraction percents as percentage points', () => {
    expect(percentDisplayNumber(0.22)).toBe(22);
    expect(percentDisplayNumber(0.08)).toBe(8);
    expect(formatVariableValue(0.22, '%', 'percent')).toBe('22 %');
    expect(formatVariableValue(0.08, '%', 'percent')).toBe('8 %');
  });

  it('leaves percentage-point storage unchanged', () => {
    expect(percentDisplayNumber(22)).toBe(22);
    expect(percentDisplayNumber(8)).toBe(8);
    expect(formatVariableValue(22, '%', 'percent')).toBe('22 %');
    expect(formatVariableValue(85, '%', 'percent')).toBe('85 %');
  });

  it('keeps more precision for small currency amounts', () => {
    expect(formatVariableValue(0.072, 'USD/kWh', 'currency')).toContain('0.072');
    expect(formatVariableValue(0.072, 'USD/kWh', 'currency')).toContain('USD/kWh');
    const capex = formatVariableValue(1100, 'USD/kW', 'currency');
    expect(capex.replace(/,/g, '')).toBe('1100 USD/kW');
  });
});
