'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  getListProjectsQueryKey,
  useCreateProject,
  type ProjectResponse,
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
  Textarea,
  toast,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'

/**
 * slug 는 서버가 소문자·숫자·하이픈만 받는다. 규칙을 두 곳에서 다르게 쓰지 않으려고
 * 여기서는 **막지 않고 도와만 준다** — 최종 판정은 서버가 하고, 이름을 slug 로 옮기는 것은
 * 사용자가 매번 손으로 하기 번거로운 일이라 대신 해 준다.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

export function CreateProjectDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')

  const queryClient = useQueryClient()
  const router = useRouter()
  const createProject = useCreateProject()

  const effectiveSlug = slugTouched ? slug : toSlug(name)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    createProject.mutate(
      {
        data: {
          name: name.trim(),
          slug: effectiveSlug,
          description: description.trim() === '' ? null : description.trim(),
        },
      },
      {
        onSuccess: async (response) => {
          const project: ProjectResponse = response
          // 목록은 서버 상태다. 새 항목을 손으로 끼워 넣지 않고 다시 물어본다.
          await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() })
          toast.success(`프로젝트 "${project.name}" 을(를) 만들었습니다`)
          setOpen(false)
          setName('')
          setSlug('')
          setSlugTouched(false)
          setDescription('')
          router.push(`/projects/${project.id}`)
        },
        onError: (error) => {
          toast.error('프로젝트를 만들지 못했습니다', {
            description: errorMessage(error),
          })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>새 프로젝트</DialogTitle>
            <DialogDescription>
              RSPDL 문서를 담을 자리입니다. 문서의 기본 rspdl 버전은 서버의 컴파일러 버전을
              따릅니다.
            </DialogDescription>
          </DialogHeader>

          <div className="my-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">이름</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="재고 관리"
                maxLength={200}
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-slug">주소에 쓸 식별자</Label>
              <Input
                id="project-slug"
                value={effectiveSlug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(event.target.value)
                }}
                placeholder="inventory"
                maxLength={100}
                required
                className="font-mono"
              />
              <p className="text-xs text-text-muted">
                소문자·숫자·하이픈만 씁니다. 이름에서 자동으로 만들어지며 직접 고칠 수
                있습니다.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-description">설명 (선택)</Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={createProject.isPending}
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={
                createProject.isPending || name.trim() === '' || effectiveSlug === ''
              }
            >
              {createProject.isPending ? '만드는 중…' : '만들기'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
