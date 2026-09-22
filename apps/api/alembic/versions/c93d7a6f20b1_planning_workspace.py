"""project planning workspace

Revision ID: c93d7a6f20b1
Revises: abd2d8ea56e3
"""

import hashlib
import json
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c93d7a6f20b1"
down_revision: str | Sequence[str] | None = "abd2d8ea56e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    jsonb = postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), "sqlite")
    uuid = sa.UUID().with_variant(sa.String(36), "sqlite")
    op.add_column(
        "projects", sa.Column("revision", sa.Integer(), server_default="0", nullable=False)
    )
    op.add_column("projects", sa.Column("source_hash", sa.String(64), nullable=True))
    op.add_column(
        "projects", sa.Column("snapshot_version", sa.Integer(), server_default="0", nullable=False)
    )
    # project_source_hash([]): existing projects are recomputed below when documents exist.
    empty_hash = "e169ad98741711c6429bcbe57ad1987fa4a70c7a69d57ddd09a802547be685ef"
    op.execute(sa.text("UPDATE projects SET source_hash = :value").bindparams(value=empty_hash))
    conn = op.get_bind()
    projects = conn.execute(sa.text("SELECT id FROM projects")).all()
    for (project_id,) in projects:
        docs = conn.execute(
            sa.text(
                "SELECT path, text FROM documents WHERE project_id=:id "
                "AND deleted_at IS NULL ORDER BY path"
            ),
            {"id": project_id},
        ).all()
        payload = {"locale": "", "sources": [{"path": p, "text": t} for p, t in docs], "extra": {}}
        digest = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        conn.execute(
            sa.text("UPDATE projects SET source_hash=:hash WHERE id=:id"),
            {"hash": digest, "id": project_id},
        )
    op.alter_column("projects", "source_hash", nullable=False)

    op.create_table(
        "planning_states",
        sa.Column(
            "project_id", uuid, sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("messages", jsonb, nullable=False),
        sa.Column("decisions", jsonb, nullable=False),
        sa.Column("proposals", jsonb, nullable=False),
        sa.Column("metadata", jsonb, nullable=False),
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
    )
    op.create_table(
        "planning_drafts",
        sa.Column("id", uuid, primary_key=True),
        sa.Column(
            "project_id", uuid, sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("base_project_revision", sa.Integer(), nullable=False),
        sa.Column("base_source_hash", sa.String(64), nullable=False),
        sa.Column("changes", jsonb, nullable=False),
        sa.Column("candidate_documents", jsonb, nullable=False),
        sa.Column("candidate_source_hash", sa.String(64), nullable=False),
        sa.Column("summary", sa.Text()),
        sa.Column("rspdl_version", sa.String(50), nullable=False),
        sa.Column("wire_schema_version", sa.Integer(), nullable=False),
        sa.Column("locale", sa.String(20), nullable=False),
        sa.Column("result", jsonb),
        sa.Column("base_result", jsonb),
        sa.Column("applied_revision", sa.Integer()),
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
    )
    op.create_index("ix_planning_drafts_project_id", "planning_drafts", ["project_id"])
    op.create_table(
        "planning_metadata_revisions",
        sa.Column("id", uuid, primary_key=True),
        sa.Column(
            "project_id", uuid, sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("metadata", jsonb, nullable=False),
        sa.Column("author_id", uuid, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("summary", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("project_id", "revision", name="uq_planning_metadata_revision"),
    )
    op.create_index(
        "ix_planning_metadata_revisions_project_id", "planning_metadata_revisions", ["project_id"]
    )
    op.create_table(
        "project_snapshots",
        sa.Column("id", uuid, primary_key=True),
        sa.Column(
            "project_id", uuid, sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("snapshot_version", sa.Integer(), nullable=False),
        sa.Column("project_revision", sa.Integer(), nullable=False),
        sa.Column("planning_revision", sa.Integer(), nullable=False),
        sa.Column("source_hash", sa.String(64), nullable=False),
        sa.Column("documents", jsonb, nullable=False),
        sa.Column("planning_state", jsonb, nullable=False),
        sa.Column("rspdl_version", sa.String(50), nullable=False),
        sa.Column("wire_schema_version", sa.Integer(), nullable=False),
        sa.Column("locale", sa.String(20), nullable=False),
        sa.Column("result", jsonb),
        sa.Column("change_kind", sa.String(20), nullable=False),
        sa.Column("summary", sa.Text()),
        sa.Column("author_id", uuid, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("project_id", "snapshot_version", name="uq_snapshot_project_version"),
    )
    op.create_index("ix_project_snapshots_project_id", "project_snapshots", ["project_id"])


def downgrade() -> None:
    op.drop_table("project_snapshots")
    op.drop_table("planning_metadata_revisions")
    op.drop_table("planning_drafts")
    op.drop_table("planning_states")
    op.drop_column("projects", "source_hash")
    op.drop_column("projects", "snapshot_version")
    op.drop_column("projects", "revision")
