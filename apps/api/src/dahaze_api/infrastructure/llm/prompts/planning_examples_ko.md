
# planning contracts 확장 예시

아래 예시는 `rspdl.planning-contracts.v1` capability가 확인된 compiler에서만 사용한다.

## 확장 예시 1 — 모든 화면 요소의 stable ID

지시: "상품을 생성하고 이름을 입력해 목록으로 확인하는 한 화면을 만든다. 머리말에 상품 입력 제목을
두고, 본문 구역에 입력 폼·목록·미리보기 자리·저장 버튼을 둔다. 이후 구조화 편집을 위해 모든 요소에
stable ID를 둔다. 저장 버튼의 행동은 아직 정하지 않는다."

    ---
    모듈: 상품(catalog)
    화면:
      상품 입력 화면:
        레이아웃:
          - 머리말:
              id: header
              자식:
                - 제목: { id: title, 글: "상품 입력" }
          - 구역:
              id: content
              자식:
                - 폼:
                    id: product_form
                    입력:
                      - 입력: { id: name_input, 필드: 이름 }
                - 목록: { id: products, 모델: 상품, 필드: [이름] }
                - 자리: { id: preview, 이름: "미리보기" }
                - 버튼: { id: submit, 이름: "저장" }
    ---

    상품(product)은 다음 필드들로 구성되어 있다.
        이름(name): 필수 문자열
    상품 입력 화면(product_form)에서는 `상품`을 생성할 수 있다.
    상품 입력 화면(product_form)에서는 `상품`의 `이름`을 입력할 수 있다.
    상품 입력 화면(product_form)에서는 `상품`의 `이름`을 조회할 수 있다.

## 확장 예시 2 — 조회 데이터, outcome, 같은 화면 처리와 retry

지시: "먼저 예약 등록 화면에서 연락처를 입력해 예약을 만들고 조회 화면으로 이동한다. 조회 화면에서
고객이 기존 예약의 연락처를 조회한다. 찾으면 완료 화면으로 가고, 찾지 못하면 현재 화면에 메시지를
보여준 뒤 같은 조회 버튼으로 재시도할 수 있다. 완료 화면에는 연락처가 필요하다."

    ---
    모듈: 예약(booking)
    화면:
      예약 등록 화면:
        레이아웃:
          - 폼:
              id: registration_form
              입력:
                - 입력: { id: registration_contact, 필드: 연락처 }
          - 버튼: { id: next, 이름: "조회로 이동" }
      예약 화면:
        역할: [고객]
        권한:
          - 역할: 고객
            행동: 조회
            모델: 예약
            필드: 연락처
        레이아웃:
          - 구역:
              id: search
              자식:
                - 버튼: { id: lookup, 이름: "조회", 행동: 조회 }
      예약 완료 화면:
        레이아웃:
          - 제목: { id: completed_title, 글: "완료" }
    조회 결과:
      reservation_lookup:
        행동: 조회
        입력: 대상 예약
        모델: 예약
        필드: [연락처]
    행동 결과:
      조회:
        - id: found
          유형: 성공
          제공 데이터:
            - 모델: 예약
              필드: 연락처
              조회 결과: reservation_lookup
        - id: not_found
          유형: 실패
          복구: { 종류: retry, 화면: 예약 화면, 요소: lookup, 행동: 조회 }
    흐름:
      - id: booking.start_path
        출발: 예약 등록 화면.next
        도착: 예약 화면
      - id: booking.found_path
        출발: 예약 화면.lookup
        결과: found
        도착: 예약 완료 화면
      - 출발: 예약 화면.lookup
        결과: not_found
        처리:
          종류: 메시지
          id: missing
          내용: "예약을 찾지 못했습니다."
    업무:
      예약 완료(complete):
        시작: 예약 화면
        완료:
          - 화면: 예약 완료 화면
            필수 데이터:
              - 모델: 예약
                필드: 연락처
    ---

    예약(reservation)은 다음 필드들로 구성되어 있다.
        연락처(contact): 필수 문자열

    고객(customer)은 역할이다.
    조회(lookup)는 행동이다.
    `조회`는 기존 `예약`을 대상 예약(target_reservation)으로 입력받는다.
    `고객`은 `예약`의 `연락처`를 `조회`할 수 있다.
    예약 등록 화면(create_screen)에서는 `예약`을 생성할 수 있다.
    예약 등록 화면(create_screen)에서는 `예약`의 `연락처`를 입력할 수 있다.
    예약 화면(lookup_screen)에서는 `예약`의 `연락처`를 조회할 수 있다.
    예약 완료 화면(done_screen)에서는 `예약`의 `연락처`를 조회할 수 있다.

## 확장 예시 3 — 정보구조와 수동 입력 데이터 획득

지시: "예약 입력 화면에서 연락처를 입력하고 결제 버튼을 누른다. 결제 성공이면 예약 완료 화면으로
이동하고 실패하면 현재 화면에 메시지를 보여준 뒤 같은 버튼으로 다시 시도한다. 두 화면을 예약 > 결제
정보구조에 배치하고, 완료할 때 연락처가 확보되어 있어야 한다."

    ---
    모듈: 예약 결제(booking_payment)
    정보구조:
      예약(booking):
        결제(payment): [예약 입력 화면, 예약 완료 화면]
    화면:
      예약 입력 화면:
        레이아웃:
          - 폼:
              id: booking_form
              입력:
                - 입력: { id: contact_input, 필드: 연락처 }
          - 버튼: { id: pay, 이름: "결제", 행동: 결제 }
      예약 완료 화면:
        레이아웃:
          - 제목: { id: done_title, 글: "예약 완료" }
    행동 결과:
      결제:
        - id: paid
          유형: 성공
        - id: declined
          유형: 실패
          복구: { 종류: retry, 화면: 예약 입력 화면, 요소: pay, 행동: 결제 }
    흐름:
      - id: booking.paid_path
        출발: 예약 입력 화면.pay
        결과: paid
        도착: 예약 완료 화면
      - 출발: 예약 입력 화면.pay
        결과: declined
        처리: { 종류: 메시지, id: payment_declined, 내용: "결제에 실패했습니다." }
    업무:
      예약 결제 완료(complete_payment):
        시작: 예약 입력 화면
        획득:
          - 출발: 예약 입력 화면.pay
            데이터:
              - 모델: 예약
                필드: 연락처
        완료:
          - 화면: 예약 완료 화면
            필수 데이터:
              - 모델: 예약
                필드: 연락처
    ---

    예약(reservation)은 다음 필드들로 구성되어 있다.
        연락처(contact): 필수 문자열

    결제(pay)는 행동이다.
    예약 입력 화면(create_booking)에서는 `예약`을 생성할 수 있다.
    예약 입력 화면(create_booking)에서는 `예약`의 `연락처`를 입력할 수 있다.
    예약 완료 화면(done_screen)에서는 `예약`의 `연락처`를 조회할 수 있다.
