---
name: upgrade-rspdl
description: Promote the pinned rspdl compiler version in dahaze safely. Use when bumping the rspdl dependency, when a new rspdl release lands, when compile results change unexpectedly, or when deciding whether dahaze must support multiple rspdl versions at once.
---

# RSPDL 버전 승격

`rspdl` 핀을 올리는 것은 의존성 갱신이 아니라 **제품 변경**이다. RSPDL은 `0.x`이고 문법·Canonical
IR·진단이 minor 릴리스에서 바뀔 수 있다. 이미 저장된 사용자 문서가 새 버전에서 컴파일되지 않을
수 있으며, 그건 배포 후에 알면 늦다.

## 알아야 할 제약

**한 프로세스는 rspdl 버전을 하나만 가진다.** 배포 이름·import 이름·네이티브 모듈 이름이 모두
`rspdl` 하나이고, `__version__` 이 설치 메타데이터를 읽는다. `sys.path` 트릭으로 우회할 수 없다.
따라서 "여러 버전 동시 지원" 은 필연적으로 "여러 프로세스" 를 뜻한다 (ADR-0002).

이 스킬의 도구들이 각 버전을 별도 프로세스에서 돌리는 이유도 이것이다.

## 절차

### 1. 무엇이 바뀌었는지 읽는다

[rspdl-core CHANGELOG](https://github.com/rspdl/rspdl-core/blob/main/CHANGELOG.md)에서
문법·IR·진단·**지원 플랫폼**에 영향 있는 항목을 추린다.

### 2. 플랫폼이 여전히 맞는지 확인한다

```console
curl -s https://pypi.org/pypi/rspdl/json | python3 -c "
import sys,json
for u in json.load(sys.stdin)['urls']: print(u['filename'])"
```

`manylinux_*_x86_64` wheel이 계속 있어야 한다. **linux aarch64 wheel이 생겼는지도 함께 보라** —
생겼다면 인프라를 arm 인스턴스로 옮겨 비용을 줄일 수 있다는 뜻이다 (ADR-0004).

### 3. 재컴파일 리포트를 만든다

```console
python3 scripts/rspdl_recompile_report.py --to 0.2.0
```

기준 버전은 `apps/api/pyproject.toml` 의 현재 핀에서 자동으로 읽는다. 두 버전이 각각 격리된
환경에서 돌고, 결과를 비교해 다음을 알려준다.

- **회귀** — 컴파일되던 문서가 안 되거나, 새 진단이 생긴 경우
- **사라진 진단** — 의도된 개선일 수도, 검증이 조용히 약해진 것일 수도 있다
- **wire schema 변경** — 어댑터 수정이 필요하다

회귀나 오류가 있으면 exit 1이다.

#### 실사용 문서로 검사하기

기본 코퍼스(`fixtures/corpus/`)는 대표 예제일 뿐이다. **승격 전에는 실제 저장된 문서로
돌려야 한다.** DB에서 내보낸다.

```console
mkdir -p /tmp/dahaze-corpus
# documents 테이블의 text 를 <id>.rspdl 로 내보내는 스크립트를 돌린 뒤
python3 scripts/rspdl_recompile_report.py --to 0.2.0 --corpus /tmp/dahaze-corpus
```

### 4. wire schema가 바뀌었다면

`infrastructure/rspdl/local_adapter.py` 의 `_wrap` 이 스키마 버전을 검증한다. 새 버전을 받도록
고치고, **응답 모양이 달라진 곳을 프론트까지 따라가며** 확인한다. `result` 는 그대로 통과하므로
타입 시스템이 잡아주지 않는다.

### 5. 핀을 올린다

```toml
# apps/api/pyproject.toml
"rspdl==0.2.0",
```

```console
cd apps/api && uv lock --upgrade-package rspdl && uv sync --extra dev
```

### 6. 하네스를 돌린다

```console
./scripts/check.sh
```

### 7. PR을 연다

`.github/ISSUE_TEMPLATE/rspdl-version.yml` 로 이슈를 먼저 만들고, PR 본문에 **재컴파일 리포트
전문**을 붙인다. 리뷰어가 회귀 여부를 직접 확인할 수 있어야 한다.

## 회귀가 있을 때

세 갈래다.

| 선택 | 언제 |
|---|---|
| **승격 보류** | 회귀가 크고 급하지 않을 때. 가장 흔한 정답이다. |
| **마이그레이션** | 기계적으로 고칠 수 있는 문법 변경일 때. 변환 스크립트를 쓰고 사용자에게 알린다. |
| **멀티버전 지원** | 사용자가 자기 속도로 옮겨야 할 때. 아래 참조. |

## 멀티버전으로 갈 때

**신호: 동시에 지원해야 할 rspdl 버전이 둘 이상이 되는 순간.** 그 전에는 하지 않는다.

바꿀 곳은 셋이다.

1. `infrastructure/rspdl/remote_adapter.py` 추가 — `RspdlCompilerPort` 를 HTTP로 구현
2. `docker-compose.prod.yml` 에 버전별 컴파일러 서비스 추가 (`compiler-v0-1`, `compiler-v0-2`)
3. `interface/rest/dependencies.py` 에서 문서의 `target_rspdl_version` 을 보고 어댑터 선택

`domain/` 과 `application/` 은 건드리지 않는다. 그러라고 port를 둔 것이다.

각 컴파일러 컨테이너는 자기 버전만 설치한 별도 이미지다. 한 이미지에 두 버전을 넣으려는
시도는 위의 제약 때문에 실패한다.

## 흔한 실수

- **리포트 없이 핀만 올리기** → 사용자 문서가 깨진 걸 배포 후에 안다.
- **`fixtures/corpus` 만으로 검증** → 대표 예제는 실사용 문법의 일부만 덮는다.
- **사라진 진단을 개선으로 단정** → 검증이 약해진 것일 수도 있다. CHANGELOG에서 확인하라.
- **캐시 무효화 코드를 찾기** → 없다. 캐시 키에 `rspdl_version` 이 들어 있어 자동으로 무효가
  된다 (ADR-0003).
