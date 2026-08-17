/**
 * 도메인을 모르는 공용 컴포넌트.
 *
 * 여기 있는 것은 dahaze 가 아닌 제품에서도 말이 되어야 한다. 제품 용어가 이름에 들어가면
 * (`RspdlDocumentCard` 같은) `apps/web` 감이다.
 *
 * 이 패키지는 `@dahaze/api-client` 를 import 하지 않는다. 데이터는 props 로 받는다
 * (ADR-0006). `scripts/check_web_boundaries.mjs` 가 검사한다.
 *
 * shadcn 이 생성한 파일도 생성된 뒤에는 우리 소스다. 하드코딩된 zinc/neutral 색은 전부
 * design-system 토큰으로 바꿔 두었으니, 다시 `shadcn add` 로 덮어쓰면 그 작업이 사라진다.
 */

export { cn } from './lib/cn'

/* --- shadcn 프리미티브 --- */
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './components/alert-dialog'
export { Badge, badgeVariants } from './components/badge'
export { Button, buttonVariants } from './components/button'
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card'
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './components/dialog'
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './components/dropdown-menu'
export { Input } from './components/input'
export { Label } from './components/label'
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './components/popover'
/*
 * 편집기와 진단 목록을 나란히 두는 화면은 사용자가 폭을 조절할 수 있어야 한다. 다만
 * **조절한 폭은 서버에 없는 상태**이므로 zustand 쪽이고, 이 컴포넌트는 값을 받기만 한다.
 */
export {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from './components/resizable'
export { ScrollArea, ScrollBar } from './components/scroll-area'
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './components/select'
export { Separator } from './components/separator'
export { Skeleton } from './components/skeleton'
export { Toaster } from './components/sonner'
export {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  tabsListVariants,
} from './components/tabs'
export { Textarea } from './components/textarea'
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/tooltip'

/*
 * --- 직접 쓴 것 ---
 * shadcn 에 없고, 도메인도 모르는 것들. 심각도 표시는 색만으로 구분하지 않는다는 규칙을
 * 컴포넌트 안에 못박아 두려고 여기 둔다 — 화면마다 다시 지키게 하면 언젠가 빠진다.
 */
export {
  DiagnosticBadge,
  type DiagnosticBadgeProps,
  type DiagnosticSeverity,
} from './components/diagnostic-badge'
export { EmptyState, type EmptyStateProps } from './components/empty-state'
export { ErrorState, type ErrorStateProps } from './components/error-state'

/*
 * `toast` 는 sonner 의 명령형 API 다. 컴포넌트가 아니라서 훅 없이 어디서나 부를 수 있고,
 * 앱이 sonner 를 직접 의존하지 않도록 여기서 함께 내보낸다.
 */
export { toast } from 'sonner'
