"""add planning metadata revision token

Revision ID: 5f9d2c4a7b1e
Revises: c93d7a6f20b1
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "5f9d2c4a7b1e"
down_revision: str | Sequence[str] | None = "c93d7a6f20b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "planning_states",
        sa.Column("metadata_revision", sa.Integer(), server_default="0", nullable=False),
    )
    op.execute(
        sa.text(
            "UPDATE planning_states AS state SET metadata_revision = ("
            "SELECT count(*) FROM planning_metadata_revisions AS history "
            "WHERE history.project_id = state.project_id)"
        )
    )


def downgrade() -> None:
    op.drop_column("planning_states", "metadata_revision")
