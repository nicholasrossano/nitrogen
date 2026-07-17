import { DEFAULT_BAROMETER_DENOMINATOR_USD, getBarometerScale } from '@/lib/billing/usageBarometer';

describe('getBarometerScale', () => {
  it('uses plan cap when limitUsd is set', () => {
    const scale = getBarometerScale('individual', 14.25, 28.5);
    expect(scale).toEqual({
      usedUsd: 14.25,
      denominatorUsd: 28.5,
      percent: 50,
      isReferenceScale: false,
    });
  });

  it('defaults to $100 reference for BYOK', () => {
    const scale = getBarometerScale('byok', 0, 0);
    expect(scale).toEqual({
      usedUsd: 0,
      denominatorUsd: DEFAULT_BAROMETER_DENOMINATOR_USD,
      percent: 0,
      isReferenceScale: true,
    });
  });

  it('defaults to $100 reference for unlimited', () => {
    const scale = getBarometerScale('unlimited', 25, 0);
    expect(scale?.denominatorUsd).toBe(100);
    expect(scale?.percent).toBe(25);
    expect(scale?.isReferenceScale).toBe(true);
  });

  it('returns null when no cap and not an uncapped tier', () => {
    expect(getBarometerScale('none', 0, 0)).toBeNull();
    expect(getBarometerScale('trial', 0, 0)).toBeNull();
  });
});
