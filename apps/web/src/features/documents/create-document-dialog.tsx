'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  getListDocumentsQueryKey,
  useCreateDocument,
  useDraftRspdlDocument,
  type AuthoringDraftResponse,
  type DocumentResponse,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { payload } from '@/shared/api/payload'
import { SpinnerIcon } from '@/shared/ui/icons'
import { DraftResult } from '@/features/authoring/draft-result'

/** 서버는 `.rspdl` 로 끝나는 경로만 받는다. 사용자가 빠뜨리면 붙여 준다. */
function normalizePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '') return ''
  return trimmed.endsWith('.rspdl') ? trimmed : `${trimmed}.rspdl`
}

export function CreateDocumentDialog({
  projectId,
  trigger,
}: {
  projectId: string
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>새 문서</DialogTitle>
          <DialogDescription>
            빈 문서로 시작하거나, 하고 싶은 말을 적어 LLM 초안을 받아 볼 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="blank" className="my-4">
          <TabsList>
            <TabsTrigger value="blank">빈 문서</TabsTrigger>
            <TabsTrigger value="draft">LLM 초안</TabsTrigger>
          </TabsList>
          <TabsContent value="blank" className="pt-4">
            <BlankDocumentForm
              projectId={projectId}
              onDone={() => setOpen(false)}
            />
          </TabsContent>
          <TabsContent value="draft" className="pt-4">
            <DraftDocumentForm
              projectId={projectId}
              onDone={() => setOpen(false)}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

/** 목록·본문을 다시 물어보고 새 문서로 이동한다. 두 폼이 공유한다. */
function useCreateAndOpen(projectId: string, onDone: () => void) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const createDocument = useCreateDocument()

  const run = (input: { title: string; path: string; text?: string }) => {
    createDocument.mutate(
      { projectId, data: input },
      {
        onSuccess: async (response) => {
          const document: DocumentResponse = payload(response)
          await queryClient.invalidateQueries({
            queryKey: getListDocumentsQueryKey(projectId),
          })
          toast.success(`문서 "${document.title}" 을(를) 만들었습니다`)
          onDone()
          router.push(`/projects/${projectId}/documents/${document.id}`)
        },
        onError: (error) => {
          toast.error('문서를 만들지 못했습니다', { description: errorMessage(error) })
        },
      },
    )
  }

  return { run, isPending: createDocument.isPending }
}

function BlankDocumentForm({
  projectId,
  onDone,
}: {
  projectId: string
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [path, setPath] = useState('')
  const { run, isPending } = useCreateAndOpen(projectId, onDone)

  const effectivePath = normalizePath(path === '' ? title : path)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    run({ title: title.trim(), path: effectivePath })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="document-title">제목</Label>
        <Input
          id="document-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="재고 모델"
          maxLength={200}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="document-path">경로</Label>
        <Input
          id="document-path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="inventory.rspdl"
          className="font-mono"
        />
        <p className="text-xs text-text-muted">
          비워 두면 제목에서 만듭니다. `.rspdl` 로 끝나야 하며 없으면 붙여 줍니다.
          {effectivePath === '' ? null : (
            <>
              {' '}
              지금 값: <span className="font-mono">{effectivePath}</span>
            </>
          )}
        </p>
      </div>
      <DialogFooter>
        <Button
          type="submit"
          disabled={isPending || title.trim() === '' || effectivePath === ''}
        >
          {isPending ? '만드는 중…' : '만들기'}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * LLM 초안으로 문서 만들기.
 *
 * 두 단계로 나뉘어 있는 것이 핵심이다. 초안을 받는 것과 문서를 만드는 것은 다른 행동이고,
 * 저작 엔드포인트는 아무 것도 저장하지 않는다 (ADR-0005). 사용자가 초안과 진단을 본 뒤에
 * "이 초안으로 문서 만들기" 를 눌러야 비로소 문서가 생긴다.
 */
function DraftDocumentForm({
  projectId,
  onDone,
}: {
  projectId: string
  onDone: () => void
}) {
  const [instruction, setInstruction] = useState('')
  const [title, setTitle] = useState('')
  const [path, setPath] = useState('')
  const [draft, setDraft] = useState<AuthoringDraftResponse | null>(null)

  const draftDocument = useDraftRspdlDocument()
  const { run, isPending: isCreating } = useCreateAndOpen(projectId, onDone)

  const effectivePath = normalizePath(path === '' ? title : path)

  const onDraft = (event: FormEvent) => {
    event.preventDefault()
    draftDocument.mutate(
      {
        projectId,
        data: {
          instruction: instruction.trim(),
          ...(effectivePath === '' ? {} : { path: effectivePath }),
        },
      },
      {
        onSuccess: (response) => {
          const result: AuthoringDraftResponse = payload(response)
          setDraft(result)
          if (path === '') setPath(result.path)
        },
        onError: (error) => {
          toast.error('초안을 만들지 못했습니다', { description: errorMessage(error) })
        },
      },
    )
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onDraft} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="draft-instruction">무엇을 선언하고 싶은지</Label>
          <Textarea
            id="draft-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="재고 항목은 이름과 수량을 가지고, 수량은 0 이상이어야 한다."
            required
          />
          <p className="text-xs text-text-muted">
            이 문장이 초안의 유일한 입력입니다. 초안은 컴파일러를 거친 뒤 진단과 함께
            돌아옵니다.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="draft-title">제목</Label>
            <Input
              id="draft-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="재고 모델"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="draft-path">경로</Label>
            <Input
              id="draft-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              className="font-mono"
              placeholder="inventory.rspdl"
            />
          </div>
        </div>
        <Button type="submit" disabled={draftDocument.isPending || instruction.trim() === ''}>
          {draftDocument.isPending ? (
            <>
              <SpinnerIcon className="size-4" />
              초안 만드는 중…
            </>
          ) : draft === null ? (
            '초안 만들기'
          ) : (
            '초안 다시 만들기'
          )}
        </Button>
      </form>

      {draft === null ? null : (
        <>
          <DraftResult draft={draft} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={isCreating}>
              초안 버리기
            </Button>
            <Button
              disabled={isCreating || title.trim() === '' || effectivePath === ''}
              onClick={() =>
                run({
                  title: title.trim(),
                  path: effectivePath,
                  text: draft.text,
                })
              }
            >
              {isCreating ? '만드는 중…' : '이 초안으로 문서 만들기'}
            </Button>
          </DialogFooter>
        </>
      )}
    </div>
  )
}
