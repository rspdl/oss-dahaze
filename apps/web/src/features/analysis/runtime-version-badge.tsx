'use client'

import { Badge, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dahaze/ui'

import { useRspdlRuntime } from './use-runtime'

/**
 * 헤더에 늘 보이는 서버 rspdl 버전.
 *
 * 진단은 컴파일러 버전에 딸린 결과다. 어떤 버전이 그 진단을 만들었는지 화면 어딘가에 항상
 * 적혀 있어야, 버전이 올라 결과가 달라졌을 때 사용자가 원인을 찾을 수 있다.
 */
export function RuntimeVersionBadge() {
  const runtime = useRspdlRuntime()
  if (runtime.data === undefined) return null

  const { rspdl_version: version, locale, wire_schema_version: wire } = runtime.data

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="font-mono text-xs">
            rspdl {version}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          이 서버가 컴파일에 쓰는 RSPDL 버전입니다. locale {locale} · wire schema v{wire}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
