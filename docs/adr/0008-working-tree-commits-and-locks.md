---
id: working-tree-commits-and-locks
title: Shared Working Tree, Commits and File Locks
type: adr
status: accepted
version: "1"
summary: Lets humans and AI write a shared per-project working tree directly, records history only through explicit file-selected commits, and serializes AI writes with file locks.
topics:
  - storage
  - versioning
  - authoring
  - mcp
related:
  - document-storage-model
  - mcp-and-llm-authoring
  - planning-workspace-versions
supersedes:
  - planning-workspace-versions
last_updated: "2026-09-26"
owners:
  - rspdl-maintainers
---

# Shared Working Tree, Commits and File Locks

## 상태

Accepted. [ADR-0007](0007-planning-workspace-versions.md)을 대체한다.

## 배경

ADR-0005·0007은 AI가 만든 원문을 초안으로만 보관하고 사람이 명시적으로 apply해야 확정
원문이 바뀌게 했다. 실제 사용에서 이 구조는 두 가지를 막았다.

- AI가 여러 파일을 만들고 옮기고 지우는 작업을 한 턴 안에서 이어 갈 수 없다. 초안
  위에서 다음 도구를 부르려면 초안과 확정 원문을 모두 추적해야 한다.
- 결정·보류·제안·후보·스냅샷으로 상태가 갈라져 화면이 복잡해졌다.

목표 사용 방식은 Claude Code다. 도구가 파일을 바로 바꾸고, 사람은 도구 호출 단위로
변경을 보고, 이력은 commit으로 남긴다.

## 결정

### 공유 작업 트리

프로젝트마다 작업 트리 하나를 모든 멤버와 모든 세션이 같이 쓴다(SVN 방식).

- AI 도구(`add`·`edit`·`mv`·`delete`·`mkdir`)는 작업 트리를 바로 바꾼다.
- 사람은 에디터의 저장 버튼으로 작업 트리를 바꾼다. 동시 편집은 드물다고 보고 병합을
  두지 않는다.
- compiler error 진단이 남은 원문도 저장한다. 진단은 compile 결과로 정확히 보여준다.
- 폴더는 엔티티다. `mv`는 문서 ID를 유지한다.

### commit이 유일한 이력이다

- 리비전은 commit에서만 생긴다. 작업 트리 저장은 리비전을 만들지 않는다.
- commit은 파일을 골라서 만든다. 메시지는 필수다. 사람과 AI 모두 commit할 수 있다.
- 파일마다 변경 종류, 옛 경로·새 경로, diff, 바뀐 뒤의 전문을 남긴다. diff는 표시용이고,
  복원은 전문으로 한다. 역패치 사슬 하나가 깨져 그 이전 이력을 잃는 일을 막는다.
- commit에 진단과 컴파일러 버전은 남기지 않는다. 진단은 언제든 다시 만들 수 있는 파생물이다
  (ADR-0003).
- 기존 `document_revisions`와 ADR-0007의 전달본 스냅샷은 commit으로 대체한다. 이관하지 않고
  문서·이력·기획 상태·AI 작업 기록을 모두 지운 뒤 빈 상태에서 시작한다. 사용자·프로젝트·멤버십은 남긴다.

### AI 쓰기는 파일 잠금으로 직렬화한다

- AI가 파일에 처음 쓸 때 잠금을 얻는다. 폴더 이동·삭제는 안의 파일을 전부 잠근다.
- 앱 AI는 턴을 끝내고 사용자 응답을 기다릴 때 모든 잠금을 푼다. 강제·오류 종료도 같다.
- MCP 클라이언트는 `unlock` 도구로 풀고, 타임아웃이 마지막 안전장치다.
- 잠금은 세션의 마지막 쓰기부터 10분 뒤 만료된다. 만료되면 잠금을 풀고 그 AI 작업을 중단한다.
- 비어 있지 않은 폴더 삭제는 사용자 승인을 받는다(사용자 설정으로 생략 가능). 승인 대기는
  턴 안의 일시정지이므로 잠금을 유지하고 만료 시간을 세지 않는다.
- 잠긴 파일에 다른 세션이 쓰려 하면 도구 오류를 돌려준다. AI는 사용자에게 알리고 턴을
  끝낸다. 턴 종료가 자기 잠금을 풀기 때문에 AI끼리 교착하지 않는다.
- 잠긴 파일은 사람이 저장할 수 없고, 다른 세션의 commit에 넣을 수 없다. 사람의 저장 전
  입력과 AI 쓰기가 부딪히면 AI가 이긴다.

## 대안

- **초안 + 명시적 apply 유지(ADR-0007)** — AI의 연속 도구 호출과 맞지 않는다.
- **도구 호출마다 사람 승인** — 100회까지 도는 턴에서 사람이 병목이 된다.
- **도구 호출마다 리비전** — 한 턴에 리비전 수십 개가 쌓여 이력이 읽히지 않는다.
- **사용자별 작업 트리(git 방식)** — 병합이 필요해진다. 동시 편집이 드문 지금은 비용이 크다.
- **diff만 저장** — 저장량은 적지만 패치 하나가 깨지면 그 이전 이력 전체를 잃는다.

## 결과

- AI 도구와 에디터가 같은 작업 트리를 보므로 화면이 하나의 상태만 그린다.
- 작업 트리에는 컴파일되지 않는 원문이 있을 수 있다. "저장됨"은 "검증됨"이 아니다.
- rspdl을 올린 뒤 옛 commit 원문은 현재 컴파일러로 진단한다. 옛 문법이면 오류가 난다.
- 사람의 저장 전 입력은 AI 쓰기에 밀려 사라질 수 있다.
- 결정·보류·제안 상태, 변경 초안, 스냅샷 테이블과 그 API를 걷어낸다.
- 기존 문서와 이력은 운영 DB에서도 사라진다. 배포 전에 백업을 남긴다.
