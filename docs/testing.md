# Testing and Validation

Use the narrowest command that can answer the question while developing. Save full regression runs for final validation or changes that touch shared contracts.

## Narrow Test Commands

Backend single test case:

```bash
cd backend
python3 -m pytest -q -x tests/services/test_assumptions_service.py::test_normalize_missing_value_coerces_placeholder_tokens
```

Backend single test file:

```bash
cd backend
python3 -m pytest -q -x tests/services/test_assumptions_service.py
```

Backend unit-focused subset:

```bash
cd backend
python3 -m pytest -q -x tests/services tests/assessments tests/adapters tests/resources tests/capabilities tests/plans tests/test_permissions.py
```

Frontend single test case:

```bash
cd frontend
npm test -- --runInBand --silent --bail src/__tests__/components/ui/Button.test.tsx -t "renders"
```

Frontend single test file:

```bash
cd frontend
npm test -- --runInBand --silent --bail src/__tests__/components/ui/Button.test.tsx
```

Frontend unit tests:

```bash
cd frontend
npm test -- --runInBand --silent --bail
```

## Quiet AI-Friendly Wrappers

The root wrappers print a short success line. On failure, they print only the first relevant failure block and save the full log to ignored `.test-output/`.

```bash
npm run test:backend:quiet -- tests/services/test_assumptions_service.py
npm run test:frontend:quiet -- src/__tests__/components/ui/Button.test.tsx
npm run test:quiet
```

## Fast Validation

Backend:

```bash
cd backend
ruff check .
ruff format --check .
python3 -m pytest -q -x <path-or-nodeid>
```

Frontend:

```bash
cd frontend
npm run typecheck
npm run lint
npm test -- --runInBand --silent --bail <path> -t "<test name>"
```

The frontend does not currently have a dedicated formatter check script. Use lint/typecheck for fast validation unless a formatter is added to the frontend toolchain.

## Cursor / agent hygiene (token-safe audits)

Prefer these over improvised `find .` / root-level `grep`:

```bash
npm run cursor:audit          # concise stdout; details under .test-output/
npm run scan:repo             # largest tracked files + risky script patterns (capped)
npm run scan:largest          # largest tracked files + selected `du` summary
scripts/safe_search.sh 'pattern' -- frontend/src
```

Backend CI keeps coverage enforcement but emits a **short terminal summary** plus `coverage.xml`; open the XML or HTML report locally when you need line-level misses.

**Optional local-only:** if dependency work is idle, you may add `frontend/package-lock.json` to a **personal** Cursor ignore overlay—never commit that ignore without team agreement, since lockfile reviews are important during npm upgrades.

## Full Regression

These are **final validation**, not the default iteration loop (see `AGENTS.md`).

Backend:

```bash
cd backend
python3 -m pytest tests/ -q
```

Frontend:

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:coverage
npm run build
```

## Test Suite Audit Recommendations

Do not delete tests from this list without a separate cleanup PR. These are candidates for consolidation or hardening:

- `frontend/src/__tests__/components/widgets/LCOEInputsWidget.test.tsx` and `frontend/src/__tests__/components/widgets/CarbonInputsWidget.test.tsx` duplicate the same "validated values" and "investigate event" behaviors across model-specific widgets. Consider extracting shared widget behavior tests or a table-driven helper once the widget contract is stable.
- Several widget tests depend on hover plus `waitFor` for simple event dispatches. Prefer `findBy*` only for async UI appearance and direct assertions for synchronous state to reduce flake risk and output noise.
- `frontend/src/__tests__/components/assessments/AssessmentWorkspace.test.tsx` is a broad component test with many `waitFor` assertions. Consider splitting the most important flows into smaller focused tests before adding more cases.
- `backend/tests/api/test_chat_stream.py` repeats a large mocked app setup across streaming scenarios. Consider a local fixture or helper factory before adding additional chat stream cases.
- Registry and contract tests are valuable but overlap across adapters, resources, capabilities, MCP, and manifests. Keep the subset-style checks, but avoid adding exact full-set equality tests that churn whenever capabilities change.
- `backend/tests/services/test_assumptions_service.py` is a high-value but dense service test file. Future additions should favor focused files by behavior area if the file keeps growing.
