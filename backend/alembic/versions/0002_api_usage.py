"""Add api_usage for per-owner Anthropic token accounting

Revision ID: 0002_api_usage
Revises: 0001_initial
Create Date: 2026-08-02

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_api_usage"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "api_usage",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        # Nullable with ON DELETE SET NULL so deleting content does not erase
        # the billing record it produced.
        sa.Column("questionnaire_id", sa.Uuid(), nullable=True),
        sa.Column("response_id", sa.Uuid(), nullable=True),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name="fk_api_usage_owner_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["questionnaire_id"],
            ["questionnaires.id"],
            name="fk_api_usage_questionnaire_id_questionnaires",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["response_id"],
            ["responses.id"],
            name="fk_api_usage_response_id_responses",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_api_usage"),
    )
    op.create_index("ix_api_usage_owner_id", "api_usage", ["owner_id"], unique=False)
    op.create_index(
        "ix_api_usage_questionnaire_id", "api_usage", ["questionnaire_id"], unique=False
    )
    op.create_index("ix_api_usage_response_id", "api_usage", ["response_id"], unique=False)
    op.create_index("ix_api_usage_created_at", "api_usage", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_api_usage_created_at", table_name="api_usage")
    op.drop_index("ix_api_usage_response_id", table_name="api_usage")
    op.drop_index("ix_api_usage_questionnaire_id", table_name="api_usage")
    op.drop_index("ix_api_usage_owner_id", table_name="api_usage")
    op.drop_table("api_usage")
