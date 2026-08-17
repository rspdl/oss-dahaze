---
id: rspdl-compiler-integration
title: RSPDL Compiler Integration and Version Management
type: adr
status: accepted
version: "1"
summary: Runs the RSPDL compiler in-process behind a port, records a target version per document, and defers multi-version support to versioned compiler processes.
topics:
  - rspdl
  - versioning
  - compiler
  - deployment
related:
  - monorepo-structure-and-stack
  - document-storage-model
last_updated: "2026-08-17"
owners:
  - rspdl-maintainers
---

# RSPDL Compiler Integration and Version Management

## 상태

Accepted.

## 배경

RSPDL은 `0.x`다. 문법, Canonical IR, 진단 규칙이 minor 릴리스에서 바뀔 수 있고, README도 공개
API가 `0.x` 동안 변할 수 있다고 명시한다. dahaze에 저장된 문서는 **어느 문법으로 쓰였는지** 알 수
없으면 나중에 해석할 수 없게 된다.

### 배포 아티팩트 제약 (2026-08-17 확인)

PyPI `rspdl` 0.1.0이 제공하는 파일은 넷뿐이다.

| 파일 | 크기 |
|---|---|
| `rspdl-0.1.0-cp311-abi3-macosx_14_0_arm64.whl` | 8.5 MB |
| `rspdl-0.1.0-cp311-abi3-macosx_14_0_x86_64.whl` | 9.2 MB |
| `rspdl-0.1.0-cp311-abi3-manylinux_2_28_x86_64.whl` | 12.7 MB |
| `rspdl-0.1.0-cp311-abi3-win_amd64.whl` | 8.4 MB |

**linux aarch64 wheel 이 없고, sdist 도 없다.** 따라서 Linux arm64(AWS Graviton, Lightsail ARM
번들)에서는 소스 빌드로 fallback 하지도 못하고 설치가 실패한다. musl/Alpine 이미지도 같은 이유로
불가능하다. 배포 타깃은 **x86_64 + glibc** 여야 한다.

설치된 패키지는 `rspdl/_native.abi3.so` 27.5MB 하나이며 Z3가 정적 링크되어 있다.

### 프로세스당 한 버전

한 Python 프로세스에 rspdl 두 버전을 올릴 수 없다. 이유가 겹쳐 있다.

1. 배포 이름이 `rspdl` 하나 → 한 환경에 한 버전만 설치된다.
2. import 이름도 `rspdl` 하나 → `sys.modules["rspdl"]` 키가 하나다.
3. 네이티브 확장이 `rspdl._native` → 같은 이름의 `.so` 두 개를 한 프로세스에 올릴 수 없다.
4. `__version__ = version("rspdl")` 이 설치 메타데이터를 읽는다 → `sys.path` 트릭으로 우회해도
   버전 보고가 거짓이 된다.

**따라서 "여러 rspdl 버전 동시 지원" 은 필연적으로 "여러 프로세스" 를 뜻한다.** 인프로세스 호출
하나로는 어떤 방법으로도 불가능하다.

## 결정

### 지금: 인프로세스 호출, 단 port 뒤에

`domain/ports.py`에 `RspdlCompilerPort`를 정의하고, `infrastructure/rspdl/local_adapter.py`가
`import rspdl`로 이를 구현한다. **저장소 전체에서 `rspdl` 을 import 하는 파일은 이 하나뿐이다.**

port 는 컴파일러의 정체를 노출한다.

```python
class RspdlCompilerPort(Protocol):
    @property
    def runtime(self) -> RspdlRuntime: ...   # rspdl_version, wire_schema_version, locale
    async def compile(self, sources: Sequence[RspdlSource]) -> CompileOutcome: ...
    async def check(self, sources, data) -> CheckOutcome: ...
    async def find_model(self, source, *, scope_per_model, timeout_ms) -> ModelOutcome: ...
```

`rspdl` 이 지금 단일 버전이므로 어댑터도 하나다. 아직 존재하지 않는 두 번째 버전을 위해 지금
분산 시스템을 만들지 않는다.

### 지금: 문서마다 버전을 기록한다

모든 컴파일 산출물과 문서 리비전에 `rspdl_version` 과 `wire_schema_version` 을 남긴다.
이건 미룰 수 없다 — 나중에 채워 넣을 방법이 없기 때문이다. 어느 문법으로 쓰인 텍스트인지는
텍스트만 보고 복원할 수 없다.

### 나중: 버전별 컴파일러 프로세스

rspdl 0.2.0처럼 문법이 깨지는 릴리스가 나오는 시점에 `RemoteRspdlAdapter`를 추가한다.
docker-compose 에 `compiler-v0-1`, `compiler-v0-2` 서비스를 얹고, 라우팅 어댑터가 문서의
`target_rspdl_version` 을 보고 고른다. `domain/` 과 `application/` 은 건드리지 않는다.

전환 시점의 신호: **지원해야 할 rspdl 버전이 둘 이상이 되는 순간.** 그 전에는 하지 않는다.

### 버전 승격 절차

rspdl 버전을 올리는 것은 코드 변경이 아니라 **제품 변경**으로 취급한다.
`.agents/skills/upgrade-rspdl/` 절차를 따르며, 요지는 다음과 같다.

1. 새 버전으로 기존 문서 전체를 재컴파일한다.
2. 진단이 새로 발생하거나 사라진 문서를 리포트한다.
3. 회귀가 없을 때만 `pyproject.toml` 의 핀을 올린다.

## 결과

- 배포 타깃은 x86_64 + glibc 로 **고정**된다. Terraform 이 이를 강제한다.
- 컴파일 결과 캐시의 키에 rspdl 버전이 들어가므로, 버전을 올리면 캐시가 자연히 무효화된다.
- 멀티버전으로 가는 날, 바꿀 파일은 어댑터 하나와 compose 파일 하나다.
