import {
  ASSESSMENT_SEARCH_PARAM,
  CONTEXT_PANEL_SEARCH_PARAM,
  VARIABLE_SEARCH_PARAM,
  buildProjectWorkbenchPath,
  parseAssessmentParam,
  parseContextPanelParam,
  parseVariableParam,
} from '@/components/chat-shell/chatContextStackMotion';

describe('chatContextStackMotion URL helpers', () => {
  it('builds workbench paths with chat, panel, assessment, and variable params', () => {
    expect(buildProjectWorkbenchPath('proj-1')).toBe('/projects/proj-1');
    expect(buildProjectWorkbenchPath('proj-1', { panel: 'variables' })).toBe(
      `/projects/proj-1?${CONTEXT_PANEL_SEARCH_PARAM}=variables`,
    );
    expect(buildProjectWorkbenchPath('proj-1', {
      panel: 'assessments',
      assessment: 'inst-9',
    })).toBe(
      `/projects/proj-1?${CONTEXT_PANEL_SEARCH_PARAM}=assessments&${ASSESSMENT_SEARCH_PARAM}=inst-9`,
    );
    expect(buildProjectWorkbenchPath('proj-1', {
      chat: 'chat-2',
      assessment: 'inst-9',
    })).toBe(
      `/projects/proj-1?chat=chat-2&${ASSESSMENT_SEARCH_PARAM}=inst-9`,
    );
    expect(buildProjectWorkbenchPath('proj-1', {
      panel: 'variables',
      variable: 'var-3',
    })).toBe(
      `/projects/proj-1?${CONTEXT_PANEL_SEARCH_PARAM}=variables&${VARIABLE_SEARCH_PARAM}=var-3`,
    );
  });

  it('parses panel, assessment, and variable search params', () => {
    expect(parseContextPanelParam('variables')).toBe('variables');
    expect(parseContextPanelParam('framework')).toBe('assessments');
    expect(parseContextPanelParam('nope')).toBeNull();
    expect(parseAssessmentParam('inst-1')).toBe('inst-1');
    expect(parseAssessmentParam('  ')).toBeNull();
    expect(parseAssessmentParam(null)).toBeNull();
    expect(parseVariableParam('var-1')).toBe('var-1');
    expect(parseVariableParam('  ')).toBeNull();
    expect(parseVariableParam(null)).toBeNull();
  });
});
