---
id: document-storage-model
title: Document Storage Model
type: adr
status: accepted
version: "1"
summary: Stores RSPDL source text as the only truth and treats every compiler output as a regenerable cache keyed by source hash and rspdl version.
topics:
  - storage
  - database
  - versioning
related:
  - rspdl-compiler-integration
  - monorepo-structure-and-stack
last_updated: "2026-08-17"
owners:
  - rspdl-maintainers
---

# Document Storage Model

## 상태

Accepted.

## 배경

RSPDL 문서를 저장하는 방법은 크게 셋이었다.

1. 소스 텍스트만 저장하고 컴파일 결과는 파생물로 둔다.
2. 컴파일된 IR(모델·필드·정책)을 관계형 테이블로 정규화해 저장한다.
3. 1번 + 목록·검색용 비정규화 프로젝션.

2번은 매력적이다. `모든 정책 중 조건이 비어 있는 것` 같은 질의를 SQL로 바로 쓸 수 있다.
그러나 RSPDL이 `0.x`라는 사실이 이 선택의 비용을 바꾼다. 현재 module 의 최상위 키는
`id / name / enums / models / constraints / roles / actions / policies` 인데, 이건 언제든 바뀔 수
있는 대상이다. IR을 테이블로 굳히면 **rspdl 버전을 올릴 때마다 DB 마이그레이션이 따라붙는다.**

## 결정

**소스 텍스트가 유일한 진실이고, 컴파일러가 산출한 모든 것은 언제든 버리고 다시 만들 수 있는
캐시다.**

### 스키마 요지

```
users                  ─┐
user_identities         │  (provider, provider_user_id) — 벤더 추가 가능
projects               ─┤
documents               │  text = 현재 본문, target_rspdl_version
document_revisions      │  편집 이력 (text 전문 보관)
compilations           ─┘  파생 캐시
```

`documents.text` 와 `document_revisions.text` 가 진실이다. 스키마는 RSPDL 문법을 전혀 모른다 —
문법이 바뀌어도 이 테이블들은 그대로다.

### 컴파일 캐시

`compilations` 의 자연키는 다음과 같다.

```
(workspace_hash, rspdl_version, wire_schema_version, locale, kind)
```

- `workspace_hash` — 요청에 포함된 `(path, text)` 쌍을 경로순 정렬해 SHA-256
- `kind` — `compile` | `check` | `find_model`
- `result` — SDK 응답을 **손대지 않은 JSONB 그대로**. 래퍼가 필드를 재작성하지 않는다.

rspdl 버전이 키에 있으므로, 버전을 올리면 캐시가 저절로 무효가 된다. 별도의 무효화 로직이 없다.

`find_model` 은 `scope_per_model` 과 `timeout_ms` 도 키에 포함한다. 같은 소스라도 scope 에 따라
`SAT` / `UNSAT_WITHIN_BOUND` 가 갈리기 때문이다.

### 진단을 정규화하지 않는다

진단(`rule_id`, `severity`, `message_key`, `arguments`, `span`)을 테이블로 쪼개고 싶은 유혹이 있다.
하지 않는다. 진단 스키마는 컴파일러가 소유하고 `0.x` 동안 변한다. 목록·필터가 필요하면 JSONB
인덱스로 처리하고, 그래도 부족해지면 그때 **재생성 가능한** 프로젝션 테이블을 추가한다.

원칙: **재생성할 수 없는 것만 정규화한다.** 사용자가 친 텍스트, 누가 언제 썼는지, 프로젝트 소속
관계는 재생성할 수 없으므로 정규화한다. 컴파일러가 뱉은 것은 전부 재생성 가능하다.

## 결과

- rspdl 버전업이 DB 마이그레이션을 유발하지 않는다. 재컴파일만 하면 된다.
- `compilations` 테이블은 언제든 통째로 비울 수 있다. 데이터 손실이 아니다.
- IR 기반 고급 질의는 지금 못 한다. 필요해지는 시점에 프로젝션으로 추가한다.
