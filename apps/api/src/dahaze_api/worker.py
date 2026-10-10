"""AI 대화 턴을 실행하는 worker 프로세스."""

from __future__ import annotations

import asyncio

from dahaze_api.config import get_settings
from dahaze_api.infrastructure.agent_worker import AgentWorker
from dahaze_api.infrastructure.db.session import get_session_factory
from dahaze_api.infrastructure.llm import OpenAiAgentLlm
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler


async def main() -> None:
    settings = get_settings()
    worker = AgentWorker(
        sessions=get_session_factory(),
        compiler=LocalRspdlCompiler(),
        llm=OpenAiAgentLlm(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            timeout_s=settings.openai_agent_timeout_s,
            reasoning_effort=settings.openai_reasoning_effort,
        ),
    )
    await worker.run_forever()


if __name__ == "__main__":
    asyncio.run(main())
