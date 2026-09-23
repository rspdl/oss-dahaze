"""durable planning AI jobs

Revision ID: e713c2b1ad46
Revises: 5f9d2c4a7b1e
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "e713c2b1ad46"
down_revision: str | Sequence[str] | None = "5f9d2c4a7b1e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    jsonb = postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), "sqlite")
    uuid = sa.UUID().with_variant(sa.String(36), "sqlite")
    op.create_table(
        "planning_ai_jobs",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("project_id", uuid, sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", uuid, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("request_id", uuid, nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("request", jsonb, nullable=False),
        sa.Column("context", jsonb, nullable=False),
        sa.Column("frozen_planning_revision", sa.Integer(), nullable=False),
        sa.Column("frozen_project_revision", sa.Integer(), nullable=False),
        sa.Column("frozen_source_hash", sa.String(64), nullable=False),
        sa.Column("source_draft_id", uuid, sa.ForeignKey("planning_drafts.id", ondelete="SET NULL")),
        sa.Column("retry_of_job_id", uuid, sa.ForeignKey("planning_ai_jobs.id", ondelete="SET NULL")),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("run_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress", jsonb, nullable=False),
        sa.Column("checkpoints", jsonb, nullable=False),
        sa.Column("result", jsonb),
        sa.Column("error", jsonb),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("lease_token", uuid),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("project_id", "actor_id", "request_id", name="uq_planning_ai_job_request"),
        sa.UniqueConstraint("retry_of_job_id", name="uq_planning_ai_job_retry"),
    )
    op.create_index("ix_planning_ai_jobs_project_id", "planning_ai_jobs", ["project_id"])
    op.create_index("ix_planning_ai_jobs_actor_id", "planning_ai_jobs", ["actor_id"])
    op.create_index("ix_planning_ai_jobs_status", "planning_ai_jobs", ["status"])
    op.create_index(
        "ix_planning_ai_jobs_claim",
        "planning_ai_jobs",
        ["status", "lease_expires_at", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("planning_ai_jobs")
