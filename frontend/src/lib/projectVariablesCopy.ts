/** User-facing terminology for structured project parameters (API/models still use "assumption"). */
export const PROJECT_VARIABLES = {
  title: 'Variables',
  titleSingular: 'Variable',
  lower: 'variables',
  lowerSingular: 'variable',
} as const;

export function projectVariableTitle(count = 2): string {
  return count === 1 ? PROJECT_VARIABLES.titleSingular : PROJECT_VARIABLES.title;
}

export function projectVariableLower(count = 2): string {
  return count === 1 ? PROJECT_VARIABLES.lowerSingular : PROJECT_VARIABLES.lower;
}
