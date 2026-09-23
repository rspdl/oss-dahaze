from __future__ import annotations

import asyncio

from dahaze_api.config import get_settings
from dahaze_api.infrastructure.db.session import get_session_factory
from dahaze_api.infrastructure.llm import OpenAiLlm
from dahaze_api.infrastructure.planning_worker import PlanningAiWorker
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler


async def main() -> None:
    settings = get_settings()
    llm = OpenAiLlm(
        api_key=settings.openai_api_key,
        model=settings.openai_model,
        timeout_s=settings.openai_planning_draft_timeout_s,
        planning_timeout_s=settings.openai_planning_timeout_s,
        planning_reasoning_effort=settings.openai_planning_reasoning_effort,
    )
    worker = PlanningAiWorker(
        sessions=get_session_factory(), compiler=LocalRspdlCompiler(), llm=llm, planning_llm=llm
    )
    await worker.run_forever()


if __name__ == "__main__":
    asyncio.run(main())
