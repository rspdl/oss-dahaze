# dahaze API 이미지.
#
# 빌드 컨텍스트는 **저장소 루트**다 (`docker build -f apps/api/Dockerfile .`).
#
# 베이스는 debian(glibc)이어야 한다. RSPDL 은 manylinux_2_28 wheel 만 배포하고 musl 용을
# 만들지 않으므로 **Alpine 에서는 설치 자체가 실패한다.** 같은 이유로 아키텍처는 x86_64 여야
# 한다 — linux aarch64 wheel 도 sdist 도 없어서 소스 빌드로 넘어가지도 못한다 (ADR-0002).

FROM python:3.12-slim-bookworm AS builder

# uv 는 pip 보다 빠르고, 무엇보다 `--locked` 로 락파일이 실제로 고정된 상태인지 검증한다.
COPY --from=ghcr.io/astral-sh/uv:0.9.30 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# 의존성만 먼저 설치해 레이어를 캐시한다. 소스가 바뀌어도 27MB 네이티브 확장을
# 다시 받지 않는다.
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --locked --no-install-project --no-dev

COPY apps/api/src ./src
COPY apps/api/alembic ./alembic
COPY apps/api/alembic.ini ./
RUN uv sync --locked --no-dev


FROM python:3.12-slim-bookworm AS runtime

# 컨테이너를 root 로 돌리지 않는다. 코드 실행 취약점이 나와도 권한이 남지 않게 한다.
RUN groupadd --system --gid 10001 dahaze \
 && useradd --system --uid 10001 --gid dahaze --no-create-home dahaze

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY --from=builder --chown=root:root /app/.venv ./.venv
COPY --from=builder --chown=root:root /app/src ./src
COPY --from=builder --chown=root:root /app/alembic ./alembic
COPY --from=builder --chown=root:root /app/alembic.ini ./

# 네이티브 확장이 이 플랫폼에서 실제로 열리는지 빌드 시점에 확인한다. 여기서 걸리면
# 배포 후 첫 요청이 아니라 이미지 빌드에서 멈춘다.
RUN python -c "import rspdl; print('rspdl', rspdl.__version__, 'wire', rspdl.WIRE_SCHEMA_VERSION)"

USER dahaze

EXPOSE 8400

# PORT 를 셸이 확장해야 하므로 exec 형식 대신 sh -c 를 쓴다.
CMD ["sh", "-c", "uvicorn dahaze_api.main:app --host 0.0.0.0 --port ${PORT:-8400}"]
