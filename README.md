# Formigence

An AI-powered assessment platform. Business owners build custom questionnaires,
pair each with a private free-text *analysis guide*, and share a public link.
Respondents answer through that link; their answers plus the guide go to the
Anthropic API, which returns a structured recommendation.

Built so far: passwordless auth, questionnaire CRUD, the public read and submit
endpoints, and the background analysis pipeline with per-owner token accounting.
Payments, the builder UI, and a durable job queue are not built — see
[What is not built](#what-is-not-built).

---

## Stack

| Layer     | Choices |
|-----------|---------|
| Backend   | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.0 (async), Alembic, PostgreSQL 16, asyncpg |
| Auth      | Email OTP (passwordless) → short-lived JWT access token + DB-backed rotating refresh token |
| Analysis  | Anthropic Python SDK (async), forced tool call for structured output, FastAPI `BackgroundTasks` |
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
cp .env.example .env          # then edit SECRET_KEY and ANTHROPIC_API_KEY
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

`ANTHROPIC_API_KEY` is needed only to run analysis for real. Everything else —
including the whole test suite — works without it; a submission simply ends up
`failed` when the key is missing.

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

## Submitting a response during development

With a published questionnaire (slug from `POST /questionnaires/{id}/publish`):

```bash
curl -sS -X POST localhost:8000/public/questionnaires/$SLUG/responses \
  -H 'content-type: application/json' \
  -d '{"answers": {"channels": ["Online"], "pricing": 3, "blocker": "Hiring."}}'
# -> 202 {"response_id": "...", "status": "pending"}

curl -sS localhost:8000/public/responses/$RESPONSE_ID
# -> {"status": "complete", "result": {"recommendation": "...", ...}}
```

`CAPTCHA_ENABLED=false` in dev, so no `captcha_token` is required. Analysis runs
in the background, so the first poll may still report `pending` or `processing`.

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
| `GET`  | `/questionnaires/{id}/responses` | Bearer | Paginated (`limit`, `offset`), newest first. Each row carries `submitted_at`, `status`, a truncated `recommendation_summary`, and `confidence`. |
| `GET`  | `/questionnaires/{id}/responses/{response_id}` | Bearer | Full answers plus the complete `ai_result`. |
| `GET`  | `/public/questionnaires/{slug}` | — | Published questionnaires only. **Never returns `analysis_guide`.** |
| `POST` | `/public/questionnaires/{slug}/responses` | — | Validates answers against the schema, stores them, returns **202** with `{response_id}`, and kicks off analysis in the background. Rate limited per IP more strictly than the auth endpoints. |
| `GET`  | `/public/responses/{response_id}` | — | Polling. Returns `{status, result}` and nothing else. |
| `GET`  | `/health` | — | Liveness probe. |

Owner-scoped routes return **404, not 403**, for a questionnaire belonging to
someone else — a 403 would confirm that the id is real.

`GET /public/responses/{response_id}` has no auth: the id is a uuid4 acting as
an unguessable bearer token. It is treated accordingly — the response model
carries only `status` and `result`, so neither the submitted answers nor the
owner's analysis guide can leak through it.

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

### Answers

Submitted answers are checked against that schema before anything is stored.
Every question is required — the question types have no `optional` flag — and
each type has one accepted shape:

| Type | Accepted answer |
|------|-----------------|
| `multiple_choice`, `allow_multiple: false` | A string that is one of `options` |
| `multiple_choice`, `allow_multiple: true` | A non-empty list of distinct strings, each in `options`. Stored in questionnaire order, not submission order. |
| `scale` | An integer within `[min, max]`. Booleans are rejected — `True` would otherwise pass as `1`. |
| `short_text` | Non-empty text within `max_length` (5000 if the question sets none) |

Unknown question ids are rejected. Every problem in a submission is reported at
once rather than one per round trip:

```json
{ "error": { "code": "invalid_answers", "message": "Answers do not match the questionnaire",
  "details": [ { "question_id": "pricing", "message": "must be between 1 and 5" } ] } }
```

---

## The analysis pipeline

Submitting answers returns 202 immediately; the Anthropic call runs in a
FastAPI `BackgroundTask`. The work itself lives in
`run_analysis_for_response()` — a plain async function taking a session factory
and an analyzer — so moving to a real queue means calling it from a worker
instead of from the request, with no changes to the function.

1. The response row is created `pending`.
2. The pipeline claims it by moving `pending → processing`. Only `pending` rows
   are claimed, so a duplicate dispatch is a no-op rather than a second billed
   call.
3. On success `ai_result` is written and the status becomes `complete`; on
   failure, `failed`. The transition is wrapped in `try/finally` **with its own
   session**, so a row is never stranded in `processing` — not even if the
   analysis session is poisoned.

### Structured output

One tool, `submit_recommendation`, with `tool_choice` set to require it. Its
input is then validated with Pydantic, so `ai_result` is always
`{recommendation, reasoning, confidence}` with `confidence` in
`low|medium|high`, or the attempt is treated as failed.

### Prompt construction is a security boundary

Respondents are anonymous, and their free-text answers end up in a model
prompt. `app/services/prompt.py` is written to contain that:

- **The system prompt is a fixed template we control.** It carries the owner's
  analysis guide under a labeled `<analysis_guide>` section and states that the
  answers block is untrusted data — material to analyze, never instructions to
  follow — along with an explicit rule not to reveal the guide.
- **The user message** carries the questionnaire and answers as labeled data
  inside `<respondent_answers>` delimiters.
- **Untrusted text is defused first.** Any attempt to open or close one of the
  structural tags from inside an answer is rewritten before interpolation, so a
  respondent cannot close our envelope and start a section of their own.
  Ordinary angle brackets in prose are left alone.

Moving the guide out of the system prompt, dropping the delimiters, or
interpolating raw answers would each reopen the hole. Treat edits to that module
as security changes; `tests/test_analysis.py` asserts each of these properties.

### Retries

Rate limits, 5xx responses, connection errors, and a missing or malformed tool
call are retried with exponential backoff and jitter (`Retry-After` is honoured
when present) up to `ANALYSIS_MAX_RETRIES` times. 4xx responses and model
refusals fail immediately — retrying those only spends more tokens. The SDK
client is constructed with `max_retries=0` so the two layers don't multiply.

### Usage logging

One `api_usage` row per API call, written **in its own transaction** — including
calls that were retried or ultimately failed, because the tokens were spent
either way. Rows record the owner, questionnaire, response, model, and input and
output token counts.

---

## Layout

```
backend/
  app/
    api/        routers: auth, me, questionnaires, responses, public
    core/       config, security, db, deps, errors, rate limiting
    models/     SQLAlchemy models
    schemas/    Pydantic request/response models
    services/   auth, questionnaire, response, answers, prompt, analysis,
                captcha, email
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
  nullable), `status` (`pending`/`processing`/`complete`/`failed`), timestamps
- **api_usage** — `owner_id`, `questionnaire_id`, `response_id`, `model`,
  `input_tokens`, `output_tokens`, `created_at`. The questionnaire and response
  references are nullable with `ON DELETE SET NULL`, so deleting content does
  not erase the billing record it produced; `owner_id` cascades.

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
- **`ANTHROPIC_MODEL` is pinned, not tracking an alias.** The default is
  `claude-sonnet-4-6`. Note that `claude-sonnet-5` is now the current-generation
  Sonnet — switching is a config change, but its API surface differs (adaptive
  thinking is on by default and non-default sampling parameters are rejected),
  so re-run the suite after changing it.
- **No `strict: true` on the tool definition.** Strict tool use is not
  documented as supported on `claude-sonnet-4-6`, so the guarantee comes from
  forced `tool_choice` plus Pydantic validation of the tool input instead. On a
  model that supports it, adding `strict` would be a belt-and-braces improvement.
- **Background tasks run before the test client returns.** Starlette awaits a
  response's background tasks before the ASGI call completes, and httpx's
  `ASGITransport` awaits that call — so the tests observe finished analysis
  without sleeping or polling.
- **Prompt caching is not used.** The system prompt varies per questionnaire
  (it embeds the guide) and is well under the cacheable minimum, so there is
  nothing to reuse. Worth revisiting if guides grow or a single questionnaire
  starts seeing sustained traffic.

---

## What is not built

Out of scope for this milestone, by design:

- Payments
- The frontend questionnaire builder UI. The Vite scaffold from the previous
  milestone is untouched, so its API client does not yet know about responses.
- A real job queue. Analysis runs in FastAPI `BackgroundTasks`, which means
  in-flight work is lost if the process restarts and there is no retry across
  restarts. `run_analysis_for_response()` is already shaped to be called from a
  worker — see [The analysis pipeline](#the-analysis-pipeline).
- A real email provider (`EmailSender` is a Protocol; only the console
  implementation exists)
- A real CAPTCHA deployment. The hook and a Turnstile verifier exist behind
  `CAPTCHA_ENABLED`, which is off in dev; no site key is wired into a frontend.

---

## Verification status

The environment this was built in blocks outbound access to `pypi.org` and
`registry.npmjs.org` at the network-policy level (`403`,
`x-deny-reason: host_not_allowed`), so project dependencies could not be
installed here — in this milestone as in the previous one. What that means
concretely:

| Check | Status |
|-------|--------|
| `ruff check .` | **Passes** (ruff runs standalone from a local cache) |
| `ruff format --check .` | **Passes** |
| Byte-compilation of all backend sources | **Passes** |
| `mypy` | **Not run as configured.** Without pydantic installed the plugin cannot load. A plugin-less `--strict` run over 53 files reports only `Class cannot subclass "X" (has type "Any")` and `Returning Any` — every one an artifact of the absent packages, none an internal type error. |
| `pytest` | **Not run.** Requires fastapi/sqlalchemy/asyncpg/anthropic. |
| `pnpm lint` / `pnpm typecheck` | **Not run.** `pnpm install` fails with `ERR_PNPM_FETCH_403`. |

Run the [Checks](#4-checks) section on a machine with normal registry access to
confirm. Treat the test suite as unverified until then.

The suite never contacts the Anthropic API: `tests/fakes.py` supplies a
`FakeAnalyzer` for pipeline and endpoint tests and a `FakeAnthropicClient` that
scripts the SDK surface for tests of the real analyzer, including prompt
assembly and retry behaviour. Running `pytest` therefore needs a database but
not an `ANTHROPIC_API_KEY`.
