const path = require('path');

const frontendDir = path.resolve(__dirname, 'frontend');
const backendDir = path.resolve(__dirname, 'backend');

module.exports = {
  'frontend/src/**/*.{ts,tsx}': (absolutePaths) => {
    const fileArgs = absolutePaths
      .map((f) => path.relative(frontendDir, f))
      .map((f) => `--file "${f}"`)
      .join(' ');
    return `cd frontend && npx next lint --fix ${fileArgs}`;
  },
  'backend/**/*.py': (absolutePaths) => {
    const fileArgs = absolutePaths
      .map((f) => path.relative(backendDir, f))
      .map((f) => `"${f}"`)
      .join(' ');
    return `cd backend && python3 -m ruff check --fix ${fileArgs}`;
  },
};
