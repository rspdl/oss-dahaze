'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  useReviseRspdlDocument,
  type AuthoringDraftResponse,
} from '@dahaze/api-client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  ScrollArea,
  Textarea,
  toast,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { SparkleIcon, SpinnerIcon } from '@/shared/ui/icons'
import { diffLines, summarizeDiff } from './diff-lines'
import { DraftResult, describeChange } from './draft-result'

/**
 * 화면에만 남는 대화 한 턴.
 *
 * 실패도 턴이다. 토스트로만 알리면 무엇을 요청했다가 왜 못 받았는지가 사라지고, 사용자는
 * 자기가 뭘 눌렀는지 기억에 의존해야 한다.
 */
type Turn =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; draft: AuthoringDraftResponse }
  | { id: number; role: 'assistant-error'; message: string }

/** 아직 번호가 붙지 않은 턴. 번호는 붙이는 쪽이 정한다. */
type NewTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; draft: AuthoringDraftResponse }
  | { role: 'assistant-error'; message: string }

/**
 * LLM 에게 이 문서를 고쳐 달라고 하는 자리.
 *
 * **세 가지가 분명해야 한다.**
 *
 * 1. 저작 엔드포인트는 **문서를 저장하지 않는다** (ADR-0005). 돌아온 것은 초안일 뿐이다.
 * 2. 초안을 편집기로 가져와도 **여전히 저장되지 않은 상태**다. 저장은 사람이 따로 누른다.
 * 3. 초안은 항상 컴파일 결과와 함께 온다. 진단이 남아 있어도 실패가 아니다 — 반쯤 맞는
 *    초안과 그 진단은 사람이 판단할 재료다.
 *
 * `revise` 는 문서 전문을 다시 써서 돌려준다. 부분 수정본이 아니므로 가져오면 편집 중이던
 * 내용을 통째로 덮는다. 그래서 "적용" 은 한 번 더 확인을 거치고, 그 전에 무엇이 바뀌는지
 * diff 로 먼저 보여준다.
 *
 * **대화는 화면상의 이력일 뿐이다.** `revise` 엔드포인트는 대화 이력을 받지 않으므로 매
 * 요청은 저장된 문서 + 이번 지시만으로 독립적으로 나간다. 여기서 이력을 그럴듯하게 이어
 * 붙이면 API 스키마를 바꾸지 않고도 맥락이 전달되는 것처럼 보이게 되므로, 그 한계를
 * 입력창 옆에 그대로 적어 둔다.
 *
 * 이력은 이 컴포넌트의 로컬 state 다. 서버 상태가 아니고 화면을 벗어나 살아남을 이유도
 * 없어서 zustand 로 올리지 않는다 (ADR-0006). 새로고침하면 사라지는 것은 초기 버전에서
 * 받아들인 결정이다.
 */
export function RevisePanel({
  documentId,
  currentText,
  onApplyDraft,
  suggestedRequest,
}: {
  documentId: string
  /** 편집기에서 지금 편집 중인 본문. 적용 전 미리보기의 "이전" 쪽이다. */
  currentText: string
  /** 초안을 편집기 초안으로 옮긴다. 저장은 여기서 하지 않는다. */
  onApplyDraft: (text: string) => void
  /** 상단 문제 안내의 "AI에게 해결 요청". key 가 바뀔 때마다 새 요청으로 취급한다. */
  suggestedRequest?: { key: number; text: string }
}) {
  const [instruction, setInstruction] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const nextTurnId = useRef(1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const revise = useReviseRspdlDocument()

  const appendTurn = (turn: NewTurn) => {
    const id = nextTurnId.current
    nextTurnId.current += 1
    setTurns((previous) => [...previous, { ...turn, id }])
  }

  const send = (text: string) => {
    const request = text.trim()
    if (request === '' || revise.isPending) return

    appendTurn({ role: 'user', text: request })
    setInstruction('')
    revise.mutate(
      { documentId, data: { instruction: request } },
      {
        onSuccess: (response) => {
          appendTurn({ role: 'assistant', draft: response })
        },
        onError: (error) => {
          // 실패를 턴으로 남긴다. 토스트를 겹쳐 띄우면 같은 말을 두 번 하는 셈이고,
          // 사라지는 쪽이 먼저 눈에 들어와 이력을 못 보게 된다.
          appendTurn({ role: 'assistant-error', message: errorMessage(error) })
        },
      },
    )
  }

  // useEffect 안에서 부를 최신 send. 대화 state 를 deps 에 끌고 들어오면 같은 요청이
  // 다시 나갈 수 있다.
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  })

  const lastSuggestedKey = useRef<number | null>(null)
  useEffect(() => {
    if (suggestedRequest === undefined) return
    if (lastSuggestedKey.current === suggestedRequest.key) return
    lastSuggestedKey.current = suggestedRequest.key

    /*
     * 문제 안내에서 넘어온 요청은 **자동으로 보낸다.** "AI에게 해결 요청" 을 누른 사람은
     * 이미 요청을 한 것이고, 오른쪽에서 버튼을 한 번 더 누르게 하면 흐름이 끊긴다.
     * 대신 보낸 문장이 user 턴으로 그대로 남아, 무엇을 요청했는지 사람이 읽을 수 있다.
     */
    // 입력창을 먼저 채운다. 앞선 요청이 아직 진행 중이면 전송은 그냥 넘어가고, 사용자가
    // 직접 보낼 수 있게 문장이 남는다.
    setInstruction(suggestedRequest.text)
    textareaRef.current?.focus()
    sendRef.current(suggestedRequest.text)
  }, [suggestedRequest])

  // 새 턴이 붙으면 아래로 따라간다. 방금 보낸 요청이 화면 밖에 있으면 응답을 기다리는지조차 모른다.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [turns.length, revise.isPending])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    send(instruction)
  }

  /** 실패한 턴 바로 앞의 요청을 그대로 다시 보낸다. */
  const retryBefore = (turnId: number) => {
    const index = turns.findIndex((turn) => turn.id === turnId)
    for (let i = index - 1; i >= 0; i -= 1) {
      const turn = turns[i]
      if (turn !== undefined && turn.role === 'user') {
        send(turn.text)
        return
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-full bg-accent-subtle text-sm text-accent"
          >
            <SparkleIcon className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-text">AI 도우미</h2>
            <p className="text-xs text-text-muted">현재 문서를 함께 다듬습니다.</p>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {turns.length === 0 && !revise.isPending ? (
            <div className="rounded-panel bg-surface-raised px-3 py-3 text-sm leading-relaxed text-text-muted">
              문서에 추가할 내용이나 고치고 싶은 점을 편하게 말해 주세요. 문제 안내에서
              도움을 요청하면 관련 내용이 여기에 자동으로 준비됩니다.
            </div>
          ) : null}

          {turns.map((turn) => {
            if (turn.role === 'user') {
              return (
                <div
                  key={turn.id}
                  className="ml-8 rounded-panel bg-accent px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-on-solid"
                >
                  {turn.text}
                </div>
              )
            }

            if (turn.role === 'assistant-error') {
              return (
                <div
                  key={turn.id}
                  className="mr-4 space-y-2 rounded-panel border bg-diagnostic-error-subtle px-3 py-3"
                >
                  <p className="text-sm font-medium text-diagnostic-error">
                    수정안을 만들지 못했습니다
                  </p>
                  <p className="text-sm leading-relaxed text-text-muted">{turn.message}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revise.isPending}
                    onClick={() => retryBefore(turn.id)}
                  >
                    다시 시도
                  </Button>
                </div>
              )
            }

            return (
              <AssistantTurn
                key={turn.id}
                draft={turn.draft}
                currentText={currentText}
                onApplyDraft={onApplyDraft}
              />
            )
          })}

          {revise.isPending ? (
            <div className="mr-8 flex items-center gap-2 rounded-panel border bg-surface px-3 py-3 text-sm text-text-muted">
              <SpinnerIcon className="size-4" />
              문서를 확인하고 수정안을 준비하고 있습니다…
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <form onSubmit={onSubmit} className="border-t bg-surface p-3">
        <label htmlFor="revise-instruction" className="sr-only">
          AI 도우미에게 요청하기
        </label>
        <Textarea
          id="revise-instruction"
          ref={textareaRef}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          rows={3}
          maxLength={8000}
          placeholder="예: 예약 취소 정책의 충돌을 해결해 줘"
          required
        />
        {turns.length === 0 ? null : (
          <p className="mt-2 text-xs leading-relaxed text-text-subtle">
            앞선 대화는 함께 전달되지 않습니다. 이어서 요청할 때는 필요한 내용을 이번
            문장에 다시 적어 주세요.
          </p>
        )}
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-text-subtle">제안은 자동으로 저장되지 않습니다.</p>
          <Button
            type="submit"
            size="sm"
            disabled={revise.isPending || instruction.trim() === ''}
          >
            {revise.isPending ? '보내는 중…' : 'AI에게 보내기'}
          </Button>
        </div>
      </form>
    </div>
  )
}

/**
 * 수정안 한 건과 그것을 편집기로 가져가는 동작.
 *
 * 적용은 편집 중이던 내용을 통째로 덮으므로, 확인 다이얼로그 안에서도 무엇이 바뀌는지
 * 다시 말한다. "적용" 을 누르는 순간에 보이는 정보가 판단의 근거다.
 */
function AssistantTurn({
  draft,
  currentText,
  onApplyDraft,
}: {
  draft: AuthoringDraftResponse
  currentText: string
  onApplyDraft: (text: string) => void
}) {
  const change = describeChange(summarizeDiff(diffLines(currentText, draft.text)))

  return (
    <div className="mr-4 space-y-3 rounded-panel border bg-surface px-3 py-3">
      <DraftResult draft={draft} currentText={currentText} />
      <div className="flex gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm">편집기에 적용</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>수정안을 편집기에 적용할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                현재 편집 중인 내용 전체가 수정안으로 바뀝니다 — {change}. 적용해도
                자동으로 저장되지 않으며, 저장 전에는 편집 취소로 되돌릴 수 있습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onApplyDraft(draft.text)
                  toast.info('수정안을 편집기에 적용했습니다', {
                    description: '아직 저장되지 않았습니다. 확인한 뒤 저장하세요.',
                  })
                }}
              >
                적용
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
