'use client'

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export type PrototypeValues = Record<string, string | boolean>
export type PrototypeSamples = Record<string, string>

export interface PrototypeSessionState {
  selectedSampleIdByModel: PrototypeSamples
  experienceValues: PrototypeValues
}

interface PrototypeSessionHook extends PrototypeSessionState {
  setSelectedSampleIdByModel: Dispatch<SetStateAction<PrototypeSamples>>
  setExperienceValues: Dispatch<SetStateAction<PrototypeValues>>
}

const EMPTY: PrototypeSessionState = { selectedSampleIdByModel: {}, experienceValues: {} }

export function usePrototypeSession(projectId: string): PrototypeSessionHook {
  const [selectedSampleIdByModel, setSelectedSampleIdByModel] = useState<PrototypeSamples>({})
  const [experienceValues, setExperienceValues] = useState<PrototypeValues>({})
  const [hydratedProjectId, setHydratedProjectId] = useState<string | null>(null)

  useEffect(() => {
    const saved = readPrototypeSession(sessionStorage.getItem(storageKey(projectId)))
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setSelectedSampleIdByModel(saved.selectedSampleIdByModel)
      setExperienceValues(saved.experienceValues)
      setHydratedProjectId(projectId)
    })
    return () => { active = false }
  }, [projectId])

  useEffect(() => {
    if (hydratedProjectId !== projectId) return
    sessionStorage.setItem(storageKey(projectId), JSON.stringify({ selectedSampleIdByModel, experienceValues }))
  }, [experienceValues, hydratedProjectId, projectId, selectedSampleIdByModel])

  return {
    selectedSampleIdByModel: hydratedProjectId === projectId ? selectedSampleIdByModel : EMPTY.selectedSampleIdByModel,
    experienceValues: hydratedProjectId === projectId ? experienceValues : EMPTY.experienceValues,
    setSelectedSampleIdByModel,
    setExperienceValues,
  }
}

export function readPrototypeSession(raw: string | null): PrototypeSessionState {
  if (raw === null) return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return EMPTY
    return {
      selectedSampleIdByModel: stringRecord(parsed.selectedSampleIdByModel),
      experienceValues: valueRecord(parsed.experienceValues),
    }
  } catch {
    return EMPTY
  }
}

function storageKey(projectId: string): string {
  return `dahaze:prototype:${projectId}`
}

function stringRecord(value: unknown): PrototypeSamples {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function valueRecord(value: unknown): PrototypeValues {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | boolean] => typeof entry[1] === 'string' || typeof entry[1] === 'boolean'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
