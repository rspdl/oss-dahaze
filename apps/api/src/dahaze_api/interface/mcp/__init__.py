"""MCP 인터페이스.

FastAPI 앱에 마운트되는 MCP 서버다. 별도 앱으로 분리하지 않는다 — 인증과 DB 접근이
이중화되고, 도구가 하는 일은 결국 REST 계층과 같은 유스케이스 호출이다 (ADR-0005).

`main.py` 는 `mount_mcp(app)` 하나만 부르면 된다. 마운트와 lifespan 연결을 함께 한다.
"""

from dahaze_api.interface.mcp.auth import McpAuthError
from dahaze_api.interface.mcp.server import (
    MCP_PATH,
    McpTools,
    create_mcp_app,
    create_mcp_server,
    mount_mcp,
)

__all__ = [
    "MCP_PATH",
    "McpAuthError",
    "McpTools",
    "create_mcp_app",
    "create_mcp_server",
    "mount_mcp",
]
