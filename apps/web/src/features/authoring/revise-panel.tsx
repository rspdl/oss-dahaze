'use client'

import { useState, type FormEvent } from 'react'
import {
  useReviseRspdlDocument,
  type AuthoringDraftResponse,
} from '@dahaze/api-client'
import { Button, ScrollArea, Textarea, toast } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { payload } from '@/shared/api/payload'
import { SpinnerIcon } from '@/shared/ui/icons'
import { DraftResult } from './draft-result'

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
 * 내용을 통째로 덮는다. 그래서 "가져오기" 는 한 번 더 확인을 거친다.
 */
export function RevisePanel({
  documentId,
  onApplyDraft,
}: {
  documentId: string
  /** 초안을 편집기 초안으로 옮긴다. 저장은 여기서 하지 않는다. */
  onApplyDraft: (text: string) => void
}) {
  const [instruction, setInstruction] = useState('')
  const [draft, setDraft] = useState<AuthoringDraftResponse | null>(null)
  const revise = useReviseRspdlDocument()

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    revise.mutate(
      { documentId, data: { instruction: instruction.trim() } },
      {
        onSuccess: (response) => {
          setDraft(payload(response))
        },
        onError: (error) => {
          toast.error('초안을 만들지 못했습니다', { description: errorMessage(error) })
        },
      },
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-medium text-text">LLM 저작</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          초안을 만들어 볼 뿐, 문서는 저장되지 않습니다.
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <form onSubmit={onSubmit} className="space-y-2">
            <label
              htmlFor="revise-instruction"
              className="block text-sm font-medium text-text"
            >
              이 문서를 어떻게 바꿀까요?
            </label>
            <Textarea
              id="revise-instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={4}
              maxLength={8000}
              placeholder="수량에 상한을 두고, 재고 이동 기록을 추가한다."
              required
            />
            <Button
              type="submit"
              size="sm"
              disabled={revise.isPending || instruction.trim() === ''}
            >
              {revise.isPending ? (
                <>
                  <SpinnerIcon className="size-4" />
                  초안 만드는 중…
                </>
              ) : (
                '초안 요청'
              )}
            </Button>
          </form>

          {draft === null ? null : (
            <div className="space-y-3">
              <DraftResult draft={draft} />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    onApplyDraft(draft.text)
                    toast.info('초안을 편집기로 가져왔습니다', {
                      description: '아직 저장되지 않았습니다. 확인한 뒤 저장하세요.',
                    })
                  }}
                >
                  편집기로 가져오기
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  버리기
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
