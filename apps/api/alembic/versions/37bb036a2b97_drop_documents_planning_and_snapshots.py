"""drop documents planning and snapshots

옛 문서·리비전, 기획 작업공간(상태·결정·제안·변경 초안·AI 작업), 전달본 스냅샷을 삭제한다
(ADR-0008). 데이터도 함께 사라진다. downgrade 는 빈 테이블만 다시 만들고 데이터는 되살리지
못한다. 옛 데이터는 보존하지 않기로 했다.

Revision ID: 37bb036a2b97
Revises: 868db5354236
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '37bb036a2b97'
down_revision: Union[str, Sequence[str], None] = '868db5354236'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index(op.f('ix_document_revisions_document_id'), table_name='document_revisions')
    op.drop_table('document_revisions')
    op.drop_index(op.f('ix_documents_project_id'), table_name='documents')
    op.drop_index(op.f('uq_document_project_path_alive'), table_name='documents', postgresql_where='(deleted_at IS NULL)')
    op.drop_table('documents')
    op.drop_index(op.f('ix_planning_ai_jobs_actor_id'), table_name='planning_ai_jobs')
    op.drop_index(op.f('ix_planning_ai_jobs_claim'), table_name='planning_ai_jobs')
    op.drop_index(op.f('ix_planning_ai_jobs_project_id'), table_name='planning_ai_jobs')
    op.drop_index(op.f('ix_planning_ai_jobs_status'), table_name='planning_ai_jobs')
    op.drop_table('planning_ai_jobs')
    op.drop_index(op.f('ix_planning_drafts_project_id'), table_name='planning_drafts')
    op.drop_table('planning_drafts')
    op.drop_table('planning_states')
    op.drop_index(op.f('ix_planning_metadata_revisions_project_id'), table_name='planning_metadata_revisions')
    op.drop_table('planning_metadata_revisions')
    op.drop_index(op.f('ix_project_snapshots_project_id'), table_name='project_snapshots')
    op.drop_table('project_snapshots')
    op.drop_column('projects', 'snapshot_version')
    op.drop_column('projects', 'source_hash')
    op.drop_column('projects', 'revision')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('projects', sa.Column('revision', sa.INTEGER(), server_default=sa.text('0'), autoincrement=False, nullable=False))
    op.add_column('projects', sa.Column('source_hash', sa.VARCHAR(length=64), server_default='', autoincrement=False, nullable=False))
    op.add_column('projects', sa.Column('snapshot_version', sa.INTEGER(), server_default=sa.text('0'), autoincrement=False, nullable=False))
    op.create_table('documents',
        sa.Column('id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('project_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('path', sa.VARCHAR(length=500), autoincrement=False, nullable=False),
        sa.Column('title', sa.VARCHAR(length=200), autoincrement=False, nullable=False),
        sa.Column('text', sa.TEXT(), autoincrement=False, nullable=False),
        sa.Column('target_rspdl_version', sa.VARCHAR(length=50), autoincrement=False, nullable=False),
        sa.Column('deleted_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.Column('updated_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('documents_project_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('documents_pkey'))
        )
    op.create_index(op.f('uq_document_project_path_alive'), 'documents', ['project_id', 'path'], unique=True, postgresql_where='(deleted_at IS NULL)')
    op.create_index(op.f('ix_documents_project_id'), 'documents', ['project_id'], unique=False)
    op.create_table('document_revisions',
        sa.Column('id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('document_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('revision_no', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('text', sa.TEXT(), autoincrement=False, nullable=False),
        sa.Column('target_rspdl_version', sa.VARCHAR(length=50), autoincrement=False, nullable=False),
        sa.Column('author_id', sa.UUID(), autoincrement=False, nullable=True),
        sa.Column('summary', sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.Column('updated_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], name=op.f('document_revisions_author_id_fkey'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], name=op.f('document_revisions_document_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('document_revisions_pkey')),
        sa.UniqueConstraint('document_id', 'revision_no', name=op.f('uq_revision_document_no'), postgresql_include=[], postgresql_nulls_not_distinct=False)
        )
    op.create_index(op.f('ix_document_revisions_document_id'), 'document_revisions', ['document_id'], unique=False)
    op.create_table('planning_states',
        sa.Column('project_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('revision', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('messages', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('decisions', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('proposals', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.Column('updated_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.Column('metadata_revision', sa.INTEGER(), server_default=sa.text('0'), autoincrement=False, nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('planning_states_project_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('project_id', name=op.f('planning_states_pkey'))
        )
    op.create_table('planning_drafts',
        sa.Column('id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('project_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('base_project_revision', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('base_source_hash', sa.VARCHAR(length=64), autoincrement=False, nullable=False),
        sa.Column('changes', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('candidate_documents', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('candidate_source_hash', sa.VARCHAR(length=64), autoincrement=False, nullable=False),
        sa.Column('summary', sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column('rspdl_version', sa.VARCHAR(length=50), autoincrement=False, nullable=False),
        sa.Column('wire_schema_version', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('locale', sa.VARCHAR(length=20), autoincrement=False, nullable=False),
        sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=True),
        sa.Column('base_result', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=True),
        sa.Column('applied_revision', sa.INTEGER(), autoincrement=False, nullable=True),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.Column('updated_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('planning_drafts_project_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('planning_drafts_pkey'))
        )
    op.create_index(op.f('ix_planning_drafts_project_id'), 'planning_drafts', ['project_id'], unique=False)
    op.create_table('planning_ai_jobs',
        sa.Column('id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('project_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('actor_id', sa.UUID(), autoincrement=False, nullable=True),
        sa.Column('request_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('kind', sa.VARCHAR(length=20), autoincrement=False, nullable=False),
        sa.Column('status', sa.VARCHAR(length=20), autoincrement=False, nullable=False),
        sa.Column('request', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('context', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('frozen_planning_revision', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('frozen_project_revision', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('frozen_source_hash', sa.VARCHAR(length=64), autoincrement=False, nullable=False),
        sa.Column('source_draft_id', sa.UUID(), autoincrement=False, nullable=True),
        sa.Column('retry_of_job_id', sa.UUID(), autoincrement=False, nullable=True),
        sa.Column('attempt', sa.INTEGER(), server_default=sa.text('1'), autoincrement=False, nullable=False),
        sa.Column('max_attempts', sa.INTEGER(), server_default=sa.text('3'), autoincrement=False, nullable=False),
        sa.Column('run_count', sa.INTEGER(), server_default=sa.text('0'), autoincrement=False, nullable=False),
        sa.Column('progress', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('checkpoints', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=True),
        sa.Column('error', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=True),
        sa.Column('cancel_requested', sa.BOOLEAN(), server_default=sa.text('false'), autoincrement=False, nullable=False),
        sa.Column('lease_token', sa.UUID(), autoincrement=False, nullable=True),
        sa.Column('lease_expires_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True),
        sa.Column('heartbeat_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True),
        sa.Column('started_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True),
        sa.Column('finished_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.Column('updated_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('planning_ai_jobs_actor_id_fkey'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('planning_ai_jobs_project_id_fkey'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['retry_of_job_id'], ['planning_ai_jobs.id'], name=op.f('planning_ai_jobs_retry_of_job_id_fkey'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['source_draft_id'], ['planning_drafts.id'], name=op.f('planning_ai_jobs_source_draft_id_fkey'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('planning_ai_jobs_pkey')),
        sa.UniqueConstraint('project_id', 'actor_id', 'request_id', name=op.f('uq_planning_ai_job_request'), postgresql_include=[], postgresql_nulls_not_distinct=False),
        sa.UniqueConstraint('retry_of_job_id', name=op.f('uq_planning_ai_job_retry'), postgresql_include=[], postgresql_nulls_not_distinct=False)
        )
    op.create_index(op.f('ix_planning_ai_jobs_status'), 'planning_ai_jobs', ['status'], unique=False)
    op.create_index(op.f('ix_planning_ai_jobs_project_id'), 'planning_ai_jobs', ['project_id'], unique=False)
    op.create_index(op.f('ix_planning_ai_jobs_claim'), 'planning_ai_jobs', ['status', 'lease_expires_at', 'created_at'], unique=False)
    op.create_index(op.f('ix_planning_ai_jobs_actor_id'), 'planning_ai_jobs', ['actor_id'], unique=False)
    op.create_table('planning_metadata_revisions',
        sa.Column('id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('project_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('revision', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('author_id', sa.UUID(), autoincrement=False, nullable=True),
        sa.Column('summary', sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], name=op.f('planning_metadata_revisions_author_id_fkey'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('planning_metadata_revisions_project_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('planning_metadata_revisions_pkey')),
        sa.UniqueConstraint('project_id', 'revision', name=op.f('uq_planning_metadata_revision'), postgresql_include=[], postgresql_nulls_not_distinct=False)
        )
    op.create_index(op.f('ix_planning_metadata_revisions_project_id'), 'planning_metadata_revisions', ['project_id'], unique=False)
    op.create_table('project_snapshots',
        sa.Column('id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('project_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('snapshot_version', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('project_revision', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('planning_revision', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('source_hash', sa.VARCHAR(length=64), server_default='', autoincrement=False, nullable=False),
        sa.Column('documents', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('planning_state', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False),
        sa.Column('rspdl_version', sa.VARCHAR(length=50), autoincrement=False, nullable=False),
        sa.Column('wire_schema_version', sa.INTEGER(), autoincrement=False, nullable=False),
        sa.Column('locale', sa.VARCHAR(length=20), autoincrement=False, nullable=False),
        sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=True),
        sa.Column('change_kind', sa.VARCHAR(length=20), autoincrement=False, nullable=False),
        sa.Column('summary', sa.TEXT(), autoincrement=False, nullable=True),
        sa.Column('author_id', sa.UUID(), autoincrement=False, nullable=True),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], name=op.f('project_snapshots_author_id_fkey'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('project_snapshots_project_id_fkey'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('project_snapshots_pkey')),
        sa.UniqueConstraint('project_id', 'snapshot_version', name=op.f('uq_snapshot_project_version'), postgresql_include=[], postgresql_nulls_not_distinct=False)
        )
    op.create_index(op.f('ix_project_snapshots_project_id'), 'project_snapshots', ['project_id'], unique=False)
