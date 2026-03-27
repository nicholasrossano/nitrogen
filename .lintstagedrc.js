const path = require('path');

const frontendDir = path.resolve(__dirname, 'frontend');

module.exports = {
  'frontend/src/**/*.{ts,tsx}': (absolutePaths) => {
    const fileArgs = absolutePaths
      .map((f) => path.relative(frontendDir, f))
      .map((f) => `--file "${f}"`)
      .join(' ');
    return `cd frontend && npx next lint --fix ${fileArgs}`;
  },
  'backend/**/*.py': '/Users/nicholasrossano/Library/Python/3.12/bin/ruff check --fix',
};
