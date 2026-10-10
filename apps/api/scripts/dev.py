"""Run the local API and agent worker together."""

from __future__ import annotations

import os
import signal
import subprocess
import time
from contextlib import suppress


def main() -> int:
    commands = (
        # 열린 SSE(프로젝트 이벤트 스트림)는 스스로 닫히지 않는다. 기다리는 시간을 두지 않으면
        # 코드를 고쳐 다시 불러올 때마다 "Waiting for connections to close" 에서 멈춘다.
        (
            "uv",
            "run",
            "uvicorn",
            "dahaze_api.main:app",
            "--reload",
            "--port",
            "8400",
            "--timeout-graceful-shutdown",
            "2",
        ),
        ("uv", "run", "python", "-m", "dahaze_api.worker"),
    )
    processes: list[subprocess.Popen[bytes]] = []

    def stop(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        for command in commands:
            processes.append(subprocess.Popen(command, start_new_session=True))
        while True:
            for process in processes:
                if process.poll() is not None:
                    print(f"dev process {process.pid} exited ({process.returncode})", flush=True)
                    return process.returncode or 1
            time.sleep(0.2)
    except KeyboardInterrupt:
        return 0
    finally:
        for process in processes:
            if process.poll() is None:
                with suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGTERM)
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
