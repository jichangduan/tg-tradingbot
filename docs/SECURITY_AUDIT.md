# AIW3 TGBot — Security Audit Report

Date: 2025-09-16

## Overview
- Scope: Repository at root, including `src/`, config, Docker, tests, and docs.
- Methods: Static code review, secret scanning, config validation review, dependency inventory, handler/service logic review.

## Executive Summary
- Critical: Real secrets are committed to the repo (Telegram bot tokens, API key). Immediate rotation and history purge required.
- High: Sensitive data (including accessToken) logged at info level. Remove/redact.
- Medium: HTML injection risk in Telegram HTML replies due to unescaped user input.
- Medium: Health endpoint starts by default and exposes service details; not gated by env/secret.
- Medium: Rate limiting is referenced but not enforced; risk of abuse/DoS.
- Additional hardening: Enforce HTTPS for external APIs, reduce verbose logging in prod, add CI secret/dependency scanning.

## Findings and Remediations

### 1) Critical — Exposed Secrets in Repository
Evidence:
- `.env` contains a real `TELEGRAM_BOT_TOKEN` (file tracked in git).
- `.env ` (note trailing space) also contains a real token and other envs.
- `docs/DEPLOYMENT.md` includes a real Telegram token and `API_KEY` examples.

Impact: Leakage allows full bot takeover and backend API abuse.

Remediation:
- Immediately revoke and rotate:
  - All Telegram bot tokens present in the repo history.
  - Backend API keys (`API_KEY`) and any dependent credentials.
  - Redis password if used elsewhere.
- Remove secrets and sanitize docs:
  - Replace all real tokens/keys in docs with placeholders.
  - Ensure `.env` and any variants (e.g., `.env `) are not tracked.
- Purge repository history to remove exposed values (force push post-rotation):
  - Preferred: `git filter-repo` to remove files/lines containing secrets.
  - Alternative: BFG Repo-Cleaner.
- Strengthen ignore rules (see below) and adopt secret management in CI/CD (GitHub Secrets, Vault, etc.).

Suggested .gitignore hardening:
```
# Environment files (catch variants)
.env*
```

History purge (example with git-filter-repo):
```
pip install git-filter-repo
git filter-repo --invert-paths --path .env --path ".env " --path docs/DEPLOYMENT.md
git push --force
```

### 2) High — Sensitive Logging of Secrets/User Data
Evidence:
- `src/services/user.service.ts` logs the full user init API response at info level (includes `accessToken`, wallet, etc.).
- `src/bot/index.ts` logs Telegram token prefix on auth errors.

Impact: Secrets appear in logs, increasing blast radius if logs are accessed.

Remediation:
- Remove raw response logging or guard under debug with redaction.
- Redact keys (`accessToken`, `apiKey`, `password`, `Authorization`, `token`) before logging.
- Avoid logging any token prefix; log only a constant message (e.g., "invalid token").

### 3) Medium — HTML Injection in Telegram Replies
Evidence:
- `src/bot/handlers/price.handler.ts` interpolates raw `inputSymbol` into HTML error messages (parse_mode: 'HTML').
- `src/bot/handlers/chart.handler.ts` interpolates raw timeframe `args[1]` similarly.

Impact: User-provided content is injected into HTML; Telegram HTML is limited, but input must be treated as untrusted.

Remediation:
- Escape user inputs before embedding in HTML.
- Use `messageFormatter.escapeHtml()` and/or wrap values with `<code>…</code>`.

Example fix:
```ts
const safe = messageFormatter.escapeHtml(inputSymbol);
let errorMessage = `❌ <b>Invalid token symbol: <code>${safe}</code></b>\n\n`;
```

### 4) Medium — Health Endpoint Exposed by Default
Evidence:
- `src/index.ts` starts a health server whenever `config.app.port` is set; no `HEALTH_ENABLED` gating inside the app (Dockerfile healthcheck variable is separate). Response includes service states.

Impact: Leaks internal service status; possible target for probing.

Remediation:
- Add `healthEnabled` to config and start server only if true.
- Optionally require a bearer token header (e.g., `HEALTH_TOKEN`) in production.

### 5) Medium — Missing Rate Limiting Enforcement
Evidence:
- Middleware comments reference rate limiting, but no enforcement is implemented.

Impact: Abuse/DoS via bot commands; stress on APIs/Redis/third-party.

Remediation:
- Implement per-user and per-chat rate limiting with Redis (token bucket/leaky bucket).
- Enforce cooldowns for heavy commands (price, chart, trading actions).

### 6) Low — HTTPS Enforcement and Config Validation
Evidence:
- `validateConfig()` only checks `baseUrl` starts with `http`; allows `http://`.

Impact: Accidental non-TLS usage in prod.

Remediation:
- In production, enforce `https://` for external service URLs.

### 7) Low — Verbose Logging in Production
Evidence:
- Many info-level logs include message text, args, etc.

Remediation:
- Default to `warn` in production; move detailed request/args logging to `debug`.

### 8) Docker/Compose Secret Handling
Observation:
- docker-compose passes secrets via env (normal). Ensure CI/CD supplies these via secret stores; never commit real values.

## Dependency Review (Inventory)
- Notable packages: `axios@^1.4.0`, `express@^4.18.2`, `telegraf@^4.16.3`, `redis@^4.6.0`, `node-cron@^3.0.2`.
- Recommendation:
  - Run `npm audit` and update minor/patch releases (axios ^1.7.x, express ^4.19.x, redis ^4.7.x, etc.).
  - Add dependency scanning in CI (Dependabot, npm audit, or Snyk) and block on high/critical findings.

## Prioritized Remediation Plan
1. Rotate/revoke all exposed secrets (Telegram tokens, API keys, Redis if applicable).
2. Remove secrets from code/docs; update `.gitignore` and purge git history.
3. Redact/remove sensitive logs; sanitize logger to auto-redact common secret keys.
4. Escape user input in HTML replies (price/chart handlers and any others with `parse_mode: 'HTML'`).
5. Gate health server behind `HEALTH_ENABLED` and optional bearer token; minimize response detail.
6. Implement Redis-backed rate limiting for commands.
7. Enforce `https://` for external API URLs in production; strengthen config validation.
8. Add secret scanning (Gitleaks/TruffleHog) and dependency scanning in CI.

## Hardening Checklist
- [ ] Secrets managed via CI/CD secret store; no real secrets in repo/docs.
- [ ] Logger sanitizes secret-like keys globally.
- [ ] Rate limiting enabled and tuned.
- [ ] Health endpoint gated and minimally informative.
- [ ] HTTPS enforced for external services.
- [ ] Regular `npm audit`/Dependabot alerts addressed.
- [ ] Telegraf handlers escape any user-provided content in HTML messages.

## Evidence Index (non-sensitive)
- Secrets present:
  - `.env` (tracked) — contains real `TELEGRAM_BOT_TOKEN`.
  - `.env ` (trailing space) — contains real token and envs.
  - `docs/DEPLOYMENT.md` — includes real token and `API_KEY` values.
- Sensitive logging:
  - `src/services/user.service.ts` — logs full API response (incl. `accessToken`).
  - `src/bot/index.ts` — logs token prefix on auth error.
- HTML injection spots:
  - `src/bot/handlers/price.handler.ts` — invalid symbol message uses raw `inputSymbol`.
  - `src/bot/handlers/chart.handler.ts` — unsupported timeframe uses raw `args[1]`.
- Health server exposure:
  - `src/index.ts` — health server starts if `config.app.port` is set; not gated by `HEALTH_ENABLED` within app code.

## Appendix — Suggested Code Changes (High-level)
- Handlers (escape input):
  - Use `messageFormatter.escapeHtml()` when embedding any user-supplied values in HTML messages.
- Logging redaction:
  - Remove raw response logs in `user.service.ts` or redact; avoid logging token prefixes.
- Health server gating:
  - Add `healthEnabled` in config and check before starting; consider bearer token requirement.
- Config validation:
  - Enforce `https://` for external APIs in production.
- Git hygiene:
  - Extend `.gitignore` with `.env*`; purge history; set up pre-commit secret scans.

---

If you’d like, I can prepare focused patches to:
- Escape user input in handlers,
- Redact/remove sensitive logs,
- Gate the health server and enforce https,
- Update `.gitignore` and replace real secrets in docs with placeholders.

