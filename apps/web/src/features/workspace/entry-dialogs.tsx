'use client'

import { useState, type FormEvent } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@dahaze/ui'

import { SpinnerIcon } from '@/shared/ui/icons'

/**
 * 이름 하나를 받는 대화상자. 새 파일·새 폴더·이름 바꾸기가 같이 쓴다.
 *
 * `onSubmit` 이 `true` 를 돌려줄 때만 닫는다. 실패하면 입력을 그대로 두어 고쳐 다시 보낼 수
 * 있게 한다.
 */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue = '',
  placeholder,
  submitLabel,
  suffix,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  label: string
  initialValue?: string
  placeholder?: string
  submitLabel: string
  /** 입력 옆에 붙는 고정 글자. 파일은 `.rspdl`. */
  suffix?: string
  onSubmit: (name: string) => Promise<boolean>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* 열 때마다 입력을 새로 시작한다. 닫았다 연 대화상자에 지난 입력이 남아 있으면 헷갈린다. */}
        {open ? (
          <NameForm
            title={title}
            description={description}
            label={label}
            initialValue={initialValue}
            placeholder={placeholder}
            submitLabel={submitLabel}
            suffix={suffix}
            onSubmit={async (name) => {
              const ok = await onSubmit(name)
              if (ok) onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  title,
  description,
  label,
  initialValue,
  placeholder,
  submitLabel,
  suffix,
  onSubmit,
  onCancel,
}: {
  title: string
  description?: string
  label: string
  initialValue: string
  placeholder?: string
  submitLabel: string
  suffix?: string
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const trimmed = value.trim()
  const invalid = trimmed.includes('/')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (trimmed === '' || invalid || pending) return
    setPending(true)
    try {
      await onSubmit(trimmed)
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="workspace-entry-name">{label}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="workspace-entry-name"
            autoFocus
            value={value}
            placeholder={placeholder}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? 'workspace-entry-name-error' : undefined}
            onChange={(event) => setValue(event.target.value)}
          />
          {suffix === undefined ? null : (
            <span className="shrink-0 font-mono text-body-sm text-text-muted">{suffix}</span>
          )}
        </div>
        {invalid ? (
          <p id="workspace-entry-name-error" className="text-caption text-diagnostic-error">
            이름에는 / 를 쓸 수 없어요.
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" disabled={trimmed === '' || invalid || pending}>
          {pending ? <SpinnerIcon /> : null}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * 지우기 확인. 비어 있지 않은 폴더면 서버가 거절하고, 그때 안의 항목까지 지울지 한 번 더 묻는다.
 */
export function DeleteDialog({
  target,
  onOpenChange,
  onDelete,
}: {
  target: { path: string; kind: 'file' | 'folder' } | null
  onOpenChange: (open: boolean) => void
  onDelete: (path: string, recursive: boolean) => Promise<{ ok: true } | { ok: false; notEmpty?: number }>
}) {
  const [notEmpty, setNotEmpty] = useState<number | null>(null)
  const [pending, setPending] = useState(false)

  const close = (open: boolean) => {
    if (!open) setNotEmpty(null)
    onOpenChange(open)
  }

  const run = async () => {
    if (target === null) return
    setPending(true)
    try {
      const result = await onDelete(target.path, notEmpty !== null)
      if (result.ok) close(false)
      else if (result.notEmpty !== undefined) setNotEmpty(result.notEmpty)
    } finally {
      setPending(false)
    }
  }

  const name = target?.path ?? ''

  return (
    <AlertDialog open={target !== null} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {notEmpty === null
              ? target?.kind === 'folder'
                ? '이 폴더를 지울까요?'
                : '이 파일을 지울까요?'
              : '폴더 안의 항목까지 지울까요?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {notEmpty === null ? (
              <>
                <span className="font-mono text-text">{name}</span> 을(를) 작업 트리에서 지워요.
                commit하기 전까지는 이력에 남지 않아요.
              </>
            ) : (
              <>
                <span className="font-mono text-text">{name}</span> 안에 항목이{' '}
                {notEmpty.toLocaleString('ko-KR')}개 있어요. 모두 함께 지워요.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              // 결과를 보고 닫는다. 기본 동작은 누르자마자 닫는다.
              event.preventDefault()
              void run()
            }}
          >
            {pending ? <SpinnerIcon /> : null}
            {notEmpty === null ? '지우기' : '모두 지우기'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
