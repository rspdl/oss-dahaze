import type { RspdlDiagnostic } from '@dahaze/rspdl-editor'

/**
 * 컴파일러 진단을 한국어 화면 문구로 옮긴다.
 *
 * 이 모듈은 진단을 새로 판단하지 않는다. `message_key` 와 `arguments` 로 rspdl-ko 가
 * 정한 문장을 결정적으로 렌더링할 뿐이며, severity·rule_id·span 은 입력에 그대로 남는다.
 */

type Arguments = Readonly<Record<string, string>>
type Renderer = (arguments_: Arguments) => string

const DIAGNOSTIC_TITLES: Readonly<Record<string, string>> = {
  'semantic.lifecycle.field_producer_missing': '필드 값이 만들어지는 경로가 없습니다',
  'semantic.lifecycle.model_creator_missing': '데이터가 생성되는 경로가 없습니다',
  'semantic.lifecycle.produced_field_unread': '만든 값을 사용하는 화면이 없습니다',
  'semantic.action_data_mutation.duplicate': '같은 행동 결과가 중복되어 있습니다',
  'semantic.action_data_mutation.conflict': '한 행동의 결과가 서로 충돌합니다',
  'semantic.relation.compatibility_conflict': '관계 규칙이 서로 충돌합니다',
  'semantic.derivation.multiple_producers': '한 필드의 값을 두 곳에서 만들고 있습니다',
  'semantic.derivation.duplicate_target': '같은 필드의 계산식이 중복되어 있습니다',
  'semantic.derivation.cross_model_scope_unknown': '합계의 계산 범위가 정해지지 않았습니다',
  'semantic.recalculation.exactly_one_required': '재계산 시점이 명확하지 않습니다',
  'semantic.recalculation.source_mismatch': '재계산에 사용하는 원본 필드가 다릅니다',
  'semantic.recalculation.derivation_missing': '재계산할 계산식이 없습니다',
}

const STATIC_MESSAGES: Readonly<Record<string, string>> = {
  'ko.lex.tab_indentation': '들여쓰기에 tab을 사용할 수 없습니다.',
  'ko.lex.inconsistent_dedent': '이전 블록과 일치하지 않는 들여쓰기입니다.',
  'ko.lex.unclosed_quoted_identifier': '닫히지 않은 backtick 식별자입니다.',
  'ko.lex.invalid_string_literal': '문자열 literal 형식이 올바르지 않습니다.',
  'ko.syntax.module_required': '문서는 모듈 선언으로 시작해야 합니다.',
  'ko.syntax.module_header_required':
    '문서는 @모듈 표시 이름(stable_id) 선언으로 시작해야 합니다.',
  'ko.syntax.unexpected_top_level_indent':
    '최상위 선언이 아닌 위치에 들여쓴 항목이 있습니다.',
  'ko.syntax.unknown_top_level_declaration': '알 수 없는 최상위 선언입니다.',
  'ko.syntax.item_period_forbidden': '선언 항목에는 마침표를 사용하지 않습니다.',
  'ko.syntax.enum_value_required': '열거형 값이 필요합니다.',
  'ko.syntax.field_colon_required': '필드 표시 이름 뒤에 :이 필요합니다.',
  'ko.syntax.field_shape_required':
    '필드는 표시 이름(local_id): 필수|선택 타입 형식이어야 합니다.',
  'ko.syntax.field_requiredness_required': '필드는 필수 또는 선택을 선언해야 합니다.',
  'ko.syntax.screen_must_be_sentence':
    '화면 동작은 들여쓰기 블록 없이 한 문장으로 작성해야 합니다.',
  'ko.syntax.screen_stable_id_required': '화면 stable ID가 필요합니다.',
  'ko.syntax.screen_field_operation_required': '화면의 필드 동작이 누락되었습니다.',
  'ko.syntax.screen_field_operation_invalid':
    '필드 동작은 입력할, 조회할, 수정할 중 하나여야 합니다.',
  'ko.syntax.screen_model_operation_invalid':
    '데이터 동작은 생성할, 조회할, 수정할, 삭제할 중 하나여야 합니다.',
  'ko.syntax.action_data_mutation_invalid':
    '행동 결과는 생성한다, 수정한다, 삭제한다 중 하나여야 합니다.',
  'ko.syntax.action_input_stable_id_required':
    '행동 입력의 표시 이름 뒤에 stable ID가 필요합니다.',
  'ko.syntax.action_input_name_marker_required':
    '행동 입력 이름과 stable ID 뒤에는 로 또는 으로가 필요합니다.',
  'ko.syntax.creation_branch_stable_id_required':
    '조건부 생성 branch의 표시 이름 뒤에 stable ID가 필요합니다.',
  'ko.syntax.creation_branch_topic_marker_required':
    '조건부 생성 branch 이름 뒤에는 은 또는 는이 필요합니다.',
  'ko.syntax.creation_branch_result_invalid':
    '조건부 생성 결과는 하나 생성한다 또는 생성하지 않는다여야 합니다.',
  'ko.syntax.creation_branch_condition_marker_invalid':
    '조건부 생성 조건은 행동의 입력이 enum 값이면 형식이어야 합니다.',
  'ko.syntax.creation_branch_result_marker_invalid':
    '조건부 생성 결과의 output model 뒤에는 을 또는 를이 필요합니다.',
  'ko.syntax.field_producer_stable_id_required': '필드 생산자의 stable ID가 필요합니다.',
  'ko.syntax.field_producer_topic_marker_required':
    '필드 생산자 이름 뒤에는 은 또는 는이 필요합니다.',
  'ko.syntax.field_producer_literal_required': '상수 생산자에는 literal이 필요합니다.',
  'ko.syntax.field_producer_literal_marker_required':
    '상수 literal 뒤에는 을 또는 를이 필요합니다.',
  'ko.syntax.template_string_required': '알림 내용 조합에는 문자열 template이 필요합니다.',
  'ko.syntax.template_unmatched_brace':
    'template의 { 또는 } 짝이 맞지 않습니다. literal brace는 {{ 또는 }}로 쓰세요.',
  'ko.syntax.template_empty_placeholder': 'template placeholder는 비워둘 수 없습니다.',
  'ko.syntax.template_nested_placeholder':
    'template placeholder 안에 {를 중첩할 수 없습니다.',
  'ko.syntax.relation_producer_stable_id_required': '관계 생산자의 stable ID가 필요합니다.',
  'ko.syntax.relation_producer_topic_marker_required':
    '관계 생산자 이름 뒤에는 은 또는 는이 필요합니다.',
  'ko.syntax.field_list_required': '필드 목록이 필요합니다.',
  'ko.syntax.field_list_empty_name': '빈 필드 이름은 사용할 수 없습니다.',
  'ko.syntax.field_list_invalid': '필드 목록 형식이 올바르지 않습니다.',
  'ko.syntax.field_list_final_marker_required':
    '마지막 필드에는 을 또는 를이 필요합니다.',
  'ko.syntax.field_intent_invalid':
    '필드는 내부 관리 또는 사용자 화면 비표시 중 하나로 분류해야 합니다.',
  'ko.syntax.constraint_block_forbidden':
    '제약 문장 아래에는 별도 블록을 둘 수 없습니다.',
  'ko.syntax.policy_block_forbidden': '정책 문장 아래에는 별도 블록을 둘 수 없습니다.',
  'ko.syntax.policy_effect_invalid': '정책은 수 있다 또는 수 없다로 끝나야 합니다.',
  'ko.syntax.field_comparison_invalid':
    '필드 비교는 같아야 또는 달라야를 사용해야 합니다.',
  'ko.syntax.period_required': '완전한 문장은 마침표로 끝나야 합니다.',
  'ko.syntax.declaration_punctuation_forbidden':
    '선언 줄에는 마침표나 콜론을 사용하지 않습니다.',
  'ko.syntax.declaration_id_required': '선언 ID가 필요합니다.',
  'ko.syntax.natural_header_period_required':
    '데이터와 열거형 header는 마침표로 끝나는 문장이어야 합니다.',
  'ko.syntax.declaration_topic_marker_required': '선언 이름 뒤에 은 또는 는이 필요합니다.',
  'ko.syntax.stable_id_required': '선언에 stable ID가 필요합니다.',
  'ko.syntax.display_name_required': '표시 이름이 필요합니다.',
  'ko.syntax.display_name_invalid': '표시 이름 형식이 올바르지 않습니다.',
  'ko.syntax.block_item_required': '블록에는 하나 이상의 항목이 필요합니다.',
  'ko.syntax.block_indent_inconsistent': '블록 항목의 들여쓰기 깊이가 일정하지 않습니다.',
  'ko.syntax.field_type_required': '필드 타입이 필요합니다.',
  'ko.syntax.field_type_invalid': '필드 타입 형식이 올바르지 않습니다.',
  'ko.syntax.relation_stable_id_required': '관계 선언에 stable ID가 필요합니다.',
  'ko.syntax.relation_direction_marker_required':
    '관계 이름 뒤에는 로 또는 으로가 필요합니다.',
  'ko.syntax.relational_constraint_group_references':
    '그룹 관계 규칙에는 서로 다른 관계 참조가 둘 이상 필요합니다.',
  'ko.syntax.reference_list_required': '하나 이상의 참조가 필요합니다.',
  'ko.syntax.reference_list_empty_name': '참조 목록에 빈 이름이 있습니다.',
  'ko.syntax.reference_list_invalid': '참조 목록 형식이 올바르지 않습니다.',
  'ko.syntax.reference_list_final_marker_required':
    '관계 목록의 마지막 이름 뒤에는 은 또는 는이 필요합니다.',
  'ko.syntax.reference_and_marker_required': '문장에 필요한 이름과 조사가 누락되었습니다.',
  'ko.syntax.quoted_reference_marker_required':
    '인용된 이름 뒤에 구조 marker가 필요합니다.',
  'ko.syntax.surface_name_required': '표면 이름이 필요합니다.',
  'ko.syntax.comparison_value_required': '제약의 비교 값이 누락되었습니다.',
  'ko.syntax.not_equal_shape_required': '과/와 달라야 한다 문형이 필요합니다.',
  'ko.syntax.integer_order_shape_required': '<정수>보다 커야/작아야 한다 문형이 필요합니다.',
  'ko.syntax.order_suffix_required': '보다 커야/작아야가 필요합니다.',
  'ko.syntax.integer_comparison_unsupported': '지원하지 않는 정수 비교 문형입니다.',
  'ko.syntax.literal_unsupported': '지원하지 않는 literal입니다.',
  'ko.syntax.trailing_expression': '문장 뒤에 예상하지 못한 표현이 있습니다.',
  'semantic.derivation.sum_requires_integer':
    '합계의 원본과 결과 필드는 모두 정수여야 합니다.',
  'semantic.derivation.cross_model_scope_unknown':
    '교차 모델 합계의 레코드 선택 관계가 정의되지 않아 계산 범위는 unknown입니다.',
}

function argument(arguments_: Arguments, key: string): string {
  return arguments_[key] ?? '<?>'
}

function objectMarker(value: string): '을' | '를' {
  const last = value.at(-1)
  if (last === undefined || last < '가' || last > '힣') return '을'
  return (last.charCodeAt(0) - '가'.charCodeAt(0)) % 28 === 0 ? '를' : '을'
}

function syntaxKind(kind: string): string {
  const names: Readonly<Record<string, string>> = {
    action_data_mutation: '행동 데이터 결과',
    sum_derivation: '계산',
    recalculation: '재계산',
    field_intent: '필드 사용 의도',
    creation_branch: '조건부 생성 branch',
    field_producer: '필드 생산자',
    relation: '관계 선언',
    entity: '개체 선언',
    relational_constraint: '관계 메타 규칙',
  }
  return names[kind] ?? kind
}

const MESSAGE_RENDERERS: Readonly<Record<string, Renderer>> = {
  'ko.lex.unclosed_stable_id': (arguments_) =>
    `${argument(arguments_, 'closing')}로 닫히지 않은 stable ID입니다.`,
  'ko.syntax.domain_annotation_forbidden': (arguments_) =>
    `${argument(arguments_, 'annotation')} annotation은 사용할 수 없습니다. @는 문서 metadata인 @모듈에만 허용됩니다.`,
  'ko.syntax.template_path_placeholder_forbidden': (arguments_) =>
    `template placeholder ${argument(arguments_, 'placeholder')}은 output field 이름 하나여야 하며 경로를 쓸 수 없습니다.`,
  'ko.syntax.sentence_block_forbidden': (arguments_) =>
    `${syntaxKind(argument(arguments_, 'kind'))} 문장 아래에는 들여쓰기 블록을 둘 수 없습니다.`,
  'ko.syntax.annotated_declaration_required': (arguments_) =>
    `${argument(arguments_, 'keyword')} 표시 이름(${argument(arguments_, 'id_kind')}) 선언이 필요합니다.`,
  'ko.syntax.reference_marker_invalid': (arguments_) =>
    `${argument(arguments_, 'reference')} 뒤에는 ${argument(arguments_, 'expected')} 중 하나가 필요합니다.`,
  'ko.syntax.reference_marker_missing': (arguments_) =>
    `${argument(arguments_, 'reference')}에서 ${argument(arguments_, 'expected')} marker를 찾을 수 없습니다.`,
  'ko.syntax.word_required': (arguments_) => `${argument(arguments_, 'expected')}가 필요합니다.`,
  'semantic.lifecycle.field_producer_missing': (arguments_) => {
    const fieldId = argument(arguments_, 'field_id')
    return `필드 ${fieldId}${objectMarker(fieldId)} 만드는 화면 입력 또는 계산이 없습니다.`
  },
  'semantic.lifecycle.model_creator_missing': (arguments_) => {
    const modelId = argument(arguments_, 'model_id')
    return `데이터 모델 ${modelId}${objectMarker(modelId)} 생성하는 화면 또는 행동 결과가 없습니다.`
  },
  'semantic.lifecycle.produced_field_unread': (arguments_) =>
    `필드 ${argument(arguments_, 'field_id')}은 만들어지지만 어떤 화면에서도 조회되지 않습니다.`,
  'semantic.action_data_mutation.duplicate': (arguments_) =>
    `행동 ${argument(arguments_, 'action_id')}의 데이터 모델 ${argument(arguments_, 'model_id')}에 대한 ${argument(arguments_, 'mutation')} 결과가 중복 선언되었습니다.`,
  'semantic.action_data_mutation.conflict': (arguments_) =>
    `행동 ${argument(arguments_, 'action_id')}은 데이터 모델 ${argument(arguments_, 'model_id')}에 서로 양립할 수 없는 결과 ${argument(arguments_, 'mutations')}를 동시에 선언할 수 없습니다.`,
  'semantic.relation.compatibility_conflict': (arguments_) => {
    const relationIds = argument(arguments_, 'relation_ids')
    return `같은 관계 그룹 ${relationIds}${objectMarker(relationIds)} 배타적이면서 공존 가능하다고 선언할 수 없습니다.`
  },
  'semantic.derivation.multiple_producers': (arguments_) =>
    `계산 필드 ${argument(arguments_, 'field_id')}은 화면 입력과 계산 결과를 동시에 생산자로 가질 수 없습니다.`,
  'semantic.derivation.duplicate_target': (arguments_) =>
    `필드 ${argument(arguments_, 'field_id')}의 계산식이 중복 선언되었습니다.`,
  'semantic.recalculation.exactly_one_required': (arguments_) =>
    `계산 필드 ${argument(arguments_, 'field_id')}은 재계산 시점을 정확히 하나 선언해야 합니다. 현재 ${argument(arguments_, 'actual')}개입니다.`,
  'semantic.recalculation.source_mismatch': (arguments_) =>
    `재계산 원본 필드가 다릅니다. 기대 ${argument(arguments_, 'expected_field_id')}, 실제 ${argument(arguments_, 'actual_field_id')}.`,
  'semantic.recalculation.derivation_missing': (arguments_) =>
    `필드 ${argument(arguments_, 'field_id')}의 재계산 조건에 대응하는 계산식이 없습니다.`,
}

function fallback(diagnostic: RspdlDiagnostic): string {
  if (diagnostic.message !== undefined) return diagnostic.message

  const entries = Object.entries(diagnostic.arguments ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  if (entries.length === 0) return diagnostic.message_key

  const argumentsText = entries.map(([key, value]) => `${key}=${value}`).join(', ')
  return `${diagnostic.message_key} (${argumentsText})`
}

export function renderDiagnosticMessage(diagnostic: RspdlDiagnostic): string {
  /*
   * 서버가 이미 사람 말로 바꿔 준 문구가 있으면 그것이 이긴다. 아는 key 라고 우리 표를 먼저
   * 보면 컴파일러가 한 말을 화면이 덮어쓰는 셈이고, 그 순간 진단의 출처가 둘로 갈린다.
   * 우리 표는 컴파일러가 문장을 주지 않을 때를 위한 것이다.
   */
  if (diagnostic.message !== undefined) return diagnostic.message

  const staticMessage = STATIC_MESSAGES[diagnostic.message_key]
  if (staticMessage !== undefined) return staticMessage

  const renderer = MESSAGE_RENDERERS[diagnostic.message_key]
  if (renderer !== undefined) return renderer(diagnostic.arguments ?? {})

  return fallback(diagnostic)
}

/** 상세 문장을 읽기 전에 문제 종류를 알아볼 수 있는 짧은 제목. */
export function renderDiagnosticTitle(diagnostic: RspdlDiagnostic): string {
  const title = DIAGNOSTIC_TITLES[diagnostic.message_key]
  if (title !== undefined) return title
  if (diagnostic.message_key.startsWith('ko.lex.')) return '문자 형식을 확인해 주세요'
  if (diagnostic.message_key.startsWith('ko.syntax.')) return '문장 형식을 확인해 주세요'
  return '확인할 문제가 있습니다'
}
