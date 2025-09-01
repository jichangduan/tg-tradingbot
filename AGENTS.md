# Repository Guidelines

## Project Structure & Module Organization
- Source: `src/` with key areas — `bot/` (handlers, utils), `services/`, `config/`, `types/`, `utils/`.
- Tests: `tests/` mirrors source (e.g., `tests/handlers`, `tests/services`).
- Builds: compiled output in `dist/`. Environment files: `.env`, `.env.example`.

Example layout:
```
src/
  bot/{handlers,utils}  services/  config/  types/  utils/
```

## Build, Test, and Development Commands
- `npm run dev`: Run locally with `ts-node` (uses path aliases).
- `npm run build`: TypeScript compile to `dist/` via `tsc`.
- `npm start`: Start compiled bot (`node dist/index.js`).
- `npm test`: Run Jest tests with coverage.
- `npm run test:watch`: Jest watch mode.
- `npm run lint`: ESLint over `src/**/*.ts`.
- `npm run format`: Prettier format `src/**/*.ts`.
- `npm run clean`: Remove `dist/`.

## Coding Style & Naming Conventions
- Style: 2-space indent, single quotes, semicolons, max width 100 (see `.prettierrc`).
- Lint: ESLint with `@typescript-eslint` rules; avoid unused vars (`_`-prefix allowed), prefer `const`, no `var`.
- File naming: handlers `*.handler.ts` (e.g., `price.handler.ts`), services `*.service.ts`, types `*.types.ts`, utilities descriptive (e.g., `logger.ts`).
- Imports: use TS path aliases (`@/bot/*`, `@/services/*`, etc.).

## Testing Guidelines
- Framework: Jest + `ts-jest` (`tests/**/*.test.ts|spec.ts`).
- Coverage: Targets (global) Lines/Funcs ~80%, Branches ~70 (see `jest.config.js`).
- Write unit tests close to feature folders under `tests/…` with clear names, e.g., `price.handler.test.ts`.
- Run locally: `npm test` or `npm run test:watch`.

## Commit & Pull Request Guidelines
- Commits: short, imperative, scoped when helpful.
  - Examples: `add price handler`, `fix cache TTL logic`, `docs: update README`.
- PRs: include purpose, linked issues, test evidence (logs or screenshots for bot replies), and config notes if envs change.
- Checks: ensure `npm run lint`, `npm run format`, and `npm test` pass.

## Security & Configuration Tips
- Do not commit secrets. Use `.env` (copy from `.env.example`). Required: `TELEGRAM_BOT_TOKEN`; common: `API_BASE_URL`, Redis vars.
- For local dev: `NODE_ENV=development`; tests set minimal env in `tests/setup.ts`.
- Validate config on boot comes from `src/config` (throws on missing/invalid values).

