"""FastAPI 애플리케이션.

이 라우터들이 API 계약의 **유일한 원본**이다. openapi.json 은 여기서 파생되고,
프론트의 훅은 그 openapi.json 에서 파생된다 (ADR-0001).
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute

from dahaze_api.config import get_settings
from dahaze_api.interface.rest import analysis
from dahaze_api.interface.rest.dependencies import get_compiler
from dahaze_api.interface.rest.schemas import HealthResponse


def _operation_id(route: APIRoute) -> str:
    """operationId 를 라우트 이름 그대로 쓴다.

    FastAPI 기본값은 함수명에 경로와 메서드를 이어 붙여 `compile_workspace_api_analysis_
    compile_post` 같은 이름을 만든다. 이게 그대로 프론트 훅 이름이 되므로,
    사람이 읽을 수 있는 이름을 우리가 정한다.
    """
    return route.name


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="dahaze API",
        description="RSPDL 저작·검증 워크스페이스",
        version="0.1.0",
        generate_unique_id_function=_operation_id,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(analysis.router)

    @app.get("/health", tags=["health"], name="health")
    async def health() -> HealthResponse:
        """배포 헬스체크. 컴파일러가 실제로 로드되는지까지 확인한다.

        네이티브 확장이 플랫폼 불일치로 로드에 실패하는 경우를 여기서 잡는다 —
        RSPDL 은 linux/arm64 와 musl 을 지원하지 않는다 (ADR-0002).
        """
        return HealthResponse(status="ok", rspdl_version=get_compiler().runtime.rspdl_version)

    return app


app = create_app()
