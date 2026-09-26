from __future__ import annotations

import asyncio

from dahaze_api.config import get_settings
from dahaze_api.infrastructure.agent_worker import AgentWorker
from dahaze_api.infrastructure.db.session import get_session_factory
from dahaze_api.infrastructure.llm import OpenAiLlm
from dahaze_api.infrastructure.llm.agent_adapter import OpenAiAgentLlm
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
    compiler = LocalRspdlCompiler()
    planning = PlanningAiWorker(
        sessions=get_session_factory(), compiler=compiler, llm=llm, planning_llm=llm
    )
    agent = AgentWorker(
        sessions=get_session_factory(),
        compiler=compiler,
        llm=OpenAiAgentLlm(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            timeout_s=settings.openai_agent_timeout_s,
            reasoning_effort=settings.openai_planning_reasoning_effort,
        ),
    )
    # 기획 작업과 AI 대화 턴을 같은 프로세스에서 함께 처리한다.
    await asyncio.gather(planning.run_forever(), agent.run_forever())


if __name__ == "__main__":
    asyncio.run(main())
