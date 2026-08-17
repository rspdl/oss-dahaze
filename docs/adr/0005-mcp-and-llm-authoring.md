---
id: mcp-and-llm-authoring
title: MCP Server and LLM Authoring Loop
type: adr
status: accepted
version: "1"
summary: Serves MCP and an OpenAI-backed authoring loop from the API, and requires every generated draft to pass the compiler before a human sees it.
topics:
  - mcp
  - llm
  - authoring
  - openai
related:
  - rspdl-compiler-integration
  - document-storage-model
  - monorepo-structure-and-stack
last_updated: "2026-08-17"
owners:
  - rspdl-maintainers
---

# MCP Server and LLM Authoring Loop

## 상태

Accepted.

## 배경

dahaze의 제품 전제는 **"문법 파일을 사람이 직접 쓸 수도 있지만, 주로 MCP나 전용 LLM API로
쓴다"** 는 것이다. 지금까지 만든 것으로 문서를 저장할 수는 있지만 만들어내는 수단이 사람 손밖에
없다. 이 ADR은 그 생성 경로를 정한다.

RSPDL은 한국어 선언형 문법이고 `0.x`다. LLM이 그럴듯하지만 컴파일되지 않는 텍스트를 만들 확률이
높다. 그리고 그 텍스트가 그대로 저장되면 dahaze는 "검증된 기획" 이라는 약속을 스스로 어긴다.

## 결정

### 생성물은 컴파일러를 통과하기 전에는 결과가 아니다

**LLM이 만든 텍스트는 컴파일 결과와 함께가 아니면 호출자에게 돌아가지 않는다.**

```
지시 → LLM 초안 → 컴파일 → 진단이 있으면 진단을 다시 넣어 재시도 → 최종 초안 + 진단
```

- 재시도는 유한하다 (`MAX_REPAIR_ATTEMPTS`). 무한히 고치려 들지 않는다.
- 재시도해도 진단이 남으면 **실패로 만들지 않고 진단과 함께 돌려준다.** 사람이 판단할 재료를
  뺏지 않는다.
- 시도 이력(각 시도의 진단 수)을 응답에 남긴다. 왜 이 초안이 최종인지 설명 가능해야 한다.

이건 `AGENTS.md`의 "LLM 출력도 사람 출력과 같은 컴파일러 게이트를 통과한다" 를 코드로 옮긴 것이다.
RSPDL `AGENTS.md`에도 같은 원칙이 있다.

### 자동 저장하지 않는다

저작 엔드포인트는 **초안을 돌려줄 뿐 문서를 쓰지 않는다.** 저장은 기존
`PUT /api/documents/{id}` 로 사람이 명시적으로 한다.

이유: 저장은 리비전을 만들고, 리비전은 되돌릴 수 없는 이력이다. LLM이 문서를 조용히 덮어쓰면
사용자는 자기 문서에 무슨 일이 일어났는지 추적할 수 없게 된다.

### 프롬프트는 rspdl 버전에 묶인다

LLM에게 RSPDL 문법을 알려주는 프롬프트(문법 요약과 예제)는 **컴파일러 버전과 함께 늙는다.**
문법이 바뀌면 프롬프트도 바꿔야 하며, 안 바꾸면 LLM이 옛 문법을 계속 만들어낸다.

따라서 프롬프트 자원은 한곳(`infrastructure/llm/prompts/`)에 모으고, `upgrade-rspdl` 스킬의
승격 절차에 프롬프트 점검을 포함한다. 이건 재컴파일 리포트로는 드러나지 않는 종류의 회귀다.

### MCP는 API 안에 둔다

`interface/mcp/` 가 FastAPI 앱에 마운트된다. 별도 앱으로 분리하지 않는다 — 인증과 DB 접근을
두 곳에서 관리하게 되고, MCP 도구가 하는 일은 결국 REST 계층과 같은 유스케이스 호출이다.

MCP 도구는 `application/` 의 유스케이스만 부른다. 저장소나 컴파일러를 직접 부르지 않는다.
따라서 REST와 MCP는 **같은 접근 검사**를 지난다.

### MCP 인증은 Bearer 토큰으로 시작한다

MCP 클라이언트는 브라우저 쿠키를 쓸 수 없다. 완전한 MCP OAuth 2.1 흐름은 별도 과제이므로,
1차는 dahaze가 발급한 **Bearer 토큰**으로 한다.

- 세션 토큰과 **다른 audience**(`dahaze:mcp`)로 서명한다. 하나가 새어도 다른 쪽에 쓸 수 없다.
- 로그인한 사용자가 `POST /api/auth/mcp-token` 으로 발급받는다.
- 저장소가 없으므로 **개별 폐기(revocation)가 불가능하다.** 알려진 한계이며, 지금은 TTL로만
  제한한다. 폐기가 필요해지면 토큰 ID 테이블과 blocklist 를 도입한다.

이 한계를 문서에 적어두지 않으면, 나중에 "MCP 토큰을 폐기해 달라" 는 요구에 답이 없다는 사실을
사고가 난 뒤에 알게 된다.

## 대안

- **LLM 출력을 그대로 저장** — 가장 빠르지만 제품 약속과 정면으로 충돌한다.
- **프론트에서 LLM 직접 호출** — API 키가 브라우저로 나가고, 컴파일 게이트를 우회할 수 있다.
- **MCP를 별도 앱으로 분리** — 수명주기는 분리되지만 인증·DB 접근이 이중화된다. 도구가 결국
  같은 유스케이스를 부르므로 이득이 비용보다 작다.

## 결과

- MCP와 REST가 같은 접근 검사와 같은 컴파일 게이트를 지난다.
- LLM이 만든 어떤 텍스트도 진단 없이 사용자에게 도달하지 않는다.
- MCP 토큰은 폐기할 수 없다. TTL 안에서만 유효하며, 폐기가 필요하면 후속 작업이 필요하다.
- rspdl 버전을 올릴 때 프롬프트 점검이 절차에 포함된다.
