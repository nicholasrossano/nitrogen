/**
 * Tests for type definitions
 * These tests verify that TypeScript types are correctly defined
 */

import type {
  InitiativeStage,
  WidgetType,
  MessageRole,
  Recommendation,
  InitiativeSummary,
} from '@/lib/types';

describe('Type Definitions', () => {
  describe('InitiativeStage', () => {
    it('accepts valid stage values', () => {
      const stages: InitiativeStage[] = ['intake', 'evidence', 'generate', 'complete'];
      expect(stages).toHaveLength(4);
    });
  });

  describe('WidgetType', () => {
    it('accepts valid widget type values', () => {
      const widgets: WidgetType[] = [
        'confirmation',
        'evidence_input',
        'generate_options',
        'memo_viewer',
      ];
      expect(widgets).toHaveLength(4);
    });
  });

  describe('MessageRole', () => {
    it('accepts valid message role values', () => {
      const roles: MessageRole[] = ['user', 'assistant', 'system'];
      expect(roles).toHaveLength(3);
    });
  });

  describe('Recommendation', () => {
    it('accepts valid recommendation values', () => {
      const recommendations: Recommendation[] = ['proceed', 'hold', 'reject'];
      expect(recommendations).toHaveLength(3);
    });
  });

  describe('InitiativeSummary', () => {
    it('has correct structure', () => {
      const summary: InitiativeSummary = {
        title: 'Test Initiative',
        sector: 'education',
        geography: 'Global',
        target_population: 'Students',
        goal: 'Improve learning',
        budget_range: '$50k-100k',
        timeline: '6 months',
        constraints: ['Budget', 'Time'],
      };

      expect(summary.title).toBe('Test Initiative');
      expect(summary.constraints).toHaveLength(2);
    });

    it('allows null values for optional fields', () => {
      const summary: InitiativeSummary = {
        title: null,
        sector: null,
        geography: null,
        target_population: null,
        goal: null,
        budget_range: null,
        timeline: null,
        constraints: [],
      };

      expect(summary.title).toBeNull();
      expect(summary.constraints).toEqual([]);
    });
  });
});

describe('Type Guards', () => {
  it('correctly identifies InitiativeStage values', () => {
    const isValidStage = (value: string): value is InitiativeStage => {
      return ['intake', 'evidence', 'generate', 'complete'].includes(value);
    };

    expect(isValidStage('intake')).toBe(true);
    expect(isValidStage('invalid')).toBe(false);
  });

  it('correctly identifies MessageRole values', () => {
    const isValidRole = (value: string): value is MessageRole => {
      return ['user', 'assistant', 'system'].includes(value);
    };

    expect(isValidRole('user')).toBe(true);
    expect(isValidRole('bot')).toBe(false);
  });

  it('correctly identifies Recommendation values', () => {
    const isValidRecommendation = (value: string): value is Recommendation => {
      return ['proceed', 'hold', 'reject'].includes(value);
    };

    expect(isValidRecommendation('proceed')).toBe(true);
    expect(isValidRecommendation('approve')).toBe(false);
  });
});
