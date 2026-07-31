# Formigence

An AI-powered assessment platform. Business owners build custom questionnaires,
pair each with a private free-text *analysis guide*, and share a public link.
Respondents' answers plus that guide will later be sent to the Anthropic API for
a structured recommendation.

**This milestone is the foundation only.** Response submission, the Anthropic
integration, and payments are deliberately not built. See
[What is not built](#what-is-not-built).

---

## Stack

| Layer     | Choices |
|-----------|---------|
| Backend   | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.0 (async), Alembic, PostgreSQL 16, asyncpg |
| Auth      | Email OTP (passwordless) → short-lived JWT access token + DB-backed rotating refresh token |
| Frontend  | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router (scaffold only) |
| Tooling   | uv, ruff, mypy, pytest; pnpm, eslint, tsc; Docker Compose for local Postgres |

---

## Setup

### 1. Postgres

```bash
docker compose up -d postgres
```

Defaults to `formigence:formigence@localhost:5432/formigence`. Override with
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` in your
environment before running compose.

### 2. Backend

```bash
cd backend
cp .env.example .env          # then edit SECRET_KEY at minimum
uv sync                       # creates .venv and installs deps (incl. dev group)
uv run alembic upgrade head   # apply migrations
uv run uvicorn app.main:app --reload
```

The API is then on <http://localhost:8000>, with interactive docs at
<http://localhost:8000/docs>.

Generate a real secret key with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
pnpm install
pnpm dev                      # http://localhost:5173
```

### 4. Checks

```bash
# backend
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy app tests
uv run pytest

# frontend
cd frontend
pnpm lint
pnpm typecheck
```

`pytest` creates and manages its own database (`TEST_DATABASE_URL`, default
`formigence_test`); it never touches the development database.

---

## Signing in during development

`EMAIL_BACKEND=console` writes the OTP to the application log instead of sending
mail. So:

1. `POST /auth/request-otp {"email": "you@example.com"}`
2. Read the six-digit code out of the uvicorn console.
3. `POST /auth/verify-otp {"email": "you@example.com", "code": "123456"}`

The frontend scaffold at <http://localhost:5173> walks through exactly this and
then calls `/me` and `/questionnaires` with the resulting token, which is what
makes it a proof that the API client works.

---

## API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/auth/request-otp` | — | Creates the user if new. **Always 200**, so the endpoint cannot be used to enumerate accounts. Rate limited per IP and per email. |
| `POST` | `/auth/verify-otp` | — | Returns an access + refresh token pair. Codes are single-use, expire in 10 minutes, and allow 5 attempts. Rate limited. |
| `POST` | `/auth/refresh` | — | Rotates: the presented refresh token is revoked and a new pair issued. |
| `GET`  | `/me` | Bearer | The authenticated user. |
| `POST` | `/questionnaires` | Bearer | Validates the question schema on write. |
| `GET`  | `/questionnaires` | Bearer | The caller's questionnaires only. |
| `GET`  | `/questionnaires/{id}` | Bearer | |
| `PATCH`| `/questionnaires/{id}` | Bearer | Only the keys present in the body are applied. |
| `DELETE`| `/questionnaires/{id}` | Bearer | 204. |
| `POST` | `/questionnaires/{id}/publish` | Bearer | Sets `is_published`, allocating a slug if there isn't one. |
| `GET`  | `/public/questionnaires/{slug}` | — | Published questionnaires only. **Never returns `analysis_guide`.** |
| `GET`  | `/health` | — | Liveness probe. |

Owner-scoped routes return **404, not 403**, for a questionnaire belonging to
someone else — a 403 would confirm that the id is real.

### Error shape

Every error, including validation failures and rate limits, uses one envelope:

```json
{ "error": { "code": "questionnaire_not_found", "message": "Questionnaire not found", "details": null } }
```

### Question schema

The `schema` field is a list of questions validated against a strict Pydantic
discriminated union on `type`. Unknown keys are rejected, ids must be unique and
URL-safe, and a scale's `max` must exceed its `min`.

```jsonc
[
  { "id": "channels", "type": "multiple_choice", "prompt": "Where do you sell?",
    "options": ["Retail", "Online"], "allow_multiple": true },
  { "id": "pricing", "type": "scale", "prompt": "Confidence in pricing?",
    "min": 1, "max": 5, "min_label": "Low", "max_label": "High" },
  { "id": "blocker", "type": "short_text", "prompt": "Biggest bottleneck?",
    "max_length": 500 }
]
```

---

## Layout

```
backend/
  app/
    api/        routers: auth, me, questionnaires, public
    core/       config, security, db, deps, errors, rate limiting
    models/     SQLAlchemy models
    schemas/    Pydantic request/response models
    services/   auth, questionnaire, email
  alembic/      migration environment + versions
  tests/
frontend/       Vite React-TS scaffold
docker-compose.yml
```

### Data model

- **users** — `id`, `email` (unique, stored lowercase), `created_at`
- **otp_codes** — `user_id`, `code_hash` (argon2), `expires_at`, `consumed_at`,
  `attempts`, `created_at`
- **refresh_tokens** — `user_id`, `token_hash` (SHA-256), `expires_at`,
  `revoked_at`, `created_at`
- **questionnaires** — `owner_id`, `title`, `description`, `schema` (JSONB),
  `analysis_guide`, `public_slug` (unique), `is_published`, timestamps
- **responses** — `questionnaire_id`, `answers` (JSONB), `ai_result` (JSONB,
  nullable), `status` (`pending`/`processing`/`complete`/`failed`), timestamps.
  Created now so the migration history is complete; **no endpoints touch it yet.**

---

## Design notes

- **Refresh tokens are opaque, stored, and rotating.** They are 256-bit random
  strings, not JWTs — every use hits the database anyway, so being
  self-describing would buy nothing and would cost revocability. Only a SHA-256
  digest is stored (high-entropy secrets do not need a slow hash, and the digest
  stays directly indexable). Replaying an already-rotated token revokes that
  user's whole token family on the assumption it leaked.
- **OTP codes get argon2**, because six digits is low entropy. The 5-attempt cap
  is the complementary defence; hitting it burns the code.
- **`analysis_guide` is excluded structurally**, not by hand-filtering: the public
  route's response model simply has no such field.
- **Rate limiting** is per-IP (slowapi decorators) *and* per-email (the `limits`
  primitives called directly from the route, since the key lives in the request
  body). Both use in-process memory storage, which is correct for one worker;
  a multi-worker deployment should switch to the Redis backend — configuration,
  not code.
- **The Pydantic field is `questions`, aliased to `schema`** on the wire and in
  the column. A field literally named `schema` would shadow `BaseModel.schema`
  and fail at class construction, so the alias keeps the API and column names
  intact without the collision.
- **Tests build the schema with `create_all`**, not by running migrations, for
  speed. The migration is hand-written to mirror the models; if you change a
  model, update `alembic/versions/` to match.

---

## What is not built

Out of scope for this milestone, by design:

- Response submission endpoints (the table exists; nothing writes to it)
- The Anthropic API integration that turns answers + guide into a recommendation
- Payments
- Any frontend beyond the scaffold that proves the API client works
- A real email provider (`EmailSender` is a Protocol; only the console
  implementation exists)

---

## Verification status

The environment this was built in blocks outbound access to `pypi.org` and
`registry.npmjs.org` at the network-policy level (`403`,
`x-deny-reason: host_not_allowed`), so project dependencies could not be
installed here. What that means concretely:

| Check | Status |
|-------|--------|
| `ruff check .` | **Passes** (ruff runs standalone) |
| `ruff format --check .` | **Passes** |
| Byte-compilation of all backend sources | **Passes** |
| `mypy` | **Not run as configured.** Without pydantic installed the plugin cannot load. A plugin-less `--strict` run reports only `Class cannot subclass "BaseModel" (has type "Any")` and `Returning Any` — every one an artifact of the absent packages, none an internal type error. |
| `pytest` | **Not run.** Requires fastapi/sqlalchemy/asyncpg. |
| `pnpm lint` / `pnpm typecheck` | **Not run.** `pnpm install` fails with `ERR_PNPM_FETCH_403`. |

Run the [Checks](#4-checks) section on a machine with normal registry access to
confirm. Treat the test suite and the frontend build as unverified until then.
