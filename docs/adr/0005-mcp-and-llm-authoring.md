---
id: mcp-and-llm-authoring
title: MCP Server and LLM Authoring Loop
type: adr
status: accepted
version: "4"
summary: Serves MCP and an in-app agent from the API with one shared tool set over the project working tree, grammar given as prompt context, symbol search over compiler IR, and diagnostics shown rather than used as a save gate.
topics:
  - mcp
  - llm
  - authoring
  - openai
related:
  - rspdl-compiler-integration
  - document-storage-model
  - monorepo-structure-and-stack
  - working-tree-commits-and-locks
last_updated: "2026-09-26"
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
높다. v3까지는 이를 막으려고 컴파일을 통과하지 못한 초안의 저장을 막았다. v4부터는 저장을 막지 않고,
진단을 원문 위치와 함께 항상 보여주는 쪽으로 바꿨다(ADR-0008).

## 결정

### AI는 도구로 작업 트리를 다룬다

앱 안의 AI와 외부 MCP 클라이언트는 같은 도구 세트를 쓴다: `ls`·`read`·`search`·`grep`·
`compile`·`mkdir`·`add`·`edit`·`mv`·`delete`·`commit`, 그리고 MCP 전용 `unlock`.
도구 명세는 [에이전트 작업공간 계획](../plans/agent-workspace.md)에 있다. 쓰기 도구는
공유 작업 트리를 바로 바꾸며 저장·이력·잠금 계약은
[ADR-0008](0008-working-tree-commits-and-locks.md)을 따른다.

- `search`는 작업 트리 전체를 컴파일한 IR의 심볼(ID·이름·종류)만 찾는다. 텍스트 일치는
  `grep`이 따로 맡는다. 심볼 검색에 텍스트 일치를 섞으면 AI가 문자열 일치를 정의로 착각한다.
- 구문 오류로 심볼을 읽지 못한 파일은 search 결과에 따로 알린다.
- `compile`은 진단과 그 위치(`path`, 줄·열)를 돌려준다. IR span은 UTF-8 byte 오프셋이다.
- 한 턴의 도구 호출은 최대 100회다. 닿으면 사용자에게 계속할지 묻고 턴을 끝낸다.

### 컴파일 게이트는 차단이 아니라 표시다

이전에는 진단이 남은 후보가 확정 원문이 될 수 없었다. 이제 오류가 있는 원문도 작업 트리에
저장하고 commit할 수 있다. 대신 **진단은 컴파일러가 준 그대로, 원문 위치와 함께 보여준다.**
AI는 `compile` 도구로 자기 작업을 확인하고, 사람은 에디터와 도구 카드에서 진단을 본다.
의미 정합성의 유일한 판정자가 RSPDL 컴파일러라는 점은 바뀌지 않는다.

### 문법은 맥락으로 알려주고, 판정은 컴파일러가 한다

v3까지는 EBNF를 Lark CFG로 바꿔 OpenAI custom tool의 constrained decoding으로 강제했다.
custom tool은 문법으로 제약된 문자열 하나만 받으므로, 경로와 원문을 함께 받아야 하는
`add`·`edit`에 쓸 수 없다. 봉투 문법이나 두 번 호출로 우회하는 대신 제약 디코딩을 걷어낸다.

- 쓰기 도구는 일반 function tool이다. `content`는 JSON 문자열 인자로 받는다.
- RSPDL 문법은 시스템 프롬프트의 맥락으로 알려준다. 문법 스냅샷(`infrastructure/llm/grammars/`)과
  프롬프트(`infrastructure/llm/prompts/`)는 계속 rspdl 버전과 함께 관리한다.
- 구문 정합성도 의미 정합성도 판정자는 RSPDL 컴파일러 하나다. AI는 `compile` 도구로 진단을
  받아 스스로 고친다.
- dahaze는 도구 인자의 `content`를 그대로 저장한다. 코드 펜스 제거 같은 사후 처리를 하지 않는다.
  AI가 형식을 어기면 그 원문이 그대로 컴파일 진단으로 드러난다.

### 저장과 이력

AI 도구는 작업 트리를 바로 바꾼다. 이력은 사람이나 AI가 파일을 골라 만드는 commit에만
남는다. 도구 호출마다 호출 전후 원문을 대화 기록에 남겨, 사용자가 각 호출의 변경을
추적할 수 있게 한다. 이 두 장치가 이전의 "자동 저장 금지"가 지키려던 추적 가능성을 대신한다.

기존의 인터뷰는 대화의 한 형태다. 결정·보류·제안 같은 구조화 기획 상태와 후보 보관,
명시적 apply는 두지 않는다. 대화는 세션 단위로 보관하고 이어 갈 수 있다.

에이전트 턴은 PostgreSQL 작업 큐와 worker·lease 위에서 돈다. 도구 호출과 응답은 이벤트로
쌓고 웹은 SSE로 받는다. 턴이 끝나면(사용자 응답 대기, 강제 종료, 오류) 그 턴의 파일 잠금을
모두 푼다.

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

- **초안만 돌려주고 사람이 apply** — v3까지의 방식. AI가 여러 파일을 연속으로 다루는 턴과 맞지 않아 ADR-0008로 대체했다.
- **constrained decoding 유지(v3)** — custom tool 입력이 문자열 하나라 경로를 함께 받을 수 없다.
  첫 줄을 경로로 쓰는 봉투 문법은 dahaze가 비공식 문법을 소유하게 하고, 두 번 호출은 도구 상한을
  빨리 소모하고 호출 사이 상태를 서버가 기억해야 한다.
- **프론트에서 LLM 직접 호출** — API 키가 브라우저로 나가고, 도구 유스케이스의 접근 검사를 우회할 수 있다.
- **MCP를 별도 앱으로 분리** — 수명주기는 분리되지만 인증·DB 접근이 이중화된다. 도구가 결국
  같은 유스케이스를 부르므로 이득이 비용보다 작다.

## 결과

- MCP와 앱 AI와 REST가 같은 유스케이스와 같은 접근 검사를 지난다.
- 문법 제약 없이 쓰므로 구문 오류 원문이 작업 트리에 들어올 수 있다. compile 진단으로 드러난다.
- OpenAI와 self-hosted LLM 구현이 같은 port를 구현하고 애플리케이션을 바꾸지 않는다.
- 생성 결과는 Rust RSPDL 컴파일러만 해석한다.
- AI가 쓴 원문은 작업 트리에 바로 저장되며, 진단은 차단하지 않고 위치와 함께 표시된다.
- MCP 토큰은 폐기할 수 없다. TTL 안에서만 유효하며, 폐기가 필요하면 후속 작업이 필요하다.
- rspdl 버전을 올릴 때 프롬프트 점검이 절차에 포함된다.
