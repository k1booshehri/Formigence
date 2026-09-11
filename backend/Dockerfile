# The backend as a long-running process, which is what it needs: analysis runs
# after the response is sent, so the process has to outlive the request. Works
# as-is on Fly.io, Render and Railway.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

WORKDIR /srv

# Dependencies first: this layer is rebuilt only when pyproject.toml changes.
COPY pyproject.toml ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
RUN uv pip install --system --no-cache .

RUN useradd --create-home --uid 1000 formigence
USER formigence

# Hosts assign the port; 8000 is only the local default.
ENV PORT=8000
EXPOSE 8000

# Migrations are a release step, not a start step — see the README. Running them
# here would have every instance migrate at once on a scaled deploy.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
