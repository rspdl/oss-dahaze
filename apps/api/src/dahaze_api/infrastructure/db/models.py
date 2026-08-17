"""SQLAlchemy ORM 매핑.

스키마는 RSPDL 문법을 전혀 모른다 (ADR-0003). 문법이 바뀌어도 이 테이블들은 그대로다.
컴파일 결과는 `compilations` 하나에 불투명한 JSONB 로만 들어간다.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Postgres 에서는 JSONB, 그 외(테스트용 SQLite 등)에서는 JSON 으로 떨어진다.
JsonB = JSONB().with_variant(JSON(), "sqlite")
Uuid = PgUUID(as_uuid=True).with_variant(String(36), "sqlite")


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class UserRow(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    avatar_url: Mapped[str | None] = mapped_column(Text)

    identities: Mapped[list[UserIdentityRow]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserIdentityRow(TimestampMixin, Base):
    """외부 제공자 신원. 벤더를 추가해도 `users` 는 바뀌지 않는다."""

    __tablename__ = "user_identities"
    __table_args__ = (
        # 같은 제공자의 같은 계정이 두 사용자에 붙지 않게 한다.
        UniqueConstraint("provider", "provider_user_id", name="uq_identity_provider_subject"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    provider_user_id: Mapped[str] = mapped_column(String(200), nullable=False)
    login: Mapped[str] = mapped_column(String(200), nullable=False)

    user: Mapped[UserRow] = relationship(back_populates="identities")


class ProjectRow(TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("slug", name="uq_project_slug"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # 새 문서가 기본으로 삼을 RSPDL 버전.
    default_rspdl_version: Mapped[str] = mapped_column(String(50), nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    members: Mapped[list[ProjectMemberRow]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    documents: Mapped[list[DocumentRow]] = relationship(back_populates="project")


class ProjectMemberRow(TimestampMixin, Base):
    """소유자도 여기 `owner` 역할로 들어간다.

    별도의 `owner_id` 칼럼을 두지 않는 이유: 접근 검사가 "소유자거나 멤버" 로 갈라지면
    그 분기가 모든 질의에 퍼지고, 그중 하나는 반드시 빠뜨린다.
    """

    __tablename__ = "project_members"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_member_project_user"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)

    project: Mapped[ProjectRow] = relationship(back_populates="members")


class DocumentRow(TimestampMixin, Base):
    __tablename__ = "documents"
    __table_args__ = (
        # 살아 있는 문서끼리만 경로가 겹치지 않으면 된다. 삭제된 문서의 경로는
        # 재사용할 수 있어야 하므로 부분 유니크 인덱스를 쓴다.
        Index(
            "uq_document_project_path_alive",
            "project_id",
            "path",
            unique=True,
            postgresql_where="deleted_at IS NULL",
            sqlite_where="deleted_at IS NULL",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    project_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # 진실. 이 컬럼만 재생성할 수 없다.
    text: Mapped[str] = mapped_column(Text, nullable=False)
    target_rspdl_version: Mapped[str] = mapped_column(String(50), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped[ProjectRow] = relationship(back_populates="documents")
    revisions: Mapped[list[DocumentRevisionRow]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class DocumentRevisionRow(TimestampMixin, Base):
    """편집 이력. diff 가 아니라 전문을 보관한다 (domain/entities.py 참조)."""

    __tablename__ = "document_revisions"
    __table_args__ = (
        UniqueConstraint("document_id", "revision_no", name="uq_revision_document_no"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    document_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    target_rspdl_version: Mapped[str] = mapped_column(String(50), nullable=False)
    # 작성자가 지워져도 이력은 남는다.
    author_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    summary: Mapped[str | None] = mapped_column(Text)

    document: Mapped[DocumentRow] = relationship(back_populates="revisions")


class CompilationRow(Base):
    """컴파일 결과 캐시.

    **이 테이블은 통째로 비워도 데이터 손실이 아니다** (ADR-0003). 전부 컴파일러로
    재생성할 수 있다. `rspdl_version` 이 캐시 키에 들어가므로 버전을 올리면 자연히
    무효가 되고, 별도의 무효화 로직이 없다.
    """

    __tablename__ = "compilations"

    # 애플리케이션이 계산한 결정적 해시가 곧 기본키다.
    cache_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    rspdl_version: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    wire_schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    locale: Mapped[str] = mapped_column(String(20), nullable=False)
    # SDK 응답 원본. 래퍼가 필드를 재작성하지 않는다.
    result: Mapped[dict[str, object]] = mapped_column(JsonB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # 오래된 항목을 정리할 때 쓴다. 갱신은 best-effort 다.
    last_accessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    hits: Mapped[int] = mapped_column(BigInteger, server_default="0", nullable=False)
