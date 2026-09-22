---
id: screen-boards
title: 화면 보드 — 정보구조와 화면 흐름
type: rfc
status: proposed
version: "0.1"
summary: Defines two board views that project the RSPDL frontmatter IR — an auto-laid-out information architecture tree and a flow canvas of rendered wireframes — plus the deterministic mockup renderer, per-model sample data, and the write-back path.
topics:
  - information-architecture
  - screen-flow
  - wireframe
  - board
  - frontend
related:
  - frontend-architecture
  - document-storage-model
  - rspdl-compiler-integration
  - mcp-and-llm-authoring
last_updated: "2026-09-21"
owners:
  - rspdl-maintainers
---

# 화면 보드: 정보구조와 화면 흐름

## 상태와 목적

RSPDL 0.1.2가 문서 머리말에 정보구조·화면 레이아웃·화면 흐름을 담는다
([rspdl-core RFC-0009](https://github.com/rspdl/rspdl-core/blob/main/docs/rfcs/0009-document-frontmatter-structure.md)).
기획자가 그것을 **읽고 다루는 자리**가 dahaze에 아직 없다. 이 RFC는 그 자리를 정의한다.

컴파일 결과에서 우리가 읽는 네 목록은 다음과 같다. 모양은 컴파일러가 소유하며 우리는 통과시킨다
(ADR-0003).

```
information_architecture  [{ id, name, parent_id?, span }]              선언 순서 = 전위 순회
screen_categories         [{ screen_id, category_id, span }]
screen_layouts            [{ screen_id, kind?, elements[] }]            elements 는 kind 태그 재귀
screen_paths              [{ source_screen_id, source_element_id,
                             target_screen_id, label?, span }]
```

## 두 보드

`PROJECT_VIEWS`에 두 뷰를 더한다. 뷰가 주소에 담겨야 링크로 공유된다.

| | 화면 구조 (IA) | 화면 흐름 |
|---|---|---|
| 주소 | `/projects/{id}/ia` | `/projects/{id}/screen-flow` |
| 배치 | 자동 트리. 깊이가 왼→오 | 사람이 끌어 배치 |
| 노드 | 분류와 화면 | 렌더링된 목업 |
| 간선 | 계층 (`parent_id`·`screen_categories`) | `screen_paths` |
| 오른쪽 | 선택한 노드의 rspdl 원문 (읽기 전용) | 원문 + 목업 |
| 쓰기 | 없음 | 화살표를 그리면 문서에 쓰인다 |

두 보드 모두 `@xyflow/react`를 쓴다. ERD 화면이 이미 같은 스택이다.

**IA 보드에는 목업이 없고, 흐름 보드의 노드는 목업 그 자체다.** 구조를 읽는 눈과 화면을
뜯어보는 눈을 한 화면에서 섞지 않는다.

**분류 형제의 순서는 IR이 준 선언 순서 그대로 그린다.** 그것이 곧 메뉴 순서이고 기획자가
그 순서로 적어서 내린 결정이다. 이름순으로 정렬하지 않는다.

## 목업 렌더러

닫힌 어휘 여덟 개를 컴포넌트 여덟 개로 옮긴다. **LLM은 이 경로에 없다.** 구조는 선언된 것이고
렌더링은 결정적이다.

| IR `kind` | 들고 있는 것 | 그리는 것 |
|---|---|---|
| `header` | `children` | 상단 고정 띠 |
| `section` | `children` | 의미 묶음 블록 |
| `heading` | `text` | 제목 |
| `form` | `inputs` | 입력 묶음 |
| `input` | `field_id` | 라벨 + 타입에 맞는 입력칸 |
| `list` | `model_id`, `field_ids[]` | 표 또는 카드 목록 |
| `button` | `id`, `name`, `action_id?` | 버튼 |
| `placeholder` | `text` | 회색 박스 + 이름표 |

`input`과 `list`는 id만 들고 있으므로 **같은 응답의 `module.models`와 조인**해 필드 이름과
`value_type`을 가져온다. 타입이 입력칸 모양을 정한다 — 정수는 숫자칸, enum은 선택칸, 날짜는
날짜칸. 이 매핑도 결정적이며 IR이 준 사실만 쓴다.

`placeholder`는 `text` 를 들고 `button` 은 `name` 을 든다. 둘을 헷갈리면 이름표가 비어 보인다.

`placeholder`가 안전판이다. 지도·차트처럼 선언할 수 없는 자리는 회색 박스와 이름표로 남는다.
채우는 것은 디자인의 일이다.

### 뷰포트

프로젝트마다 데스크톱·모바일·둘 다 중에서 고른다. 프로젝트 구성원이 공유하는 설정이므로
서버에 둔다. `둘 다`이면 노드가 두 폭을 나란히 보여준다.

## 샘플 데이터

렌더러가 그린 화면이 **명세서가 아니라 화면처럼 보이려면** 그럴듯한 내용이 필요하다. 그 내용만
LLM이 만든다.

**화면이 아니라 모델 단위로 만든다.** `시설` 모델의 샘플 행을 한 번 만들어, 그 모델을 보여주는
모든 화면이 같은 행을 쓴다. 목록에서 고른 시설이 상세에서 그대로 나와야 화살표를 따라가는
것이 흐름으로 읽힌다. 화면마다 따로 뽑으면 목록은 `회의실 1`을, 상세는 `강당 B`를 지어내
흐름이 끊긴다. 호출 수도 화면 수가 아니라 모델 수만큼으로 줄어든다.

- 샘플 데이터는 **저장한다.** LLM 출력은 비결정적이라 다시 뽑으면 다른 화면이 된다. 재생성할 수
  없는 것만 정규화한다는 ADR-0003의 기준이 여기서는 저장하라고 가리킨다.
- 모델의 필드 구성이 바뀌면 **낡음으로 표시만 하고 자동 재생성하지 않는다.**
- 샘플 데이터가 없으면 필드 이름을 자리표시자로 쓴다. 비어 있는 채로 보이되 화면은 그려진다.

## 보드에서 문서로 되쓰기

흐름 보드에서 화살표를 이으면 **출발 화면을 선언한 문서**의 머리말 `흐름:`에 항목이 추가된다.
머리말이 없으면 만든다.

### 텍스트 모양은 컴파일러가 책임진다

dahaze가 YAML 들여쓰기와 따옴표 규칙을 흉내 내면 언젠가 어긋난다. `rspdl` Python SDK에
`format`을 노출하고(현재 `compile`·`check`·`find_model`만 있다), dahaze는 거칠게 끼워 넣은 뒤
컴파일러에 넘겨 정규화한다. **컴파일러가 유일한 해석자**라는 경계를 텍스트 모양에도 적용한다.

이것은 이 RFC의 선행 조건이며 rspdl 릴리스가 한 번 더 필요하다.

### 저장하지 않은 초안과 부딪히지 않게

작업대(`document-workbench`)는 저장하지 않은 초안을 `draft-store`에 들고 있다. 보드가 서버에
곧장 쓰면 그 초안이 덮어쓴다.

**보드는 같은 초안 저장소에 쓴다.** 화살표를 그리면 그 문서의 초안 텍스트가 바뀌고, 저장은
지금처럼 사람이 명시적으로 한다. 저장하지 않은 상태가 한 곳에만 있으므로 진실이 갈리지 않는다.
다른 세션이 같은 문서를 바꾼 경우는 이미 있는 `version-mismatch-notice`가 맡는다.

## 저장하는 것

재생성할 수 없는 것만 정규화한다 (ADR-0003).

| | 무엇 | 왜 |
|---|---|---|
| 노드 좌표 | `(project_id, screen_id) → {x, y}` | 사람이 배치한 결정. 좌표는 디자인의 영역이라 언어에 넣지 않기로 했다 (rspdl ADR-0002) |
| 뷰포트 | `project_id → desktop \| mobile \| both` | 프로젝트 구성원이 공유하는 설정 |
| 샘플 데이터 | `(project_id, model_id) → rows` | LLM 출력이라 다시 만들 수 없다 |

그 밖에는 저장하지 않는다. 분류·레이아웃·흐름은 전부 IR에서 읽는다. **초기 설계에 있던
`screen_transitions`·`screen_mockups` 테이블과 출처 대조 게이트는 필요 없어졌다** — 흐름과
구조가 언어로 들어오면서 컴파일러가 이미 그 일을 한다.

## 레이아웃이 없는 화면

레이아웃은 **선택이다.** 필수로 만드는 것을 검토했고 접었다 — 화면을 데이터 생명주기
참여자로만 선언하는 문서가 이미 15개이고 그중 대부분이 `data-usage` conformance fixture다.
그 문서들은 "이 화면에서 생성한다"는 사실만 검증하려는 것인데, 레이아웃을 요구하면 생명주기
테스트마다 화면을 그려야 하고 레이아웃 계층이 자기와 무관한 계층을 오염시킨다. 대표 예제
`field-provenance.rspdl`도 함께 깨진다. **언어는 그대로 둔다.**

대신 보드가 해결한다.

**빈 상자로 그린다.** 조작 선언에서 모양을 유추해 그리지 않는다. 유추한 화면은 기획자가 쓰지
않은 것을 쓴 것처럼 보이게 한다.

**대신 레이아웃 초안을 제안한다.** 빈 상자를 고르면 그 화면의 조작 선언에서 만든 `화면:` 블록
초안을 보여준다. 그려진 화면이 아니라 **문서에 넣을 텍스트**이므로, 받아들이는 순간 그것은
사람이 쓴 선언이 되고 컴파일러가 검증한다. 유추가 진실로 둔갑하지 않는 이유가 이것이다.

초안은 IR이 주는 사실만 쓴다.

| 조작 | 초안에 넣는 것 |
|---|---|
| `input` · `update` 의 필드 | `폼` 안의 `입력` |
| `read` 의 필드 | `목록` 또는 `구역` |
| `create` · `delete` | `버튼` |
| 화면 이름 | `제목` |

받아들인 뒤에는 버튼이 생기므로 **거기서부터 화살표를 끌 수 있다.** 경로는 화면이 아니라
요소에서 출발하고 첫 slice의 출발점은 `버튼`뿐이라, 레이아웃 없는 화면에는 끌 곳이 없다 —
제안을 받아들이는 것이 그 막다른 길을 여는 경로다.

## 알려진 제약

**경로에는 stable ID가 없다.** 보드는 간선을 `(출발 화면, 출발 요소, 도착 화면, 설명)`으로
가리킨다.

## 범위 밖

- LLM에게 머리말 작성법을 가르치는 것. 제약 디코딩용 EBNF에 YAML 부분집합을 넣는 일은 별도다.
- 조건에 따른 분기(decision point) 표기. 언어가 아직 조건의 의미를 다루지 않는다.
- 반응형 분기, 디자인 토큰, 실제 시각 디자인.
- 보드에서 **화면과 분류를 만드는 것.** 문서가 먼저이고 보드는 거울이다. 되쓰기는 흐름 경로와
  받아들인 레이아웃 초안, 둘에만 연다. 그 둘은 보드가 지어내는 것이 아니라 사람이 그은 선과
  IR에서 나온 초안이며, 문서에 들어간 뒤에는 컴파일러가 검증한다.

## References

- [rspdl RFC-0009 문서 머리말 구조 선언](https://github.com/rspdl/rspdl-core/blob/main/docs/rfcs/0009-document-frontmatter-structure.md)
- [ADR-0003 문서 저장 모델](../adr/0003-document-storage-model.md)
- [ADR-0006 Frontend Architecture](../adr/0006-frontend-architecture.md)
- [ADR-0005 MCP 서버와 LLM 저작 루프](../adr/0005-mcp-and-llm-authoring.md)
