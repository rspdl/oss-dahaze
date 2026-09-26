'use client'

import {
  getCompileTreeQueryKey,
  getListCommitsQueryKey,
  getListTreeChangesQueryKey,
  getListTreeQueryKey,
  getReadTreeFileQueryKey,
  useCreateCommit,
  useCreateTreeFile,
  useCreateTreeFolder,
  useDeleteTreeEntry,
  useMoveTreeEntry,
  useSaveTreeFile,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@dahaze/ui'

import { errorDetail, errorMessage } from '@/shared/api/errors'
import { describeHolder, joinPath } from './tree-model'
import { useWorkspaceStore } from './workspace-store'

/**
 * 작업 트리를 바꾸는 행동. 성공하면 트리·변경 목록·진단을 다시 읽는다.
 *
 * 다른 사람이나 AI 가 바꾼 것은 이벤트 스트림이 같은 조회를 무효화한다. 여기서도 직접
 * 무효화하는 이유는 자기 행동의 결과를 스트림 왕복 없이 바로 보기 위해서다.
 *
 * 결과는 `true`/`false` 로 돌려준다. 대화상자는 성공했을 때만 닫는다.
 */
export function useTreeActions(projectId: string) {
  const queryClient = useQueryClient()
  const openFile = useWorkspaceStore((state) => state.openFile)
  const expandTo = useWorkspaceStore((state) => state.expandTo)
  const dropDraft = useWorkspaceStore((state) => state.dropDraft)
  const renamePath = useWorkspaceStore((state) => state.renamePath)
  const resetExcluded = useWorkspaceStore((state) => state.resetExcluded)

  const createFileMutation = useCreateTreeFile()
  const createFolderMutation = useCreateTreeFolder()
  const moveMutation = useMoveTreeEntry()
  const removeMutation = useDeleteTreeEntry()
  const saveMutation = useSaveTreeFile()
  const commitMutation = useCreateCommit()

  const refresh = async (paths: readonly string[] = []) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListTreeQueryKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: getListTreeChangesQueryKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: getCompileTreeQueryKey(projectId) }),
      ...paths.map((path) =>
        queryClient.invalidateQueries({ queryKey: getReadTreeFileQueryKey(projectId, { path }) }),
      ),
    ])
  }

  /** 잠긴 파일이면 누가 잠갔는지까지 말한다. 그 밖에는 서버 문구를 그대로. */
  const failure = (title: string, error: unknown) => {
    const detail = errorDetail(error)
    if (detail?.code === 'locked') {
      const holders = Array.isArray(detail.holders) ? detail.holders.filter((h) => typeof h === 'string') : []
      const who = holders.length > 0 ? holders.map(describeHolder).join(', ') : '다른 작업'
      toast.error(title, { description: `${who}이(가) 쓰고 있는 파일이에요. 작업이 끝난 뒤 다시 시도해 주세요.` })
      return
    }
    toast.error(title, { description: errorMessage(error) })
  }

  return {
    pending:
      createFileMutation.isPending ||
      createFolderMutation.isPending ||
      moveMutation.isPending ||
      removeMutation.isPending ||
      saveMutation.isPending ||
      commitMutation.isPending,
    saving: saveMutation.isPending,
    committing: commitMutation.isPending,

    async createFile(parent: string, name: string): Promise<boolean> {
      const fileName = name.endsWith('.rspdl') ? name : `${name}.rspdl`
      try {
        const file = await createFileMutation.mutateAsync({
          projectId,
          data: { parent, name: fileName, content: '' },
        })
        await refresh()
        openFile(file.path)
        return true
      } catch (error) {
        failure('파일을 만들지 못했어요', error)
        return false
      }
    },

    async createFolder(parent: string, name: string): Promise<boolean> {
      try {
        const folder = await createFolderMutation.mutateAsync({ projectId, data: { parent, name } })
        await refresh()
        expandTo(folder.path)
        return true
      } catch (error) {
        failure('폴더를 만들지 못했어요', error)
        return false
      }
    },

    async rename(path: string, parent: string, name: string): Promise<boolean> {
      const target = joinPath(parent, name)
      if (target === path) return true
      try {
        await moveMutation.mutateAsync({ projectId, data: { source: path, target } })
        renamePath(path, target)
        await refresh([path, target])
        return true
      } catch (error) {
        failure('이름을 바꾸지 못했어요', error)
        return false
      }
    },

    /**
     * 지운다. 비어 있지 않은 폴더면 `{ notEmpty: 항목 수 }` 를 돌려준다 — 화면이 한 번 더
     * 묻고 `recursive` 로 다시 부른다.
     */
    async remove(
      path: string,
      recursive = false,
    ): Promise<{ ok: true } | { ok: false; notEmpty?: number }> {
      try {
        const result = await removeMutation.mutateAsync({ projectId, data: { path, recursive } })
        for (const deleted of result.deleted_files) dropDraft(deleted)
        await refresh(result.deleted_files)
        return { ok: true }
      } catch (error) {
        const detail = errorDetail(error)
        if (detail?.code === 'folder_not_empty') {
          const entries = Array.isArray(detail.entries) ? detail.entries.length : 0
          return { ok: false, notEmpty: entries }
        }
        failure('지우지 못했어요', error)
        return { ok: false }
      }
    },

    async save(path: string, content: string): Promise<boolean> {
      try {
        const file = await saveMutation.mutateAsync({ projectId, data: { path, content } })
        queryClient.setQueryData(getReadTreeFileQueryKey(projectId, { path }), file)
        dropDraft(path)
        await refresh()
        return true
      } catch (error) {
        failure('저장하지 못했어요', error)
        return false
      }
    },

    async commit(paths: string[], message: string): Promise<boolean> {
      try {
        const created = await commitMutation.mutateAsync({ projectId, data: { paths, message } })
        resetExcluded()
        await Promise.all([
          refresh(),
          queryClient.invalidateQueries({ queryKey: getListCommitsQueryKey(projectId) }),
        ])
        toast.success(`#${created.seq} commit을 만들었어요`)
        return true
      } catch (error) {
        failure('commit하지 못했어요', error)
        return false
      }
    },
  }
}
