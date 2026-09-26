import type { ComponentType } from "react"
import {
  Archive,
  ArrowClockwise,
  CaretDown,
  CaretRight,
  CaretUp,
  CaretUpDown,
  ChatCircle,
  Check,
  CheckCircle,
  Circle,
  CircleNotch,
  Clock,
  ClockCounterClockwise,
  DotsSixVertical,
  DotsThree,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FlowArrow,
  GitCommit,
  Info,
  LockSimple,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  ShieldCheck,
  SidebarSimple,
  SlidersHorizontal,
  Sparkle,
  Stop,
  Table,
  Trash,
  Tray,
  TreeStructure,
  Warning,
  WarningOctagon,
  X,
} from "@phosphor-icons/react/ssr"
import type { IconProps as PhosphorIconProps } from "@phosphor-icons/react"

import { cn } from "../lib/cn"

/*
 * jwdesign 아이콘은 Phosphor Icons Bold 한 세트다. 다른 세트와 섞으면 선 굵기와 모서리 모양이
 * 화면 안에서 달라진다.
 *
 * 크기는 `size-*` 클래스로 정한다(16·20·24px). Phosphor 는 기본으로 `width="1em"` 을 넣는데,
 * 그러면 버튼의 `[&_svg]:size-4` 같은 부모 규칙보다 글자 크기가 먼저 이긴다. 그래서 `size`
 * 속성을 비워 두고 기본 크기는 `size-4` 클래스로 준다.
 *
 * 전부 장식으로 둔다(`aria-hidden`). 뜻은 옆의 글자나 버튼의 `aria-label` 이 전한다.
 * `ssr` 진입점을 쓰는 이유: 서버 컴포넌트에서도 React context 없이 그려진다.
 */
export type IconProps = Omit<PhosphorIconProps, "weight" | "size">

function bold(Glyph: ComponentType<PhosphorIconProps>, name: string) {
  function Icon({ className, ...props }: IconProps) {
    return (
      <Glyph
        aria-hidden
        weight="bold"
        className={cn("size-4 shrink-0", className)}
        {...props}
      />
    )
  }
  Icon.displayName = name
  return Icon
}

/* 방향·펼침 */
export const ChevronRightIcon = bold(CaretRight, "ChevronRightIcon")
export const ChevronDownIcon = bold(CaretDown, "ChevronDownIcon")
export const ChevronUpIcon = bold(CaretUp, "ChevronUpIcon")
export const ChevronsUpDownIcon = bold(CaretUpDown, "ChevronsUpDownIcon")

/* 행동 */
export const CheckIcon = bold(Check, "CheckIcon")
export const XIcon = bold(X, "XIcon")
export const PlusIcon = bold(Plus, "PlusIcon")
export const PenIcon = bold(PencilSimple, "PenIcon")
export const TrashIcon = bold(Trash, "TrashIcon")
export const SearchIcon = bold(MagnifyingGlass, "SearchIcon")
export const MoreIcon = bold(DotsThree, "MoreIcon")
export const RefreshIcon = bold(ArrowClockwise, "RefreshIcon")
export const SendIcon = bold(PaperPlaneTilt, "SendIcon")
export const StopIcon = bold(Stop, "StopIcon")
export const GripVerticalIcon = bold(DotsSixVertical, "GripVerticalIcon")
export const CircleIcon = bold(Circle, "CircleIcon")

/* 상태 */
export const InfoIcon = bold(Info, "InfoIcon")
export const WarningIcon = bold(Warning, "WarningIcon")
export const ErrorIcon = bold(WarningOctagon, "ErrorIcon")
export const SuccessIcon = bold(CheckCircle, "SuccessIcon")
export const LockIcon = bold(LockSimple, "LockIcon")

/* 사물 */
export const FolderIcon = bold(Folder, "FolderIcon")
export const FolderOpenIcon = bold(FolderOpen, "FolderOpenIcon")
export const FolderPlusIcon = bold(FolderPlus, "FolderPlusIcon")
export const FileIcon = bold(File, "FileIcon")
export const FileTextIcon = bold(FileText, "FileTextIcon")
export const FilePlusIcon = bold(FilePlus, "FilePlusIcon")
export const ArchiveIcon = bold(Archive, "ArchiveIcon")
export const InboxIcon = bold(Tray, "InboxIcon")
export const ClockIcon = bold(Clock, "ClockIcon")
export const HistoryIcon = bold(ClockCounterClockwise, "HistoryIcon")
export const CommitIcon = bold(GitCommit, "CommitIcon")
export const ChatIcon = bold(ChatCircle, "ChatIcon")
export const SparkleIcon = bold(Sparkle, "SparkleIcon")
export const ShieldIcon = bold(ShieldCheck, "ShieldIcon")
export const TableIcon = bold(Table, "TableIcon")
export const HierarchyIcon = bold(TreeStructure, "HierarchyIcon")
export const FlowIcon = bold(FlowArrow, "FlowIcon")
export const SlidersIcon = bold(SlidersHorizontal, "SlidersIcon")
export const PanelLeftIcon = bold(SidebarSimple, "PanelLeftIcon")

/** 오른쪽 패널 여닫기. 왼쪽 패널 아이콘을 좌우로 뒤집는다. */
export function PanelRightIcon({ className, ...props }: IconProps) {
  return <PanelLeftIcon className={cn("-scale-x-100", className)} {...props} />
}

/** 짧은 대기(1–3초) 표시. 회전은 `prefers-reduced-motion` 에서 theme.css 가 멈춘다. */
export function SpinnerIcon({ className, ...props }: IconProps) {
  return (
    <CircleNotch
      aria-hidden
      weight="bold"
      className={cn("size-4 shrink-0 animate-spin", className)}
      {...props}
    />
  )
}
