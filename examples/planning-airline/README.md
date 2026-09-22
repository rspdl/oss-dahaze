# 별하늘 항공 기획 작업공간 fixture

이 디렉터리는 복잡한 항공 예약을 닮은 **가상 제품 기획 사례**다. 별하늘 항공, 공항, 편명,
사람, 결제 수단과 정책은 모두 허구다. 실제 항공사 업무나 법률·운임·결제·안전 규정을 재현하거나
검증한다고 주장하지 않는다.

단일 문서인 [`airline-planning.rspdl`](airline-planning.rspdl)은 공통 모델과 정책 위에 고객 PC의
통합 예약 화면, 고객 모바일의 승객→연락처→결제 분할 화면, 운영자 PC의 예약·결제·항공편 업무를
함께 둔다. 15개 화면은 대표 여정을 깊게 확인하기 위한 크기다. 30·60·100 화면 성능 fixture는 별도
규모 검증으로 남긴다.

## 포함 범위

- 모델 6개, 역할 4개, 행동 15개, 정책 18개
- 정보구조 분류 9개, 화면 15개, 화면별 분류 배정 15개
- 의미 레이아웃 요소 123개와 명시적 안정 ID 123개
- 화면 권한 연결 17개, 흐름 43개
- typed 행동 결과 32개, 조회 결과 2개, 완료 업무 1개
- 고객 PC 1440×900, 고객 모바일 390×844, 운영자 PC 1440×1024 환경 3개
- 모델 6개 각각의 `normal`·`empty`·`long`·`many` 샘플 묶음. 실제 샘플 행은 정상 6개,
  빈 상태 0개, 긴 값 6개, 많은 데이터 29개로 총 41개다.

레이아웃은 제목·폼·입력·목록·버튼·자리만 선언한다. 회색 wireframe 표현, 좌표, 크기와 간격은
dahaze 렌더러와 기획 메타데이터가 소유한다. RSPDL에 시각 수치를 넣지 않는다.

## 컴파일러 계약 검증

현재 작업 중인 compiler binary를 **명시적으로** 지정한다. 이 fixture가 특정 미출시 버전을 공식
릴리스라고 가정하지 않도록 기본 경로나 버전 문자열은 두지 않았다.

```console
cd /Users/jwsong/projects/rspdl/rspdl-planning-contracts
cargo build -p rspdl-cli

cd /Users/jwsong/.codex/worktrees/dahaze-planning-workspace/dahaze
python3 examples/planning-airline/verify_fixture.py \
  --compiler /Users/jwsong/projects/rspdl/rspdl-planning-contracts/target/debug/rspdl
```

검증기는 정상 문서가 진단 없이 컴파일되는지, 위 개수와 모든 요소 ID가 유지되는지,
[`planning-metadata.json`](planning-metadata.json)의 화면·모델·필드 stable key가 실제 IR과 일치하는지
확인한다. 이어 [`variants.json`](variants.json)의 치환을 임시 파일에 하나씩 적용해 다음 좁은 반례가
각각 정확히 하나의 진단만 만드는지 확인한다.

| 반례 | 바꾸는 사실 | 기대 진단 |
|---|---|---|
| `bypass-required-contact` | 모바일 연락처 화면을 건너뛰는 경로 추가 | `RSPDL-WORKFLOW-001` |
| `denied-backoffice-permission` | 결제 담당자의 재시도 허용만 거부로 변경 | `RSPDL-SCREEN-POLICY-001` |
| `missing-payment-failure-handler` | PC 결제 거절 handler 하나 제거 | `RSPDL-OUTCOME-010` |
| `unreachable-wrong-retry` | 운영 결제 retry를 고객 검색 버튼에 연결 | `RSPDL-RECOVERY-001` |

반례는 원문 전체를 복사하지 않는다. 기준 문서의 정확한 한 곳과 일치해야만 치환되므로 기준이 바뀌면
검증기가 조용히 다른 사례를 만들지 않고 실패한다.

## 새 로컬 프로젝트로 seed

[`seed_workspace.py`](seed_workspace.py)는 기존 프로젝트를 찾거나 수정하지 않는다. 먼저 저장 없는
`POST /api/analysis/compile`로 서버 compiler가 정상 fixture를 받아들이는지 확인하고, 그 다음에만
새 프로젝트를 만들고 문서와 기획 메타데이터를 저장한다. 서버가 C3 계약을 포함한 compiler로 재시작되기
전에는 실행하지 않는다. 오래된 서버는 preflight에서 멈추며 계정·프로젝트를 만들지 않는다.

전용 가짜 계정을 처음 만들 때:

```console
export DAHAZE_BASE_URL=http://127.0.0.1:18400
export DAHAZE_SEED_LOGIN=planning_airline_fixture
export DAHAZE_SEED_PASSWORD='replace-with-a-local-test-password'
export DAHAZE_SEED_DISPLAY_NAME='항공 기획 검증 계정'
python3 examples/planning-airline/seed_workspace.py --register-fake-account
```

이미 만든 전용 가짜 계정으로 새 격리 프로젝트를 하나 더 만들 때는
`--register-fake-account`를 빼고 같은 환경 변수를 쓴다. 비밀번호나 세션은 파일에 저장하지 않는다.
slug는 기본적으로 `planning-airline-<UTC 시각>-<임의값>`이므로 기존 사용자 프로젝트와 충돌하지 않는다.
명시적 slug를 줄 수도 있지만 충돌하면 덮어쓰지 않고 API의 `409`로 끝난다.

seed는 REST의 계정, 프로젝트, 문서, planning metadata, 프로젝트 compile 경로만 사용한다. OpenAI API나
LLM 저작 경로를 호출하지 않는다.

## 검증 한계

- 환경 이름과 CSS viewport는 dahaze 메타데이터다. 역할이나 경로 조건으로 해석되지 않는다. 고객·예약
  담당자·결제 담당자·운항 관리자 연결은 RSPDL 화면의 `역할`과 `권한`에 별도로 적었다.
- PC와 모바일은 같은 모델을 한 문서에서 공유한다. 여러 문서 사이 공통 모델 linking은 이 사례가
  검증하지 않는다.
- `회원 연락처 불러오기` 경로의 예약 연락처 획득은 업무의 명시적 `획득` 선언이다. 현재 계약은 회원
  필드에서 예약 필드로 값을 복사하는 변환 자체를 증명하지 않는다.
- compiler는 handler 연결과 제한된 retry 도달성을 확인한다. timeout 시간, 외부 결제사의 실제 성공,
  중복 결제 방지, 취소의 멱등성, 좌석 해제 실행은 확인하지 않는다.
- handler의 `내용`은 표시 문구다. 성공·실패 조건이나 정책으로 해석하지 않는다.
- 샘플 데이터는 화면 검토용 메타데이터다. 업무 규칙의 증거나 runtime 시뮬레이션 입력이 아니다.
- 이 fixture는 compiler 진단만 기대 결과로 삼는다. dahaze나 검증 스크립트가 별도 업무 진단을 만들지
  않는다.
