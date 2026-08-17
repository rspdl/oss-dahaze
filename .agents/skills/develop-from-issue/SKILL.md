---
name: develop-from-issue
description: Take a dahaze change from issue to merged PR using the project's branch, commit, review, and release conventions. Use when starting new work, creating a branch or PR, writing commit messages, or promoting develop to production.
---

# 이슈에서 배포까지

누가 작업하든 같은 경로를 지나게 하기 위한 절차다. 사람과 에이전트가 같은 문서를 읽는다.

```
이슈 → 브랜치 → 작업 → check.sh → PR(develop) → 리뷰 → 머지
                                                      → develop→main PR → 배포
```

## 1. 이슈부터

무엇을·왜 바꾸는지가 이슈에 먼저 있어야 한다. 템플릿이 셋이다.

| 템플릿 | 언제 |
|---|---|
| `bug.yml` | 의도와 다르게 동작할 때 |
| `feature.yml` | 새 기능·개선. **기능이 아니라 원인부터** 적는다 |
| `rspdl-version.yml` | rspdl 핀을 올릴 때 |

이슈 없이 PR을 열어도 되는 경우는 오타 수정과 명백한 문서 개선뿐이다.

구현 전에 논의가 필요한 변경:

- API 계약(openapi) 변경
- DB 스키마 변경
- RSPDL 버전 요구사항 변경
- 아키텍처 경계(ADR-0001) 변경
- 새 서드파티 의존성 추가

## 2. 브랜치

`develop` 에서 딴다. `develop` 이 기본 브랜치다.

```console
git switch develop && git pull
git switch -c feat/42-document-editor
```

접두사는 변경 성격에 맞춘다: `feat/` `fix/` `docs/` `refactor/` `chore/`.
숫자는 이슈 번호다.

## 3. 작업

바꾸는 영역에 맞는 스킬을 먼저 읽는다.

| 바꾸는 것 | 스킬 |
|---|---|
| REST 엔드포인트 | `.agents/skills/generate-api/` |
| 공용 컴포넌트·디자인 토큰 | `.agents/skills/manage-ui-package/` |
| rspdl 버전 | `.agents/skills/upgrade-rspdl/` |

지켜야 하는 경계는 CI가 검사한다 (`scripts/check_boundaries.py`).

- `import rspdl` 은 `infrastructure/rspdl/` 안에서만
- `import openai` 는 `infrastructure/llm/` 안에서만
- `domain/` 은 다른 계층도 프레임워크도 import하지 않는다
- `application/` 은 `infrastructure/`·`interface/` 를 import하지 않는다

## 4. 커밋

[Conventional Commits](https://www.conventionalcommits.org/). `rspdl-core` 와 같은 규칙이다.

```
feat(api): 문서 리비전 조회 엔드포인트 추가
fix(web): 진단 gutter 가 빈 span 에서 깨지는 문제
chore(deps): rspdl 0.2.0 으로 승격
```

타입: `feat` `fix` `docs` `refactor` `perf` `test` `build` `ci` `chore`
스코프: `api` `web` `ui` `api-client` `infra` `adr`

호환되지 않는 변경은 `!` 를 붙인다: `feat(api)!: 진단 응답 형식 변경`

## 5. 제출 전

```console
./scripts/check.sh
```

플랫폼, 아키텍처 경계, 린트, 타입, 테스트, OpenAPI 드리프트, codegen을 한 번에 돈다.
CI와 같은 게이트이므로, 여기서 통과하면 CI에서도 통과한다.

## 6. PR

대상은 `develop` 이다. 템플릿의 항목을 채운다. 특히 **영향 범위** 체크박스는 리뷰어가
무엇을 봐야 하는지 결정하는 근거이므로 정확히 표시한다.

- `Closes #42` 로 이슈를 연결한다
- 하나의 PR에 하나의 목적만 담는다
- 리팩터링과 동작 변경은 분리한다

## 7. 리뷰

- 이해하지 못한 의견은 추측하지 말고 질문한다
- 자기 변경의 동작과 설계 결정을 설명할 수 있어야 한다
- CI가 빨간 채로 머지하지 않는다

## 8. 릴리스

`develop` → `main` PR이 릴리스 단위다. 머지되면 태그가 붙고 프로덕션 배포가 돈다.

```console
gh pr create --base main --head develop --title "release: 2026-08-24"
```

릴리스 PR 본문에는 포함된 변경 목록과, **DB 마이그레이션·rspdl 버전 변경·인프라 변경이
있는지**를 적는다. 이 셋은 롤백 비용이 다르므로 배포 전에 알아야 한다.

`main` 에 직접 푸시하지 않는다.

## 배포가 실패하면

배포는 마이그레이션(`alembic upgrade head`)을 트래픽 받기 전에 돌린다. 마이그레이션이 실패하면
배포가 중단되고 이전 버전이 그대로 뜬다.

`main` 을 되돌리기 전에 원인을 먼저 본다 — 마이그레이션 실패인지, 이미지 빌드 실패인지,
플랫폼 불일치인지(`./scripts/check_platform.sh`)에 따라 대응이 다르다.
