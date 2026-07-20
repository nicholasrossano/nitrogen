import { escapeCurrencyDollars, preprocessMath } from '@/lib/chatMarkdown';

describe('escapeCurrencyDollars', () => {
  it('escapes currency amounts so remark-math will not treat them as math', () => {
    expect(escapeCurrencyDollars('$1,100/kW and $0.054/kWh')).toBe(
      '\\$1,100/kW and \\$0.054/kWh',
    );
    expect(escapeCurrencyDollars('+$100/kW stress (~$0.058/kWh)')).toBe(
      '+\\$100/kW stress (~\\$0.058/kWh)',
    );
  });

  it('leaves display math and already-escaped dollars alone', () => {
    expect(escapeCurrencyDollars('Cost is $$E=mc^2$$ today')).toBe(
      'Cost is $$E=mc^2$$ today',
    );
    expect(escapeCurrencyDollars('Already \\$5')).toBe('Already \\$5');
  });
});

describe('preprocessMath', () => {
  it('does not form a single-$ math span across currency amounts', () => {
    const raw =
      'At $18/kW-yr O&M, raising CAPEX from **$1,100/kW to $1,200/kW** lifts LCOE.';
    const out = preprocessMath(raw);
    // Currency dollars escaped; bold markers stay outside any $...$ math span.
    expect(out).toContain('\\$18/kW-yr');
    expect(out).toContain('**\\$1,100/kW to \\$1,200/kW**');
    expect(out.match(/(?<!\\)\$[^$\n]+(?<!\\)\$/g) ?? []).toEqual([]);
  });

  it('still normalizes \\( \\) and \\[ \\] math delimiters', () => {
    expect(preprocessMath('Inline \\(a+b\\) and display \\[x^2\\]')).toBe(
      'Inline $a+b$ and display $$x^2$$',
    );
  });
});
