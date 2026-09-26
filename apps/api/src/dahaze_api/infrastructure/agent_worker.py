"""AI 턴을 실행하는 worker 루프."""

from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from dahaze_api.application.agent import AgentTurnRunner
from dahaze_api.domain.ports import RspdlCompilerPort
from dahaze_api.infrastructure.agent_scope import agent_scopes
from dahaze_api.infrastructure.llm.agent_adapter import OpenAiAgentLlm
from dahaze_api.infrastructure.rspdl.local_adapter import PLANNING_CONTRACTS_CAPABILITY

POLL_SECONDS = 1.0


class AgentWorker:
    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        compiler: RspdlCompilerPort,
        llm: OpenAiAgentLlm,
    ) -> None:
        self._sessions = sessions
        self._compiler = compiler
        self._llm = llm

    async def run_forever(self) -> None:
        capabilities = await self._compiler.capabilities()
        runner = AgentTurnRunner(
            scopes=agent_scopes(self._sessions, self._compiler),
            llm=self._llm,
            planning_profile=PLANNING_CONTRACTS_CAPABILITY in capabilities,
        )
        try:
            while True:
                if not await runner.run_once():
                    await asyncio.sleep(POLL_SECONDS)
        finally:
            await self._llm.close()
