import {
  DEFAULT_BAROMETER_DENOMINATOR_USD,
  REFERENCE_SCALE_DISCLAIMER,
  SUBSCRIPTION_CAP_DISCLAIMER,
  barometerDisclaimer,
  getBarometerScale,
} from '@/lib/billing/usageBarometer';

describe('getBarometerScale', () => {
  it('uses plan cap for subscription tiers', () => {
    const scale = getBarometerScale('individual', 14.25, 28.5);
    expect(scale).toEqual({
      usedUsd: 14.25,
      denominatorUsd: 28.5,
      percent: 50,
      scaleKind: 'subscription',
    });
  });

  it('defaults to $100 reference for BYOK even if limitUsd is set', () => {
    const scale = getBarometerScale('byok', 0, 28.5);
    expect(scale).toEqual({
      usedUsd: 0,
      denominatorUsd: DEFAULT_BAROMETER_DENOMINATOR_USD,
      percent: 0,
      scaleKind: 'reference',
    });
  });

  it('defaults to $100 reference for unlimited', () => {
    const scale = getBarometerScale('unlimited', 25, 0);
    expect(scale?.denominatorUsd).toBe(100);
    expect(scale?.percent).toBe(25);
    expect(scale?.scaleKind).toBe('reference');
  });

  it('uses trial cap without subscription scale kind', () => {
    const scale = getBarometerScale('trial', 0.5, 1);
    expect(scale?.scaleKind).toBe('trial');
    expect(barometerDisclaimer(scale!)).toBeNull();
  });

  it('returns null when no applicable scale', () => {
    expect(getBarometerScale('none', 0, 0)).toBeNull();
    expect(getBarometerScale('trial', 0, 0)).toBeNull();
  });
});

describe('barometer disclaimers', () => {
  it('uses subscription cap copy', () => {
    expect(SUBSCRIPTION_CAP_DISCLAIMER).toContain('95%');
    expect(
      barometerDisclaimer({
        usedUsd: 1,
        denominatorUsd: 28.5,
        percent: 3,
        scaleKind: 'subscription',
      }),
    ).toBe(SUBSCRIPTION_CAP_DISCLAIMER);
  });

  it('uses reference scale copy without em dash', () => {
    expect(REFERENCE_SCALE_DISCLAIMER).not.toContain('—');
    expect(REFERENCE_SCALE_DISCLAIMER).toBe(
      'Scale defaults to $100. No platform usage cap applies.',
    );
  });
});
