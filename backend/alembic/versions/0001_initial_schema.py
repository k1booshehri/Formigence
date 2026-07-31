"""Initial schema: users, otp_codes, refresh_tokens, questionnaires, responses

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-31

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RESPONSE_STATUS = sa.Enum(
    "pending",
    "processing",
    "complete",
    "failed",
    name="response_status",
)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "otp_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_otp_codes_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_otp_codes"),
    )
    op.create_index("ix_otp_codes_user_id", "otp_codes", ["user_id"], unique=False)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_refresh_tokens_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_refresh_tokens"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"], unique=False)
    op.create_index("ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"], unique=True)

    op.create_table(
        "questionnaires",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("schema", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("analysis_guide", sa.Text(), nullable=False),
        sa.Column("public_slug", sa.String(length=120), nullable=True),
        sa.Column("is_published", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name="fk_questionnaires_owner_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_questionnaires"),
    )
    op.create_index("ix_questionnaires_owner_id", "questionnaires", ["owner_id"], unique=False)
    op.create_index("ix_questionnaires_public_slug", "questionnaires", ["public_slug"], unique=True)

    op.create_table(
        "responses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("questionnaire_id", sa.Uuid(), nullable=False),
        sa.Column("answers", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("ai_result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", RESPONSE_STATUS, server_default="pending", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["questionnaire_id"],
            ["questionnaires.id"],
            name="fk_responses_questionnaire_id_questionnaires",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_responses"),
    )
    op.create_index(
        "ix_responses_questionnaire_id", "responses", ["questionnaire_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_responses_questionnaire_id", table_name="responses")
    op.drop_table("responses")
    RESPONSE_STATUS.drop(op.get_bind(), checkfirst=True)

    op.drop_index("ix_questionnaires_public_slug", table_name="questionnaires")
    op.drop_index("ix_questionnaires_owner_id", table_name="questionnaires")
    op.drop_table("questionnaires")

    op.drop_index("ix_refresh_tokens_token_hash", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")

    op.drop_index("ix_otp_codes_user_id", table_name="otp_codes")
    op.drop_table("otp_codes")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
