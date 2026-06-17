import {
  StrictMode,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom"
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  File as FileIcon,
  Files,
  Folder,
  FolderPlus,
  FolderUp,
  HardDrive,
  Home,
  Image,
  Link,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pause,
  Pencil,
  Plus,
  Play,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { AnimatePresence, motion } from "motion/react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import "./styles.css"

const ROOT_ID = "00000000-0000-0000-0000-000000000000"
const CLIENT_ID_KEY = "nas.client.id"
const GRID_SIZE_KEY = "nas.gallery.grid-size"
const GRID_COLUMNS_KEY = "nas.gallery.grid-columns"
const VIEW_PARAM = "view"

type NodeKind = "folder" | "file"

type NodeDto = {
  id: string
  parent_id: string | null
  kind: NodeKind
  name: string
  relative_path: string
  mime_type: string | null
  size_bytes: number | null
  file_date_at: number | null
  display_date_at: number
  has_preview: boolean
  preview_url: string | null
  download_url: string | null
  created_at: number
  updated_at: number
}

type FolderResponse = {
  folder: NodeDto
  breadcrumbs: NodeDto[]
  children: NodeDto[]
}

type FilesResponse = {
  files: NodeDto[]
}

type SearchResponse = {
  nodes: NodeDto[]
}

type ShareDto = {
  id: string
  file_id: string
  created_at: number
  expires_at: number
  revoked_at: number | null
  download_count: number
}
type CreateShareResponse = {
  share: ShareDto
  token: string
  public_url: string
}

type SortMode = "name" | "date"
type SearchScope = "current" | "all"
type MediaFilter = "all" | "image" | "video"
type GridSize = "small" | "medium" | "large"
type GalleryGridStyle = CSSProperties & {
  "--gallery-mobile-columns": number
  "--gallery-desktop-columns": number
}
type SelectionBox = {
  left: number
  top: number
  width: number
  height: number
}
type FileWithPath = File & { webkitRelativePath?: string }
type FileSystemFileHandleLike = {
  kind: "file"
  name: string
  getFile: () => Promise<File>
}
type FileSystemDirectoryHandleLike = {
  kind: "directory"
  name: string
  values: () => AsyncIterable<FileSystemFileHandleLike | FileSystemDirectoryHandleLike>
}
type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>
}

type NodeGroup = {
  id: string
  label: string
  nodes: NodeDto[]
  children?: NodeGroup[]
}

type PendingFileImport = {
  files: File[]
  suggestedFolderName?: string
}
type BatchShareLink = {
  fileId: string
  name: string
  url: string
}

type DuplicateAction = "rename" | "skip" | "replace"
type DuplicateDecision = {
  action: DuplicateAction
  applyToAll: boolean
}
type DuplicateConflictRequest = {
  fileName: string
  resolve: (decision: DuplicateDecision) => void
}
type RealtimeEvent =
  | {
      type: "node_upsert"
      node: NodeDto
      source_client_id?: string | null
    }
  | {
      type: "node_deleted"
      id: string
      parent_id?: string | null
      source_client_id?: string | null
    }

const MEDIA_ACCEPT = "image/*,video/*"
const LIGHT_IMPORT_FILE_LIMIT = 20
const LIGHT_IMPORT_BYTES_LIMIT = 384 * 1024 * 1024
const MAX_ACTIVE_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
const MIN_GRID_COLUMNS = 1
const MAX_GRID_COLUMNS = 12
const SELECTION_LONG_PRESS_MS = 420
const SELECTION_EXISTING_PRESS_MS = 180
const SELECTION_MARQUEE_START_DISTANCE = 4
const SELECTION_AUTOSCROLL_EDGE = 88
const SELECTION_AUTOSCROLL_MAX_SPEED = 18
const GRID_SIZE_OPTIONS: Array<{ value: GridSize; label: string; columns: number }> = [
  { value: "small", label: "Petite", columns: 4 },
  { value: "medium", label: "Moyenne", columns: 3 },
  { value: "large", label: "Grande", columns: 2 },
]
const MEDIA_EXTENSIONS = new Set([
  "avif",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "png",
  "webm",
  "webp",
])

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    sessionStorage.removeItem("nas.session.token")

    fetch("/api/auth/me")
      .then((response) => {
        if (active) setAuthenticated(response.ok)
      })
      .catch(() => {
        if (active) setAuthenticated(false)
      })

    return () => {
      active = false
    }
  }, [])

  const login = useCallback(() => setAuthenticated(true), [])
  const expireAuth = useCallback(() => setAuthenticated(false), [])
  const authFallback = authenticated === null ? <SessionLoading /> : <Login onLogin={login} />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/share/:shareToken" element={<ShareRoute />} />
        <Route
          path="/"
          element={
            authenticated === null ? (
              <SessionLoading />
            ) : authenticated ? (
              <Navigate to={folderRoute(ROOT_ID, "date")} replace />
            ) : (
              <Login onLogin={login} />
            )
          }
        />
        <Route
          path="/folder/:folderId"
          element={
            authenticated ? (
              <FileManager
                onAuthExpired={expireAuth}
              />
            ) : (
              authFallback
            )
          }
        />
        <Route
          path="/files"
          element={
            authenticated ? (
              <AllFilesView
                onAuthExpired={expireAuth}
              />
            ) : (
              authFallback
            )
          }
        />
        <Route path="*" element={<Navigate to={authenticated ? folderRoute(ROOT_ID, "date") : "/"} replace />} />
      </Routes>
    </BrowserRouter>
  )
}

function SessionLoading() {
  return (
    <main className="grid min-h-svh place-items-center px-5 py-10 text-muted-foreground">
      <Loader2 className="size-7 animate-spin" />
    </main>
  )
}

function ShareRoute() {
  const { shareToken } = useParams()
  return shareToken ? <SharePage shareToken={shareToken} /> : <Navigate to="/" replace />
}

function folderRoute(folderId: string, _sortMode: SortMode = "date", query = "", scope: SearchScope = "current") {
  const params = new URLSearchParams()
  const trimmedQuery = query.trim()
  if (trimmedQuery) {
    params.set("q", trimmedQuery)
    params.set("scope", scope)
  }
  const search = params.toString()
  return search ? `/folder/${folderId}?${search}` : `/folder/${folderId}`
}

function allFilesRoute(_sortMode: SortMode = "date", query = "") {
  const params = new URLSearchParams()
  const trimmedQuery = query.trim()
  if (trimmedQuery) {
    params.set("q", trimmedQuery)
  }
  const search = params.toString()
  return search ? `/files?${search}` : "/files"
}

function parseSortMode(_value: string | null): SortMode {
  return "date"
}

function parseSearchScope(value: string | null): SearchScope {
  return value === "all" ? "all" : "current"
}

function parseMediaFilter(value: string | null): MediaFilter {
  return value === "image" || value === "video" ? value : "all"
}

/** Le filtre est applique cote API ; ce garde-fou evite d'inserer un media hors filtre via upload/temps reel. */
function nodeMatchesMedia(node: NodeDto, mediaFilter: MediaFilter) {
  if (mediaFilter === "all" || node.kind === "folder") return true
  if (mediaFilter === "image") return node.mime_type?.startsWith("image/") ?? false
  return node.mime_type?.startsWith("video/") ?? false
}

function parseGridSize(value: string | null): GridSize {
  return value === "small" || value === "large" ? value : "medium"
}

function parseGridColumns(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed)) return 5
  return clampGridColumns(parsed)
}

function clampGridColumns(value: number) {
  return Math.min(MAX_GRID_COLUMNS, Math.max(MIN_GRID_COLUMNS, Math.round(value)))
}

/** Petit logo texte, reutilise partout pour rester coherent. */
function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="grid size-9 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
        <HardDrive className="size-5" />
      </span>
      <span className="font-heading text-lg font-semibold tracking-tight text-foreground">NAS</span>
    </div>
  )
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setLoading(true)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })

      if (!response.ok) {
        setError(response.status === 429 ? "Trop de tentatives. Reessaie dans une minute." : "Acces refuse.")
        return
      }

      await response.json().catch(() => null)
      onLogin()
    } catch {
      setError("Serveur indisponible.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="grid min-h-svh place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <Brand className="mb-6 justify-center" />
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Connexion</CardTitle>
            <CardDescription>Entre le mot de passe pour acceder au stockage.</CardDescription>
          </CardHeader>
          <form onSubmit={submit}>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="password">Mot de passe</Label>
                <Input
                  id="password"
                  autoFocus
                  type="password"
                  className="h-11"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Mot de passe"
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="pt-5">
              <Button className="h-11 w-full" size="lg" type="submit" disabled={loading || !password}>
                {loading ? <Loader2 className="animate-spin" /> : <Lock />}
                Connexion
              </Button>
            </CardFooter>
          </form>
        </Card>
        <p className="mt-6 text-center text-xs text-muted-foreground">Session conservee jusqu a la fermeture de l onglet.</p>
      </div>
    </main>
  )
}

function useClientId() {
  return useMemo(() => {
    const existing = sessionStorage.getItem(CLIENT_ID_KEY)
    if (existing) return existing

    const nextClientId = crypto.randomUUID()
    sessionStorage.setItem(CLIENT_ID_KEY, nextClientId)
    return nextClientId
  }, [])
}

function useAuthedRequest(onAuthExpired: () => void, clientId: string) {
  return useCallback(
    async <T,>(path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set("X-NAS-Client-ID", clientId)
      if (init.body && !(init.body instanceof Blob) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json")
      }

      const response = await fetch(path, { ...init, headers })
      if (response.status === 401) {
        onAuthExpired()
        throw new Error("Session expiree")
      }
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      if (response.status === 204) {
        return undefined as T
      }
      return (await response.json()) as T
    },
    [clientId, onAuthExpired],
  )
}

function useRealtimeEvents(clientId: string, onEvent: (event: RealtimeEvent) => void) {
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let closed = false

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const params = new URLSearchParams({ client_id: clientId })
      socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime?${params}`)

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as RealtimeEvent
          if (payload.source_client_id === clientId) return
          onEventRef.current(payload)
        } catch {
          // Ignore malformed realtime payloads.
        }
      }

      socket.onclose = () => {
        if (closed) return
        reconnectTimer = window.setTimeout(connect, 1500)
      }
    }

    connect()

    return () => {
      closed = true
      window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [clientId])
}

function useGridSize() {
  const [gridSize, setGridSizeState] = useState<GridSize>(() => parseGridSize(localStorage.getItem(GRID_SIZE_KEY)))

  const setGridSize = useCallback((nextGridSize: GridSize) => {
    setGridSizeState(nextGridSize)
    localStorage.setItem(GRID_SIZE_KEY, nextGridSize)
  }, [])

  return [gridSize, setGridSize] as const
}

function useGridColumns() {
  const [gridColumns, setGridColumnsState] = useState(() => parseGridColumns(localStorage.getItem(GRID_COLUMNS_KEY)))

  const setGridColumns = useCallback((nextGridColumns: number) => {
    const clamped = clampGridColumns(nextGridColumns)
    setGridColumnsState(clamped)
    localStorage.setItem(GRID_COLUMNS_KEY, String(clamped))
  }, [])

  return [gridColumns, setGridColumns] as const
}

function lockSelectionScroll() {
  const preventTouchMove = (event: TouchEvent) => {
    event.preventDefault()
  }

  document.body.classList.add("is-selecting-nodes")
  document.documentElement.classList.add("is-selecting-nodes")
  window.addEventListener("touchmove", preventTouchMove, { passive: false })

  return () => {
    window.removeEventListener("touchmove", preventTouchMove)
    document.body.classList.remove("is-selecting-nodes")
    document.documentElement.classList.remove("is-selecting-nodes")
  }
}

function normalizedSelectionBox(startX: number, startY: number, endX: number, endY: number): SelectionBox {
  const left = Math.min(startX, endX)
  const top = Math.min(startY, endY)
  return {
    left,
    top,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  }
}

function viewportSelectionBox(pageBox: SelectionBox): SelectionBox {
  return {
    left: pageBox.left - window.scrollX,
    top: pageBox.top - window.scrollY,
    width: pageBox.width,
    height: pageBox.height,
  }
}

function boxesIntersect(left: SelectionBox, right: SelectionBox) {
  return (
    left.left < right.left + right.width &&
    left.left + left.width > right.left &&
    left.top < right.top + right.height &&
    left.top + left.height > right.top
  )
}

function selectableNodeIdsInBox(pageBox: SelectionBox) {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-node-id][data-node-index]"))
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      const nodeBox = {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      }
      return boxesIntersect(pageBox, nodeBox)
    })
    .sort((left, right) => Number(left.dataset.nodeIndex) - Number(right.dataset.nodeIndex))
    .map((element) => element.dataset.nodeId)
    .filter((id): id is string => !!id)
}

function sameStringSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

function canStartMarqueeSelection(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return !target.closest(
    [
      "[data-node-id]",
      "[data-selection-ignore]",
      "a",
      "button",
      "input",
      "label",
      "select",
      "textarea",
      "[contenteditable='true']",
      "[role='button']",
      "[role='menuitem']",
    ].join(","),
  )
}

function useNodeSelection(nodes: NodeDto[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const selectableIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes])
  const selectableIdsRef = useRef(selectableIds)
  const selectedIdsRef = useRef(selectedIds)
  const cleanupRef = useRef<(() => void) | null>(null)
  const suppressClickUntilRef = useRef(0)

  useEffect(() => {
    selectableIdsRef.current = selectableIds
    setSelectedIds((current) => {
      let changed = false
      const next = new Set<string>()
      for (const id of current) {
        if (selectableIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [selectableIds])

  useEffect(() => {
    selectedIdsRef.current = selectedIds
  }, [selectedIds])

  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      setSelectionBox(null)
      document.body.classList.remove("is-selecting-nodes")
      document.documentElement.classList.remove("is-selecting-nodes")
    }
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(selectableIdsRef.current))
  }, [])

  const setSelectedIdsInRange = useCallback((ids: string[], selected: boolean) => {
    const selectable = selectableIdsRef.current
    const safeIds = ids.filter((id) => selectable.has(id))
    if (safeIds.length === 0) return

    setSelectedIds((current) => {
      let changed = false
      const next = new Set(current)
      for (const id of safeIds) {
        if (selected) {
          if (!next.has(id)) {
            next.add(id)
            changed = true
          }
        } else if (next.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [])

  const toggleSelectedId = useCallback((id: string) => {
    if (!selectableIdsRef.current.has(id)) return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const applySelectionRange = useCallback(
    (fromIndex: number, toIndex: number, selected: boolean) => {
      const min = Math.min(fromIndex, toIndex)
      const max = Math.max(fromIndex, toIndex)
      const ids = Array.from(document.querySelectorAll<HTMLElement>("[data-node-id][data-node-index]"))
        .filter((element) => {
          const index = Number(element.dataset.nodeIndex)
          return Number.isFinite(index) && index >= min && index <= max
        })
        .sort((left, right) => Number(left.dataset.nodeIndex) - Number(right.dataset.nodeIndex))
        .map((element) => element.dataset.nodeId)
        .filter((id): id is string => !!id)

      setSelectedIdsInRange(ids, selected)
    },
    [setSelectedIdsInRange],
  )

  const applySelectionAtPoint = useCallback(
    (x: number, y: number, selected: boolean, previousIndex: number | null) => {
      const element = document.elementFromPoint(x, y)?.closest("[data-node-id]") as HTMLElement | null
      const index = Number(element?.dataset.nodeIndex)
      if (!element?.dataset.nodeId || !Number.isFinite(index)) return previousIndex

      applySelectionRange(previousIndex ?? index, index, selected)
      return index
    },
    [applySelectionRange],
  )

  const applyMarqueeSelection = useCallback((pageBox: SelectionBox, baseSelectedIds: Set<string>, additive: boolean) => {
    const selectable = selectableIdsRef.current
    const ids = selectableNodeIdsInBox(pageBox).filter((id) => selectable.has(id))

    setSelectedIds((current) => {
      const next = additive ? new Set(baseSelectedIds) : new Set<string>()
      for (const id of ids) {
        next.add(id)
      }
      return sameStringSet(current, next) ? current : next
    })
  }, [])

  const handleMarqueePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || event.defaultPrevented) return
      if (!canStartMarqueeSelection(event.target)) return

      cleanupRef.current?.()

      const pointerId = event.pointerId
      const surface = event.currentTarget
      const baseSelectedIds = new Set(selectedIdsRef.current)
      const additive = event.ctrlKey || event.metaKey || event.shiftKey
      const gesture = {
        active: false,
        startX: event.clientX + window.scrollX,
        startY: event.clientY + window.scrollY,
        pointerX: event.clientX,
        pointerY: event.clientY,
        scrollSpeed: 0,
        animationFrame: 0,
      }
      let unlockSelectionScroll: (() => void) | null = null

      const stopAutoScroll = () => {
        if (gesture.animationFrame) {
          window.cancelAnimationFrame(gesture.animationFrame)
          gesture.animationFrame = 0
        }
        gesture.scrollSpeed = 0
      }

      const updateSelection = () => {
        const pageBox = normalizedSelectionBox(
          gesture.startX,
          gesture.startY,
          gesture.pointerX + window.scrollX,
          gesture.pointerY + window.scrollY,
        )
        setSelectionBox(viewportSelectionBox(pageBox))
        applyMarqueeSelection(pageBox, baseSelectedIds, additive)
      }

      const runAutoScroll = () => {
        gesture.animationFrame = 0
        if (!gesture.active || gesture.scrollSpeed === 0) return

        window.scrollBy({ top: gesture.scrollSpeed, behavior: "auto" })
        updateSelection()
        gesture.animationFrame = window.requestAnimationFrame(runAutoScroll)
      }

      const updateAutoScroll = (clientY: number) => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight
        const topDistance = clientY
        const bottomDistance = viewportHeight - clientY
        let nextSpeed = 0

        if (topDistance < SELECTION_AUTOSCROLL_EDGE) {
          const intensity = (SELECTION_AUTOSCROLL_EDGE - Math.max(0, topDistance)) / SELECTION_AUTOSCROLL_EDGE
          nextSpeed = -Math.ceil(intensity * SELECTION_AUTOSCROLL_MAX_SPEED)
        } else if (bottomDistance < SELECTION_AUTOSCROLL_EDGE) {
          const intensity = (SELECTION_AUTOSCROLL_EDGE - Math.max(0, bottomDistance)) / SELECTION_AUTOSCROLL_EDGE
          nextSpeed = Math.ceil(intensity * SELECTION_AUTOSCROLL_MAX_SPEED)
        }

        gesture.scrollSpeed = nextSpeed
        if (nextSpeed !== 0 && gesture.animationFrame === 0) {
          gesture.animationFrame = window.requestAnimationFrame(runAutoScroll)
        }
      }

      const startSelection = () => {
        if (gesture.active) return
        gesture.active = true
        unlockSelectionScroll = lockSelectionScroll()
        try {
          surface.setPointerCapture(pointerId)
        } catch {
          // Pointer capture may fail if the browser already cancelled the gesture.
        }
        updateSelection()
      }

      function cleanup() {
        stopAutoScroll()
        window.removeEventListener("pointermove", handleMove)
        window.removeEventListener("pointerup", handleEnd)
        window.removeEventListener("pointercancel", handleEnd)
        unlockSelectionScroll?.()
        setSelectionBox(null)
        try {
          if (surface.hasPointerCapture(pointerId)) {
            surface.releasePointerCapture(pointerId)
          }
        } catch {
          // Ignore pointer capture cleanup failures.
        }
        cleanupRef.current = null
      }

      function handleMove(moveEvent: globalThis.PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return

        gesture.pointerX = moveEvent.clientX
        gesture.pointerY = moveEvent.clientY
        const distance = Math.hypot(
          moveEvent.clientX + window.scrollX - gesture.startX,
          moveEvent.clientY + window.scrollY - gesture.startY,
        )

        if (!gesture.active && distance > SELECTION_MARQUEE_START_DISTANCE) {
          startSelection()
        }

        if (!gesture.active) return

        moveEvent.preventDefault()
        updateSelection()
        updateAutoScroll(moveEvent.clientY)
      }

      function handleEnd(endEvent: globalThis.PointerEvent) {
        if (endEvent.pointerId !== pointerId) return

        if (gesture.active) {
          endEvent.preventDefault()
          suppressClickUntilRef.current = performance.now() + 350
        } else if (!additive && selectedIdsRef.current.size > 0) {
          clearSelection()
        }
        cleanup()
      }

      cleanupRef.current = cleanup
      window.addEventListener("pointermove", handleMove, { passive: false })
      window.addEventListener("pointerup", handleEnd, { passive: false })
      window.addEventListener("pointercancel", handleEnd, { passive: false })
    },
    [applyMarqueeSelection, clearSelection],
  )

  const handlePointerDown = useCallback(
    (node: NodeDto, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.defaultPrevented) return
      if (event.pointerType === "touch") return
      if ((event.target as HTMLElement).closest("[data-selection-ignore]")) return

      cleanupRef.current?.()

      const selectionModeAtStart = selectedIdsRef.current.size > 0
      const shouldSelect = !selectedIdsRef.current.has(node.id)
      const pointerTarget = event.currentTarget
      const gesture = {
        active: false,
        cancelled: false,
        startX: event.clientX,
        startY: event.clientY,
        pointerX: event.clientX,
        pointerY: event.clientY,
        lastIndex: null as number | null,
        scrollSpeed: 0,
        animationFrame: 0,
        timer: 0,
      }
      let unlockSelectionScroll: (() => void) | null = null

      const stopAutoScroll = () => {
        if (gesture.animationFrame) {
          window.cancelAnimationFrame(gesture.animationFrame)
          gesture.animationFrame = 0
        }
        gesture.scrollSpeed = 0
      }

      const runAutoScroll = () => {
        gesture.animationFrame = 0
        if (!gesture.active || gesture.scrollSpeed === 0) return

        window.scrollBy({ top: gesture.scrollSpeed, behavior: "auto" })
        gesture.lastIndex = applySelectionAtPoint(gesture.pointerX, gesture.pointerY, shouldSelect, gesture.lastIndex)
        gesture.animationFrame = window.requestAnimationFrame(runAutoScroll)
      }

      const updateAutoScroll = (clientY: number) => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight
        const topDistance = clientY
        const bottomDistance = viewportHeight - clientY
        let nextSpeed = 0

        if (topDistance < SELECTION_AUTOSCROLL_EDGE) {
          const intensity = (SELECTION_AUTOSCROLL_EDGE - Math.max(0, topDistance)) / SELECTION_AUTOSCROLL_EDGE
          nextSpeed = -Math.ceil(intensity * SELECTION_AUTOSCROLL_MAX_SPEED)
        } else if (bottomDistance < SELECTION_AUTOSCROLL_EDGE) {
          const intensity = (SELECTION_AUTOSCROLL_EDGE - Math.max(0, bottomDistance)) / SELECTION_AUTOSCROLL_EDGE
          nextSpeed = Math.ceil(intensity * SELECTION_AUTOSCROLL_MAX_SPEED)
        }

        gesture.scrollSpeed = nextSpeed
        if (nextSpeed !== 0 && gesture.animationFrame === 0) {
          gesture.animationFrame = window.requestAnimationFrame(runAutoScroll)
        }
      }

      const startSelection = () => {
        if (gesture.active || gesture.cancelled) return
        gesture.active = true
        unlockSelectionScroll = lockSelectionScroll()
        try {
          pointerTarget.setPointerCapture(event.pointerId)
        } catch {
          // Pointer capture may fail if the browser already cancelled the touch gesture.
        }
        const startElement = pointerTarget.closest("[data-node-id]") as HTMLElement | null
        const startIndex = Number(startElement?.dataset.nodeIndex)
        gesture.lastIndex = Number.isFinite(startIndex) ? startIndex : null
        if (gesture.lastIndex !== null) {
          applySelectionRange(gesture.lastIndex, gesture.lastIndex, shouldSelect)
        }
        gesture.lastIndex = applySelectionAtPoint(gesture.pointerX, gesture.pointerY, shouldSelect, gesture.lastIndex)
        updateAutoScroll(gesture.pointerY)
        navigator.vibrate?.(8)
      }

      if (selectionModeAtStart) {
        gesture.timer = window.setTimeout(startSelection, SELECTION_EXISTING_PRESS_MS)
      } else {
        gesture.timer = window.setTimeout(startSelection, SELECTION_LONG_PRESS_MS)
      }

      function cleanup() {
        window.clearTimeout(gesture.timer)
        stopAutoScroll()
        window.removeEventListener("pointermove", handleMove)
        window.removeEventListener("pointerup", handleEnd)
        window.removeEventListener("pointercancel", handleEnd)
        unlockSelectionScroll?.()
        try {
          if (pointerTarget.hasPointerCapture(event.pointerId)) {
            pointerTarget.releasePointerCapture(event.pointerId)
          }
        } catch {
          // Ignore pointer capture cleanup failures.
        }
        cleanupRef.current = null
      }

      function handleMove(moveEvent: globalThis.PointerEvent) {
        if (moveEvent.pointerId !== event.pointerId) return
        gesture.pointerX = moveEvent.clientX
        gesture.pointerY = moveEvent.clientY

        const distance = Math.hypot(moveEvent.clientX - gesture.startX, moveEvent.clientY - gesture.startY)
        const dragStartDistance = event.pointerType === "touch" ? 10 : 8
        const cancelDistance = event.pointerType === "touch" ? 30 : 18
        if (!gesture.active) {
          if (selectionModeAtStart && distance > dragStartDistance) {
            gesture.cancelled = true
            window.clearTimeout(gesture.timer)
          } else if (!selectionModeAtStart && distance > cancelDistance) {
            gesture.cancelled = true
            window.clearTimeout(gesture.timer)
          }
        }

        if (gesture.active) {
          moveEvent.preventDefault()
          gesture.lastIndex = applySelectionAtPoint(moveEvent.clientX, moveEvent.clientY, shouldSelect, gesture.lastIndex)
          updateAutoScroll(moveEvent.clientY)
        }
      }

      function handleEnd(endEvent: globalThis.PointerEvent) {
        if (endEvent.pointerId !== event.pointerId) return
        if (gesture.active) {
          endEvent.preventDefault()
          suppressClickUntilRef.current = performance.now() + 500
        }
        cleanup()
      }

      cleanupRef.current = cleanup
      window.addEventListener("pointermove", handleMove, { passive: false })
      window.addEventListener("pointerup", handleEnd, { passive: false })
      window.addEventListener("pointercancel", handleEnd, { passive: false })
    },
    [applySelectionAtPoint, applySelectionRange],
  )

  const handleClick = useCallback(
    (node: NodeDto, open: () => void, event: ReactMouseEvent<HTMLElement>) => {
      if (performance.now() < suppressClickUntilRef.current) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (selectedIdsRef.current.size > 0) {
        event.preventDefault()
        toggleSelectedId(node.id)
        return
      }

      open()
    },
    [toggleSelectedId],
  )

  const selectedNodes = useMemo(() => nodes.filter((node) => selectedIds.has(node.id)), [nodes, selectedIds])

  return {
    selectedIds,
    selectedNodes,
    selectionMode: selectedIds.size > 0,
    selectionBox,
    clearSelection,
    selectAll,
    handleMarqueePointerDown,
    handlePointerDown,
    handleClick,
  }
}

function FileManager({ onAuthExpired }: { onAuthExpired: () => void }) {
  const { folderId: routeFolderId = ROOT_ID } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const sortMode = parseSortMode(searchParams.get("sort"))
  const query = searchParams.get("q") ?? ""
  const searchScope = parseSearchScope(searchParams.get("scope"))
  const mediaFilter = parseMediaFilter(searchParams.get("media"))
  const viewerId = searchParams.get(VIEW_PARAM)
  const searchActive = query.trim().length > 0
  const [data, setData] = useState<FolderResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchValue, setSearchValue] = useState(query)
  const [searchResults, setSearchResults] = useState<NodeDto[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [renameTarget, setRenameTarget] = useState<NodeDto | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<NodeDto | null>(null)
  const [batchDeleteNodes, setBatchDeleteNodes] = useState<NodeDto[]>([])
  const [batchShareFiles, setBatchShareFiles] = useState<NodeDto[]>([])
  const [shareNode, setShareNode] = useState<NodeDto | null>(null)
  const [detailsNode, setDetailsNode] = useState<NodeDto | null>(null)
  const [viewerNode, setViewerNode] = useState<NodeDto | null>(null)
  const [pendingFileImport, setPendingFileImport] = useState<PendingFileImport | null>(null)
  const [importFolderName, setImportFolderName] = useState("")
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateConflictRequest | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const directoryInput = useRef<HTMLInputElement | null>(null)
  const clientId = useClientId()
  const request = useAuthedRequest(onAuthExpired, clientId)
  const [gridSize, setGridSize] = useGridSize()
  const [gridColumns, setGridColumns] = useGridColumns()
  const duplicatePromptQueueRef = useRef<Promise<void>>(Promise.resolve())

  const fetchFolder = useCallback(
    async (id: string, nextSortMode: SortMode, nextMedia: MediaFilter) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ sort: nextSortMode })
        if (nextMedia !== "all") params.set("media", nextMedia)
        setData(await request<FolderResponse>(`/api/folders/${id}?${params}`))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Chargement impossible.")
      } finally {
        setLoading(false)
      }
    },
    [request],
  )

  const setMediaFilter = useCallback(
    (next: MediaFilter) => {
      const params = new URLSearchParams(searchParams)
      if (next === "all") params.delete("media")
      else params.set("media", next)
      navigate(
        { pathname: location.pathname, search: params.toString() ? `?${params}` : "" },
        { replace: true },
      )
    },
    [location.pathname, navigate, searchParams],
  )

  useEffect(() => {
    void fetchFolder(routeFolderId, sortMode, mediaFilter)
  }, [fetchFolder, routeFolderId, sortMode, mediaFilter])

  const fetchSearch = useCallback(
    async (folderId: string, nextSortMode: SortMode, nextQuery: string, nextScope: SearchScope) => {
      if (!nextQuery.trim()) {
        setSearchResults([])
        return
      }

      setSearchLoading(true)
      try {
        const params = new URLSearchParams({
          sort: nextSortMode,
          q: nextQuery.trim(),
          scope: nextScope,
          folder_id: folderId,
        })
        const payload = await request<SearchResponse>(`/api/search?${params}`)
        setSearchResults(payload.nodes)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Recherche impossible.")
      } finally {
        setSearchLoading(false)
      }
    },
    [request],
  )

  useEffect(() => {
    setSearchValue(query)
  }, [query])

  useEffect(() => {
    void fetchSearch(routeFolderId, sortMode, query, searchScope)
  }, [fetchSearch, query, routeFolderId, searchScope, sortMode])

  useEffect(() => {
    if (searchValue === query) return
    const timer = window.setTimeout(() => {
      navigate(folderRoute(routeFolderId, sortMode, searchValue, searchScope), { replace: true })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [navigate, query, routeFolderId, searchScope, searchValue, sortMode])

  function changeSearchScope(nextScope: SearchScope) {
    navigate(folderRoute(routeFolderId, sortMode, query, nextScope), { replace: true })
  }

  function openFolder(id: string) {
    navigate(folderRoute(id, sortMode))
  }

  function openViewer(node: NodeDto, replace = false) {
    const params = new URLSearchParams(searchParams)
    params.set(VIEW_PARAM, node.id)
    setViewerNode(node)
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params}` : "",
      },
      { replace },
    )
  }

  function closeViewer() {
    const params = new URLSearchParams(searchParams)
    params.delete(VIEW_PARAM)
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params}` : "",
      },
      { replace: true },
    )
  }

  async function createFolderNamed(name: string, parentId = routeFolderId) {
    return request<NodeDto>(`/api/folders/${parentId}/folders`, {
      method: "POST",
      body: JSON.stringify({ name }),
    })
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault()
    const name = newFolderName.trim()
    if (!name) return

    try {
      const folder = await createFolderNamed(name)
      upsertVisibleChild(folder)
      setNewFolderName("")
      setCreateOpen(false)
      toast.success("Dossier cree")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Creation impossible.")
    }
  }

  function upsertVisibleChild(node: NodeDto) {
    if (!nodeMatchesMedia(node, mediaFilter)) return
    setData((current) => {
      if (!current || node.parent_id !== current.folder.id) return current
      return {
        ...current,
        children: sortNodesForMode(upsertNode(current.children, node), sortMode),
      }
    })
  }

  function openRename(node: NodeDto) {
    setRenameTarget(node)
    setRenameValue(node.name)
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault()
    const target = renameTarget
    const name = renameValue.trim()
    if (!target || !name || name === target.name) {
      setRenameTarget(null)
      return
    }

    const optimistic = { ...target, name }
    setRenameTarget(null)
    upsertClientNode(optimistic)

    try {
      const renamed = await request<NodeDto>(`/api/nodes/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      })
      upsertClientNode(renamed)
      toast.success("Element renomme")
    } catch (err) {
      upsertClientNode(target)
      toast.error(err instanceof Error ? err.message : "Renommage impossible.")
    }
  }

  async function submitDelete() {
    const target = deleteTarget
    if (!target) return

    const deletedIds = new Set([target.id])
    const wasInFolder = data?.children.some((node) => node.id === target.id) ?? false
    const wasInSearch = searchResults.some((node) => node.id === target.id)
    const replacementViewerNode =
      viewerNode?.id === target.id ? replacementMediaNodeAfterDelete(mediaNodes, deletedIds, target.id) : null

    setDeleteTarget(null)
    setDetailsNode((current) => (current?.id === target.id ? null : current))
    if (viewerNode?.id === target.id) {
      if (replacementViewerNode) openViewer(replacementViewerNode, true)
      else {
        setViewerNode(null)
        closeViewer()
      }
    }
    setData((current) => current ? { ...current, children: removeNodesByIds(current.children, deletedIds) } : current)
    setSearchResults((current) => removeNodesByIds(current, deletedIds))

    try {
      await request<void>(`/api/nodes/${target.id}`, { method: "DELETE" })
      toast.success(target.kind === "folder" ? "Dossier supprime" : "Fichier supprime")
    } catch (err) {
      if (wasInFolder) {
        setData((current) =>
          current ? { ...current, children: sortNodesForMode(upsertNode(current.children, target), sortMode) } : current,
        )
      }
      if (wasInSearch) {
        setSearchResults((current) => sortNodesForMode(upsertNode(current, target), sortMode))
      }
      toast.error(err instanceof Error ? err.message : "Suppression impossible.")
    }
  }

  async function submitBatchDelete() {
    const targets = batchDeleteNodes
    if (targets.length === 0) return

    const deletedIds = new Set(targets.map((target) => target.id))
    const folderVisibleIds = new Set(data?.children.map((node) => node.id) ?? [])
    const searchVisibleIds = new Set(searchResults.map((node) => node.id))
    const replacementViewerNode =
      viewerNode && deletedIds.has(viewerNode.id)
        ? replacementMediaNodeAfterDelete(mediaNodes, deletedIds, viewerNode.id)
        : null

    setBatchDeleteNodes([])
    selection.clearSelection()
    setDetailsNode((current) => (current && deletedIds.has(current.id) ? null : current))
    if (viewerNode && deletedIds.has(viewerNode.id)) {
      if (replacementViewerNode) openViewer(replacementViewerNode, true)
      else {
        setViewerNode(null)
        closeViewer()
      }
    }
    setData((current) => current ? { ...current, children: removeNodesByIds(current.children, deletedIds) } : current)
    setSearchResults((current) => removeNodesByIds(current, deletedIds))

    let deletedCount = 0
    const failedTargets: NodeDto[] = []

    for (const target of targets) {
      try {
        await request<void>(`/api/nodes/${target.id}`, { method: "DELETE" })
        deletedCount += 1
      } catch {
        failedTargets.push(target)
      }
    }

    if (failedTargets.length > 0) {
      const failedFolderNodes = failedTargets.filter((target) => folderVisibleIds.has(target.id))
      const failedSearchNodes = failedTargets.filter((target) => searchVisibleIds.has(target.id))
      if (failedFolderNodes.length > 0) {
        setData((current) =>
          current ? { ...current, children: restoreNodes(current.children, failedFolderNodes, sortMode) } : current,
        )
      }
      if (failedSearchNodes.length > 0) {
        setSearchResults((current) => restoreNodes(current, failedSearchNodes, sortMode))
      }
    }

    if (deletedCount > 0) {
      toast.success(`${deletedCount} element${deletedCount > 1 ? "s" : ""} supprime${deletedCount > 1 ? "s" : ""}`)
    }
    if (failedTargets.length > 0) {
      toast.error(`${failedTargets.length} suppression${failedTargets.length > 1 ? "s" : ""} impossible${failedTargets.length > 1 ? "s" : ""}`)
    }
  }

  function importSelectedFiles(files: FileList | File[] | null) {
    const selectedFiles = Array.from(files ?? [])
    if (selectedFiles.length === 0) {
      toast.warning("Aucun fichier recu", {
        description: "Le navigateur n'a pas transmis de fichier apres la selection.",
      })
      return
    }
    void uploadFiles(selectedFiles)
  }

  function startDirectoryImport(files: FileList | File[] | null, suggestedFolderName?: string) {
    const selectedFiles = Array.from(files ?? [])
    if (selectedFiles.length === 0) {
      toast.warning("Aucun fichier recu", {
        description: "Le navigateur n'a pas transmis de fichier apres la selection.",
      })
      return
    }
    setPendingFileImport({ files: selectedFiles, suggestedFolderName })
    setImportFolderName(defaultImportFolderName(selectedFiles, suggestedFolderName))
  }

  async function importPendingFilesHere() {
    const pending = pendingFileImport
    if (!pending) return
    setPendingFileImport(null)
    await uploadFiles(pending.files, { stripImportedRoot: true })
  }

  async function importPendingFilesInNewFolder() {
    const pending = pendingFileImport
    const name = importFolderName.trim()
    if (!pending || !name) return

    try {
      const folder = await createFolderNamed(name)
      upsertVisibleChild(folder)
      setPendingFileImport(null)
      toast.success("Dossier cree")
      await uploadFiles(pending.files, { baseFolderId: folder.id, stripImportedRoot: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Creation impossible.")
    }
  }

  function askDuplicateConflict(fileName: string) {
    const queuedDecision = duplicatePromptQueueRef.current.then(() => new Promise<DuplicateDecision>((resolve) => {
      setDuplicateConflict({ fileName, resolve })
    }))
    duplicatePromptQueueRef.current = queuedDecision.then(() => undefined, () => undefined)
    return queuedDecision
  }

  function upsertClientNode(node: NodeDto) {
    setData((current) => {
      if (!current) return current
      const children = reconcileNodeChildren(current.children, node, current.folder.id, sortMode)
      return children === current.children ? current : { ...current, children }
    })
    setSearchResults((current) =>
      reconcileSearchNodes(current, node, query, searchScope, data?.folder ?? null, sortMode),
    )
    setDetailsNode((current) => (current?.id === node.id ? node : current))
    setViewerNode((current) => (current?.id === node.id && node.kind === "file" ? node : current))
  }

  async function uploadFiles(
    files: FileList | File[],
    options: { baseFolderId?: string; stripImportedRoot?: boolean } = {},
  ) {
    const uploadRootId = options.baseFolderId ?? routeFolderId
    let duplicatePolicy: DuplicateAction | null = null
    let successCount = 0
    let errorCount = 0
    const candidates = Array.from(files)
    if (candidates.length === 0) {
      toast.info("Aucun fichier recu", { description: "Le navigateur n'a renvoye aucun fichier pour ce dossier." })
      return
    }

    const mediaFiles = candidates.filter(isAllowedMediaFile)
    const rejected = candidates.length - mediaFiles.length
    if (rejected > 0) {
      toast.warning(`${rejected} fichier${rejected > 1 ? "s ignores" : " ignore"}`, {
        description: "Seules les images et videos sont acceptees.",
      })
    }
    if (mediaFiles.length === 0) {
      toast.info("Aucun media trouve", { description: "Le dossier ne contient pas d'image ou de video reconnue." })
      return
    }

    const strippedRoot = options.stripImportedRoot ? commonImportedRoot(mediaFiles) : ""
    const lightImport = shouldUseLightImport(mediaFiles)
    const batchToastId = lightImport ? `upload-batch:${crypto.randomUUID()}` : null
    if (lightImport && batchToastId) {
      toast.info("Mode import leger", {
        description: "Progression groupee pour limiter les notifications.",
      })
      showUploadToast(batchToastId, `${mediaFiles.length} medias`, 0, "Preparation")
    }

    if (mediaFiles.length > 1) {
      toast.info("Fenetre d'upload", {
        description: "Jusqu'a 2 Go de medias envoyes en meme temps.",
      })
    }

    const folderCache = new Map<string, string>()
    const progressByIndex = new Array<number>(mediaFiles.length).fill(0)

    const uploadFileAtIndex = async (fileIndex: number) => {
      const file = mediaFiles[fileIndex]
      const folderSegments = importFolderSegments(file, strippedRoot)
      const toastId = batchToastId ?? `upload:${crypto.randomUUID()}`
      const fileName = uploadDisplayName(file, strippedRoot)
      const toastName = lightImport ? `Import ${fileIndex + 1}/${mediaFiles.length}` : fileName
      const updateToast = (progress: number, label: string, state: "active" | "done" | "error" = "active") => {
        const boundedProgress = Math.max(0, Math.min(100, progress))
        const toastState = lightImport ? "active" : state
        const nextProgress = lightImport
          ? Math.min(
              99,
              Math.round(
                progressByIndex.reduce((total, current, index) => {
                  return total + (index === fileIndex ? Math.max(current, boundedProgress) : current)
                }, 0) / mediaFiles.length,
              ),
            )
          : boundedProgress

        progressByIndex[fileIndex] = Math.max(progressByIndex[fileIndex] ?? 0, boundedProgress)
        showUploadToast(toastId, toastName, nextProgress, lightImport ? `${label} - ${fileName}` : label, toastState)
      }

      updateToast(0, "Envoi")

      try {
        const targetFolderId = folderSegments.length
          ? await ensureFolderPath(request, uploadRootId, folderSegments, folderCache, upsertVisibleChild)
          : uploadRootId
        const previewPromise = createPreviewForUpload(file)
        const uploaded = await uploadFileWithConflictHandling({
          request,
          clientId,
          folderId: targetFolderId,
          file,
          onProgress: (progress) => updateToast(progress, "Envoi"),
          getDuplicateDecision: async (fileName) => {
            if (duplicatePolicy) {
              return { action: duplicatePolicy, applyToAll: false }
            }

            const decision = await askDuplicateConflict(fileName)
            if (decision.applyToAll) {
              duplicatePolicy = decision.action
            }
            return decision
          },
        })

        if (!uploaded) {
          updateToast(100, "Ignore", "done")
          return
        }

        upsertVisibleChild(uploaded)
        void uploadPreparedPreview(clientId, uploaded.id, previewPromise, upsertClientNode)
        successCount += 1
        updateToast(100, "Termine", "done")
      } catch (err) {
        errorCount += 1
        updateToast(100, err instanceof Error ? err.message : "Upload impossible", "error")
      } finally {
        await releaseBrowserMemory()
      }
    }

    await runUploadsWithinByteWindow(
      mediaFiles.length,
      (fileIndex) => uploadWindowBytes(mediaFiles[fileIndex]),
      uploadFileAtIndex,
    )

    if (lightImport && batchToastId) {
      const label = errorCount > 0 ? `${successCount} importes, ${errorCount} erreurs` : "Termine"
      showUploadToast(batchToastId, `${mediaFiles.length} medias`, 100, label, errorCount > 0 ? "error" : "done")
    }
  }

  async function openDirectoryImport() {
    const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker
    if (directoryPicker) {
      try {
        const directory = await directoryPicker.call(window)
        const files = await collectDirectoryFiles(directory)
        if (files.length === 0) {
          toast.info("Aucun media trouve", { description: "Le dossier ne contient pas d'image ou de video." })
          return
        }
        startDirectoryImport(files, directory.name)
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        toast.error("Import dossier impossible.")
      }
      return
    }

    if (supportsDirectoryInput()) {
      directoryInput.current?.click()
      return
    }

    toast.warning("Import dossier indisponible sur ce navigateur", {
      description: "Sur iPhone, selectionne plusieurs images/videos depuis Photos ou Fichiers.",
    })
    fileInput.current?.click()
  }

  const visibleNodes = searchActive ? searchResults : (data?.children ?? [])
  const groups = useMemo(() => groupNodesBySort(visibleNodes, sortMode), [visibleNodes, sortMode])
  const mediaNodes = useMemo(() => flattenGroupNodes(groups).filter(isFileNode), [groups])
  const selection = useNodeSelection(visibleNodes)
  const selectedFiles = useMemo(() => selection.selectedNodes.filter(isFileNode), [selection.selectedNodes])

  useEffect(() => {
    if (!viewerId) {
      setViewerNode(null)
      return
    }

    const node = visibleNodes.find((candidate) => candidate.id === viewerId && candidate.kind === "file")
    setViewerNode(node ?? null)
  }, [viewerId, visibleNodes])

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.source_client_id === clientId) return

      if (event.type === "node_upsert") {
        const node = event.node
        if (nodeMatchesMedia(node, mediaFilter)) {
          setData((current) => {
            if (!current) return current
            const children = reconcileNodeChildren(current.children, node, current.folder.id, sortMode)
            return children === current.children ? current : { ...current, children }
          })
        }
        setSearchResults((current) =>
          reconcileSearchNodes(current, node, query, searchScope, data?.folder ?? null, sortMode),
        )
        setDetailsNode((current) => (current?.id === node.id ? node : current))
        setViewerNode((current) => (current?.id === node.id && node.kind === "file" ? node : current))
        return
      }

      setData((current) => {
        if (!current) return current
        const children = removeNodeById(current.children, event.id)
        return children === current.children ? current : { ...current, children }
      })
      setSearchResults((current) => removeNodeById(current, event.id))
      setDetailsNode((current) => (current?.id === event.id ? null : current))
      setViewerNode((current) => (current?.id === event.id ? null : current))
    },
    [clientId, data?.folder, mediaFilter, query, searchScope, sortMode],
  )

  useRealtimeEvents(clientId, handleRealtimeEvent)

  return (
    <>
      <div className="min-h-svh" onContextMenu={preventAppContextMenu}>
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-[env(safe-area-inset-top)] sm:pb-12 sm:pt-6">
        <SearchControls
          mediaFilter={mediaFilter}
          onMediaFilterChange={setMediaFilter}
          gridSize={gridSize}
          onGridSizeChange={setGridSize}
          gridColumns={gridColumns}
          onGridColumnsChange={setGridColumns}
        />

        <SelectionBar
          count={selection.selectedNodes.length}
          fileCount={selectedFiles.length}
          onSelectAll={selection.selectAll}
          onClear={selection.clearSelection}
          onShare={() => setBatchShareFiles(selectedFiles)}
          onDelete={() => setBatchDeleteNodes(selection.selectedNodes)}
        />

        <MobileActionMenu
          actions={[
            {
              label: "Nouveau dossier",
              icon: <FolderPlus />,
              onSelect: () => setCreateOpen(true),
              variant: "outline",
            },
            {
              label: "Envoyer des fichiers",
              icon: <Upload />,
              fileInput: {
                accept: MEDIA_ACCEPT,
                multiple: true,
                onChange: importSelectedFiles,
              },
            },
            {
              label: "Importer un dossier",
              icon: <FolderUp />,
              onSelect: openDirectoryImport,
            },
          ]}
        />

        <input
          ref={fileInput}
          className="pointer-events-none fixed -left-96 top-0 size-px opacity-0"
          aria-hidden="true"
          tabIndex={-1}
          accept={MEDIA_ACCEPT}
          multiple
          type="file"
          onChange={(event) => {
            importSelectedFiles(event.target.files)
            event.target.value = ""
          }}
        />
        <input
          ref={(node) => {
            directoryInput.current = node
            if (node) {
              node.setAttribute("webkitdirectory", "")
              node.setAttribute("directory", "")
            }
          }}
          className="pointer-events-none fixed -left-96 top-0 size-px opacity-0"
          aria-hidden="true"
          tabIndex={-1}
          multiple
          type="file"
          onChange={(event) => {
            if (!event.target.files || event.target.files.length === 0) {
              toast.warning("Dossier non accessible", {
                description: "Android ne fournit pas toujours le contenu d'un dossier. Utilise l'envoi de fichiers pour selectionner plusieurs medias.",
              })
              event.target.value = ""
              return
            }
            startDirectoryImport(event.target.files)
            event.target.value = ""
          }}
        />

        <div className="hidden sm:mb-5 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:px-4 sm:py-2.5 sm:shadow-sm">
          <Brand />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-9 flex-none text-sm"
              onClick={() => setCreateOpen(true)}
            >
              <FolderPlus />
              Nouveau
            </Button>
            <Button
              variant="outline"
              className="h-9 flex-none text-sm"
              onClick={() => navigate(allFilesRoute(sortMode))}
            >
              <Files />
              Tous
            </Button>
            <Button
              className="h-9 flex-none text-sm"
              onClick={() => fileInput.current?.click()}
            >
              <Upload />
              Fichiers
            </Button>
            <Button
              className="h-9 flex-none text-sm"
              onClick={openDirectoryImport}
            >
              <FolderUp />
              Dossier
            </Button>
          </div>
        </div>

        {data && data.breadcrumbs.length > 1 && (
          <Breadcrumbs items={data.breadcrumbs} onNavigate={openFolder} />
        )}

        <DropZone
          onFiles={importSelectedFiles}
          onSelectionPointerDown={selection.handleMarqueePointerDown}
          selectionBox={selection.selectionBox}
        >
          {searchActive && (
            <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                Recherche {searchScope === "current" ? "dans ce dossier" : "dans tous les dossiers"}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSearchValue("")}>
                <X />
                Effacer
              </Button>
            </div>
          )}
          {searchActive ? (
            searchLoading ? (
              <LoadingGrid gridSize={gridSize} gridColumns={gridColumns} />
            ) : searchResults.length > 0 ? (
            <GroupedNodeGrid
              groups={groups}
              sortMode={sortMode}
              gridSize={gridSize}
                gridColumns={gridColumns}
                showPath
                onOpen={(node) => (node.kind === "folder" ? openFolder(node.id) : openViewer(node))}
                selectedIds={selection.selectedIds}
                selectionMode={selection.selectionMode}
                onNodePointerDown={selection.handlePointerDown}
                onNodeClick={selection.handleClick}
              />
            ) : (
              <SearchEmptyState query={query} scope={searchScope} />
            )
          ) : loading ? (
            <LoadingGrid gridSize={gridSize} gridColumns={gridColumns} />
          ) : data && data.children.length > 0 ? (
            <GroupedNodeGrid
              groups={groups}
              sortMode={sortMode}
              gridSize={gridSize}
              gridColumns={gridColumns}
              onOpen={(node) => (node.kind === "folder" ? openFolder(node.id) : openViewer(node))}
              selectedIds={selection.selectedIds}
              selectionMode={selection.selectionMode}
              onNodePointerDown={selection.handlePointerDown}
              onNodeClick={selection.handleClick}
            />
          ) : (
            <EmptyState />
          )}
        </DropZone>
      </main>

      <CreateFolderDialog
        open={createOpen}
        value={newFolderName}
        onValueChange={setNewFolderName}
        onOpenChange={setCreateOpen}
        onSubmit={createFolder}
      />
      <RenameDialog
        target={renameTarget}
        value={renameValue}
        onValueChange={setRenameValue}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        onSubmit={submitRename}
      />
      <DeleteDialog target={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} onConfirm={submitDelete} />
      <BatchDeleteDialog
        targets={batchDeleteNodes}
        onOpenChange={(open) => !open && setBatchDeleteNodes([])}
        onConfirm={() => void submitBatchDelete()}
      />
      <FileImportDestinationDialog
        pending={pendingFileImport}
        folderName={importFolderName}
        onFolderNameChange={setImportFolderName}
        onOpenChange={(open) => !open && setPendingFileImport(null)}
        onImportHere={() => void importPendingFilesHere()}
        onImportInFolder={() => void importPendingFilesInNewFolder()}
      />
      <DuplicateConflictDialog
        request={duplicateConflict}
        onResolve={(decision) => {
          duplicateConflict?.resolve(decision)
          setDuplicateConflict(null)
        }}
      />
      <DetailsDialog
        node={detailsNode}
        showPath={searchActive}
        onOpenChange={(open) => !open && setDetailsNode(null)}
        onDownload={(node) => void downloadProtectedFile(node)}
        onShare={(node) => setShareNode(node)}
        onRename={openRename}
        onDelete={setDeleteTarget}
        onOpenParent={(node) => openFolder(node.parent_id ?? ROOT_ID)}
      />
      <MediaViewer
        node={viewerNode}
        nodes={mediaNodes}
        onNavigate={(node) => openViewer(node, true)}
        onOpenChange={(open) => !open && closeViewer()}
        onShare={(node) => setShareNode(node)}
        onDownload={(node) => void downloadProtectedFile(node)}
        onDelete={(node) => setDeleteTarget(node)}
      />
      <ShareDialog
        node={shareNode}
        onOpenChange={(open) => !open && setShareNode(null)}
        request={request}
      />
        <BatchShareDialog
          files={batchShareFiles}
          request={request}
          onOpenChange={(open) => !open && setBatchShareFiles([])}
        />
      </div>
    </>
  )
}

function AllFilesView({ onAuthExpired }: { onAuthExpired: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const sortMode = parseSortMode(searchParams.get("sort"))
  const query = searchParams.get("q") ?? ""
  const mediaFilter = parseMediaFilter(searchParams.get("media"))
  const viewerId = searchParams.get(VIEW_PARAM)
  const [searchValue, setSearchValue] = useState(query)
  const [files, setFiles] = useState<NodeDto[]>([])
  const [loading, setLoading] = useState(true)
  const [renameTarget, setRenameTarget] = useState<NodeDto | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<NodeDto | null>(null)
  const [batchDeleteNodes, setBatchDeleteNodes] = useState<NodeDto[]>([])
  const [batchShareFiles, setBatchShareFiles] = useState<NodeDto[]>([])
  const [shareNode, setShareNode] = useState<NodeDto | null>(null)
  const [detailsNode, setDetailsNode] = useState<NodeDto | null>(null)
  const [viewerNode, setViewerNode] = useState<NodeDto | null>(null)
  const clientId = useClientId()
  const request = useAuthedRequest(onAuthExpired, clientId)
  const [gridSize, setGridSize] = useGridSize()
  const [gridColumns, setGridColumns] = useGridColumns()

  const fetchFiles = useCallback(
    async (nextSortMode: SortMode, nextQuery: string, nextMedia: MediaFilter) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ sort: nextSortMode })
        if (nextQuery.trim()) {
          params.set("q", nextQuery.trim())
        }
        if (nextMedia !== "all") params.set("media", nextMedia)
        const payload = await request<FilesResponse>(`/api/files?${params}`)
        setFiles(payload.files)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Chargement impossible.")
      } finally {
        setLoading(false)
      }
    },
    [request],
  )

  const setMediaFilter = useCallback(
    (next: MediaFilter) => {
      const params = new URLSearchParams(searchParams)
      if (next === "all") params.delete("media")
      else params.set("media", next)
      navigate(
        { pathname: location.pathname, search: params.toString() ? `?${params}` : "" },
        { replace: true },
      )
    },
    [location.pathname, navigate, searchParams],
  )

  useEffect(() => {
    setSearchValue(query)
  }, [query])

  useEffect(() => {
    void fetchFiles(sortMode, query, mediaFilter)
  }, [fetchFiles, query, sortMode, mediaFilter])

  useEffect(() => {
    if (searchValue === query) return
    const timer = window.setTimeout(() => {
      navigate(allFilesRoute(sortMode, searchValue), { replace: true })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [navigate, query, searchValue, sortMode])

  function openViewer(node: NodeDto, replace = false) {
    const params = new URLSearchParams(searchParams)
    params.set(VIEW_PARAM, node.id)
    setViewerNode(node)
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params}` : "",
      },
      { replace },
    )
  }

  function closeViewer() {
    const params = new URLSearchParams(searchParams)
    params.delete(VIEW_PARAM)
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params}` : "",
      },
      { replace: true },
    )
  }

  function openRename(node: NodeDto) {
    setRenameTarget(node)
    setRenameValue(node.name)
  }

  function upsertClientNode(node: NodeDto) {
    setFiles((current) => {
      const alreadyVisible = current.some((candidate) => candidate.id === node.id)
      if (nodeMatchesMedia(node, mediaFilter) && node.kind === "file" && nodeMatchesSearch(node, query)) {
        return upsertNode(current, node)
      }
      return alreadyVisible ? removeNodeById(current, node.id) : current
    })
    setDetailsNode((current) => (current?.id === node.id ? node : current))
    setViewerNode((current) => (current?.id === node.id && node.kind === "file" ? node : current))
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault()
    const target = renameTarget
    const name = renameValue.trim()
    if (!target || !name || name === target.name) {
      setRenameTarget(null)
      return
    }

    const optimistic = { ...target, name }
    setRenameTarget(null)
    upsertClientNode(optimistic)

    try {
      const renamed = await request<NodeDto>(`/api/nodes/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      })
      upsertClientNode(renamed)
      toast.success("Fichier renomme")
    } catch (err) {
      upsertClientNode(target)
      toast.error(err instanceof Error ? err.message : "Renommage impossible.")
    }
  }

  async function submitDelete() {
    const target = deleteTarget
    if (!target) return

    const deletedIds = new Set([target.id])
    const wasInFiles = files.some((node) => node.id === target.id)
    const replacementViewerNode =
      viewerNode?.id === target.id ? replacementMediaNodeAfterDelete(mediaNodes, deletedIds, target.id) : null

    setDeleteTarget(null)
    setDetailsNode((current) => (current?.id === target.id ? null : current))
    if (viewerNode?.id === target.id) {
      if (replacementViewerNode) openViewer(replacementViewerNode, true)
      else {
        setViewerNode(null)
        closeViewer()
      }
    }
    setFiles((current) => removeNodesByIds(current, deletedIds))

    try {
      await request<void>(`/api/nodes/${target.id}`, { method: "DELETE" })
      toast.success("Fichier supprime")
    } catch (err) {
      if (wasInFiles) {
        setFiles((current) => restoreNodes(current, [target], sortMode))
      }
      toast.error(err instanceof Error ? err.message : "Suppression impossible.")
    }
  }

  async function submitBatchDelete() {
    const targets = batchDeleteNodes
    if (targets.length === 0) return

    const deletedIds = new Set(targets.map((target) => target.id))
    const visibleIds = new Set(files.map((node) => node.id))
    const replacementViewerNode =
      viewerNode && deletedIds.has(viewerNode.id)
        ? replacementMediaNodeAfterDelete(mediaNodes, deletedIds, viewerNode.id)
        : null

    setBatchDeleteNodes([])
    selection.clearSelection()
    setDetailsNode((current) => (current && deletedIds.has(current.id) ? null : current))
    if (viewerNode && deletedIds.has(viewerNode.id)) {
      if (replacementViewerNode) openViewer(replacementViewerNode, true)
      else {
        setViewerNode(null)
        closeViewer()
      }
    }
    setFiles((current) => removeNodesByIds(current, deletedIds))

    let deletedCount = 0
    const failedTargets: NodeDto[] = []

    for (const target of targets) {
      try {
        await request<void>(`/api/nodes/${target.id}`, { method: "DELETE" })
        deletedCount += 1
      } catch {
        failedTargets.push(target)
      }
    }

    if (failedTargets.length > 0) {
      const failedVisibleTargets = failedTargets.filter((target) => visibleIds.has(target.id))
      if (failedVisibleTargets.length > 0) {
        setFiles((current) => restoreNodes(current, failedVisibleTargets, sortMode))
      }
    }

    if (deletedCount > 0) {
      toast.success(`${deletedCount} fichier${deletedCount > 1 ? "s" : ""} supprime${deletedCount > 1 ? "s" : ""}`)
    }
    if (failedTargets.length > 0) {
      toast.error(`${failedTargets.length} suppression${failedTargets.length > 1 ? "s" : ""} impossible${failedTargets.length > 1 ? "s" : ""}`)
    }
  }

  const groups = useMemo(() => groupNodesBySort(files, sortMode), [files, sortMode])
  const selection = useNodeSelection(files)
  const selectedFiles = useMemo(() => selection.selectedNodes.filter(isFileNode), [selection.selectedNodes])
  const mediaNodes = useMemo(() => flattenGroupNodes(groups).filter(isFileNode), [groups])

  useEffect(() => {
    if (!viewerId) {
      setViewerNode(null)
      return
    }

    const node = files.find((candidate) => candidate.id === viewerId)
    setViewerNode(node ?? null)
  }, [files, viewerId])

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.source_client_id === clientId) return

      if (event.type === "node_upsert") {
        const node = event.node
        if (nodeMatchesMedia(node, mediaFilter)) {
          setFiles((current) => reconcileAllFiles(current, node, query))
        }
        setDetailsNode((current) => (current?.id === node.id ? node : current))
        setViewerNode((current) => (current?.id === node.id && node.kind === "file" ? node : current))
        return
      }

      setFiles((current) => removeNodeById(current, event.id))
      setDetailsNode((current) => (current?.id === event.id ? null : current))
      setViewerNode((current) => (current?.id === event.id ? null : current))
    },
    [clientId, mediaFilter, query],
  )

  useRealtimeEvents(clientId, handleRealtimeEvent)

  return (
    <>
      <div className="min-h-svh" onContextMenu={preventAppContextMenu}>
        <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-[env(safe-area-inset-top)] sm:pt-6">
        <SearchControls
          mediaFilter={mediaFilter}
          onMediaFilterChange={setMediaFilter}
          gridSize={gridSize}
          onGridSizeChange={setGridSize}
          gridColumns={gridColumns}
          onGridColumnsChange={setGridColumns}
        />

        <SelectionBar
          count={selection.selectedNodes.length}
          fileCount={selectedFiles.length}
          onSelectAll={selection.selectAll}
          onClear={selection.clearSelection}
          onShare={() => setBatchShareFiles(selectedFiles)}
          onDelete={() => setBatchDeleteNodes(selection.selectedNodes)}
        />

        <div className="relative min-h-[48svh]" onPointerDown={selection.handleMarqueePointerDown}>
          {selection.selectionBox && <SelectionMarquee box={selection.selectionBox} />}
          {loading ? (
            <LoadingGrid gridSize={gridSize} gridColumns={gridColumns} />
          ) : files.length > 0 ? (
            <GroupedNodeGrid
              groups={groups}
              sortMode={sortMode}
              gridSize={gridSize}
              gridColumns={gridColumns}
              showPath
              onOpen={openViewer}
              selectedIds={selection.selectedIds}
              selectionMode={selection.selectionMode}
              onNodePointerDown={selection.handlePointerDown}
              onNodeClick={selection.handleClick}
            />
          ) : (
            <Card className="grid min-h-[42svh] place-items-center border-dashed border-border bg-card">
              <CardContent className="grid max-w-xs justify-items-center gap-4 text-center">
                <div className="grid size-16 place-items-center rounded-full bg-primary/12 text-primary">
                  <Search className="size-7" />
                </div>
                <div className="grid gap-1">
                  <p className="font-medium">Aucun fichier</p>
                  <p className="text-sm text-muted-foreground">
                    {query ? "Aucun resultat pour cette recherche recursive." : "Aucun fichier indexe pour le moment."}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <RenameDialog
        target={renameTarget}
        value={renameValue}
        onValueChange={setRenameValue}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        onSubmit={submitRename}
      />
      <DeleteDialog target={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} onConfirm={submitDelete} />
      <BatchDeleteDialog
        targets={batchDeleteNodes}
        onOpenChange={(open) => !open && setBatchDeleteNodes([])}
        onConfirm={() => void submitBatchDelete()}
      />
      <DetailsDialog
        node={detailsNode}
        showPath
        onOpenChange={(open) => !open && setDetailsNode(null)}
        onDownload={(node) => void downloadProtectedFile(node)}
        onShare={(node) => setShareNode(node)}
        onRename={openRename}
        onDelete={setDeleteTarget}
        onOpenParent={(node) => navigate(folderRoute(node.parent_id ?? ROOT_ID, sortMode))}
      />
      <MediaViewer
        node={viewerNode}
        nodes={mediaNodes}
        onNavigate={(node) => openViewer(node, true)}
        onOpenChange={(open) => !open && closeViewer()}
        onShare={(node) => setShareNode(node)}
        onDownload={(node) => void downloadProtectedFile(node)}
        onDelete={(node) => setDeleteTarget(node)}
      />
      <ShareDialog
        node={shareNode}
        onOpenChange={(open) => !open && setShareNode(null)}
        request={request}
      />
        <BatchShareDialog
          files={batchShareFiles}
          request={request}
          onOpenChange={(open) => !open && setBatchShareFiles([])}
        />
      </div>
    </>
  )
}

function preventAppContextMenu(event: ReactMouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement
  if (target.closest("input, textarea, [contenteditable='true']")) return
  event.preventDefault()
}

function SelectionBar({
  count,
  fileCount,
  onSelectAll,
  onClear,
  onShare,
  onDelete,
}: {
  count: number
  fileCount: number
  onSelectAll: () => void
  onClear: () => void
  onShare: () => void
  onDelete: () => void
}) {
  if (count === 0) return null

  return (
    <div className="sticky top-[3.75rem] z-30 mb-3 flex items-center justify-between gap-3 bg-background py-1.5 sm:top-3">
      <Badge variant="default" className="h-7 px-3 text-xs">{count} selectionne{count > 1 ? "s" : ""}</Badge>
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" onClick={onSelectAll}>
          <CheckCheck />
          <span className="sr-only">Tout selectionner</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onShare} disabled={fileCount === 0}>
          <Share2 />
          <span className="sr-only">Partager les fichiers selectionnes</span>
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 />
          <span className="sr-only">Supprimer la selection</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClear}>
          <X />
          <span className="sr-only">Annuler la selection</span>
        </Button>
      </div>
    </div>
  )
}

function MobileActionMenu({
  actions,
}: {
  actions: Array<{
    label: string
    icon: ReactNode
    onSelect?: () => void
    variant?: "default" | "outline" | "secondary"
    fileInput?: {
      accept: string
      multiple?: boolean
      onChange: (files: FileList | File[] | null) => void
    }
  }>
}) {
  const [open, setOpen] = useState(false)
  const [pressedAction, setPressedAction] = useState<string | null>(null)

  function runAction(action: (typeof actions)[number]) {
    setPressedAction(action.label)
    action.onSelect?.()
    window.setTimeout(() => {
      setOpen(false)
      setPressedAction(null)
    }, 80)
  }

  return (
    <>
      <Button
        size="icon"
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 size-14 rounded-full shadow-lg sm:hidden"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-7" />
        <span className="sr-only">Actions</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          animateContent={false}
          className="w-screen max-w-none place-items-center border-0 bg-transparent p-0 shadow-none ring-0 sm:hidden"
        >
          <DialogTitle className="sr-only">Actions</DialogTitle>
          <div className="w-[min(88vw,23rem)] rounded-2xl border border-border bg-popover p-5 shadow-xl">
            <div className="mb-4 grid gap-1 px-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</p>
              <p className="text-lg font-semibold leading-tight">Ajouter au stockage</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {actions.map((action) => {
                const pressed = pressedAction === action.label
                const firstSingle = actions.length === 3 && action === actions[0]
                const tileClassName = cn(
                  "h-24 flex-col gap-2 rounded-2xl border px-3 text-center text-sm shadow-sm transition-all active:scale-[0.98]",
                  "border-border bg-card text-foreground hover:bg-muted",
                  pressed && "border-primary bg-primary text-primary-foreground",
                  firstSingle && "col-span-2",
                )
                if (action.fileInput) {
                  return (
                    <label
                      key={action.label}
                      className={cn(
                        tileClassName,
                        "inline-flex cursor-pointer select-none items-center justify-center",
                      )}
                      onClick={() => {
                        setPressedAction(action.label)
                      }}
                    >
                      <span className="[&_svg:not([class*='size-'])]:size-6">{action.icon}</span>
                      <span className="whitespace-normal leading-tight">{action.label}</span>
                      <input
                        className="sr-only"
                        type="file"
                        accept={action.fileInput.accept}
                        multiple={action.fileInput.multiple}
                        onChange={(event) => {
                          action.fileInput?.onChange(event.target.files)
                          event.target.value = ""
                          setOpen(false)
                          setPressedAction(null)
                        }}
                      />
                    </label>
                  )
                }
                return (
                  <Button
                    key={action.label}
                    variant="secondary"
                    size="lg"
                    className={tileClassName}
                    onClick={() => runAction(action)}
                  >
                    <span className="[&_svg:not([class*='size-'])]:size-6">{action.icon}</span>
                    <span className="whitespace-normal leading-tight">{action.label}</span>
                  </Button>
                )
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Icone grille NxN (2x2, 3x3, 4x4) qui reflete la densite choisie. */
function GridSizeIcon({ columns, className }: { columns: number; className?: string }) {
  const n = Math.max(2, Math.min(4, Math.round(columns)))
  const pad = 2.5
  const gap = n === 2 ? 3 : n === 3 ? 2.2 : 1.6
  const inner = 24 - pad * 2
  const cell = (inner - gap * (n - 1)) / n
  const radius = Math.min(1.4, cell / 3)
  const cells: ReactNode[] = []
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      cells.push(
        <rect
          key={`${row}-${col}`}
          x={pad + col * (cell + gap)}
          y={pad + row * (cell + gap)}
          width={cell}
          height={cell}
          rx={radius}
        />,
      )
    }
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      {cells}
    </svg>
  )
}

const MEDIA_FILTER_LABEL: Record<MediaFilter, string> = {
  all: "Images et videos",
  image: "Images",
  video: "Videos",
}

/** Popover de filtre : bascule multiple images / videos (filtre applique cote API). */
function MediaFilterControl({
  value,
  onChange,
}: {
  value: MediaFilter
  onChange: (value: MediaFilter) => void
}) {
  const imageOn = value === "all" || value === "image"
  const videoOn = value === "all" || value === "video"

  function toggle(kind: "image" | "video") {
    const next = { image: imageOn, video: videoOn }
    next[kind] = !next[kind]
    if (!next.image && !next.video) {
      onChange(kind === "image" ? "video" : "image")
      return
    }
    onChange(next.image && next.video ? "all" : next.image ? "image" : "video")
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10 w-full justify-start gap-2 px-3.5 font-medium sm:h-11">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <span className="truncate">{MEDIA_FILTER_LABEL[value]}</span>
          <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">Afficher</p>
        <div className="grid grid-cols-2 gap-1.5">
          <MediaToggle active={imageOn} label="Images" icon={<Image className="size-5" />} onClick={() => toggle("image")} />
          <MediaToggle active={videoOn} label="Videos" icon={<Video className="size-5" />} onClick={() => toggle("video")} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MediaToggle({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-xs font-semibold transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {icon}
      {label}
      <Check className={cn("size-3.5 transition-opacity", active ? "opacity-100" : "opacity-0")} />
    </button>
  )
}

function SearchControls({
  mediaFilter,
  onMediaFilterChange,
  gridSize,
  onGridSizeChange,
  gridColumns,
  onGridColumnsChange,
}: {
  mediaFilter: MediaFilter
  onMediaFilterChange: (mediaFilter: MediaFilter) => void
  gridSize: GridSize
  onGridSizeChange: (gridSize: GridSize) => void
  gridColumns: number
  onGridColumnsChange: (gridColumns: number) => void
}) {
  const gridSizeLabel = GRID_SIZE_OPTIONS.find((option) => option.value === gridSize)?.label ?? "Moyenne"
  const gridSizeColumns = GRID_SIZE_OPTIONS.find((option) => option.value === gridSize)?.columns ?? 3
  const [gridColumnsValue, setGridColumnsValue] = useState(String(gridColumns))

  useEffect(() => {
    setGridColumnsValue(String(gridColumns))
  }, [gridColumns])

  function changeGridColumns(value: string) {
    setGridColumnsValue(value)
    if (!value.trim()) return

    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      onGridColumnsChange(parsed)
    }
  }

  return (
    <div className="sticky top-0 z-30 -mx-4 mb-2 grid gap-2 bg-background px-4 pt-2 pb-2 sm:static sm:mx-0 sm:mb-5 sm:gap-3 sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:p-3 sm:shadow-sm">
      <div className="grid grid-cols-[1fr_auto] gap-1.5 sm:gap-2">
        <MediaFilterControl value={mediaFilter} onChange={onMediaFilterChange} />
        <div className="hidden h-11 items-center gap-2 rounded-2xl border border-border bg-muted px-3 sm:flex">
          <Files className="size-4 text-muted-foreground" />
          <Label htmlFor="grid-columns" className="text-xs text-muted-foreground">
            Colonnes
          </Label>
          <Input
            id="grid-columns"
            type="number"
            inputMode="numeric"
            min={MIN_GRID_COLUMNS}
            max={MAX_GRID_COLUMNS}
            value={gridColumnsValue}
            onChange={(event) => changeGridColumns(event.target.value)}
            onBlur={() => setGridColumnsValue(String(gridColumns))}
            className="h-8 w-16 rounded-lg bg-card px-2 text-center"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-10 sm:hidden">
              <GridSizeIcon columns={gridSizeColumns} className="size-5" />
              <span className="sr-only">Taille de la grille: {gridSizeLabel}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {GRID_SIZE_OPTIONS.map((option) => (
              <DropdownMenuItem key={option.value} onSelect={() => onGridSizeChange(option.value)}>
                <GridSizeIcon columns={option.columns} className="size-4" />
                {option.label}
                {gridSize === option.value && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function SearchEmptyState({ query, scope }: { query: string; scope: SearchScope }) {
  return (
    <Card className="grid min-h-[42svh] place-items-center border-dashed border-border bg-card">
      <CardContent className="grid max-w-xs justify-items-center gap-4 text-center">
        <div className="grid size-16 place-items-center rounded-full bg-primary/12 text-primary">
          <Search className="size-7" />
        </div>
        <div className="grid gap-1">
          <p className="font-medium">Aucun resultat</p>
          <p className="text-sm text-muted-foreground">
            Aucun element trouve pour « {query} » {scope === "current" ? "dans ce dossier." : "dans tous les dossiers."}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/** Fil d Ariane : racine = icone maison, dossiers du milieu replies dans un menu "…". */
function Breadcrumbs({ items, onNavigate }: { items: NodeDto[]; onNavigate: (id: string) => void }) {
  const lastIndex = items.length - 1
  const collapse = items.length > 4
  const collapsed = collapse ? items.slice(1, lastIndex - 1) : []
  const tail = collapse ? items.slice(lastIndex - 1) : items.slice(1)

  return (
    <nav className="mb-3 flex min-w-0 items-center gap-0.5 text-sm" aria-label="Fil d Ariane">
      <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => onNavigate(items[0].id)}>
        <Home />
        <span className="sr-only">Racine</span>
      </Button>

      {collapsed.length > 0 && (
        <>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="shrink-0">
                <MoreHorizontal />
                <span className="sr-only">Dossiers intermediaires</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {collapsed.map((crumb) => (
                <DropdownMenuItem key={crumb.id} onSelect={() => onNavigate(crumb.id)}>
                  <Folder />
                  {crumb.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {tail.map((crumb, index) => {
        const last = index === tail.length - 1
        return (
          <div key={crumb.id} className="flex min-w-0 items-center">
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            {last ? (
              <span className="truncate px-2 font-medium">{crumb.name}</span>
            ) : (
              <Button variant="ghost" size="sm" className="min-w-0 max-w-40" onClick={() => onNavigate(crumb.id)}>
                <span className="truncate">{crumb.name}</span>
              </Button>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function DropZone({
  children,
  onFiles,
  onSelectionPointerDown,
  selectionBox,
}: {
  children: ReactNode
  onFiles: (files: File[]) => void
  onSelectionPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  selectionBox?: SelectionBox | null
}) {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={cn(
        "relative min-h-[48svh] rounded-lg transition-colors",
        dragging && "outline-2 outline-offset-4 outline-dashed outline-primary",
      )}
      onPointerDown={onSelectionPointerDown}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        onFiles(Array.from(event.dataTransfer.files))
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-secondary/90">
          <div className="grid justify-items-center gap-2 text-primary">
            <Upload className="size-8" />
            <p className="text-sm font-medium">Depose pour envoyer</p>
          </div>
        </div>
      )}
      {selectionBox && <SelectionMarquee box={selectionBox} />}
      {children}
    </div>
  )
}

function SelectionMarquee({ box }: { box: SelectionBox }) {
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-[3px] border border-primary bg-primary/15 shadow-[0_0_0_1px_rgb(255_255_255_/_0.5)]"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }}
    />
  )
}

function EmptyState() {
  return (
    <div className="grid min-h-[calc(100svh-14rem)] place-items-center text-center sm:min-h-[calc(100svh-16rem)]">
      <div className="grid justify-items-center gap-4 text-sm font-medium text-muted-foreground">
        <span className="grid size-16 place-items-center rounded-full bg-secondary text-secondary-foreground">
          <Folder className="size-8" />
        </span>
        Dossier vide
      </div>
    </div>
  )
}

function LoadingGrid({ gridSize, gridColumns }: { gridSize: GridSize; gridColumns: number }) {
  return (
    <section className="gallery-grid grid gap-2 sm:gap-3" style={galleryGridStyle(gridSize, gridColumns)}>
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index}>
          <Skeleton className="aspect-square w-full rounded-lg" />
        </div>
      ))}
    </section>
  )
}

function GroupedNodeGrid({
  groups,
  sortMode,
  gridSize,
  gridColumns,
  showPath = false,
  onOpen,
  selectedIds,
  selectionMode = false,
  onNodePointerDown,
  onNodeClick,
}: {
  groups: NodeGroup[]
  sortMode: SortMode
  gridSize: GridSize
  gridColumns: number
  showPath?: boolean
  onOpen: (node: NodeDto) => void
  selectedIds?: Set<string>
  selectionMode?: boolean
  onNodePointerDown?: (node: NodeDto, event: ReactPointerEvent<HTMLElement>) => void
  onNodeClick?: (node: NodeDto, open: () => void, event: ReactMouseEvent<HTMLElement>) => void
}) {
  let index = 0
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())

  function toggleGroup(id: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <section className="grid gap-5">
      {groups.map((group) => {
        const yearCollapsed = collapsedGroups.has(group.id)
        return (
          <div key={group.id} className="grid gap-3">
            {sortMode === "date" && (
              <DateGroupHeader
                id={group.id}
                label={group.label}
                count={group.nodes.length}
                collapsed={yearCollapsed}
                level="year"
                onToggle={toggleGroup}
              />
            )}
            {!yearCollapsed &&
              (group.children ? (
                <div className="grid gap-3">
                  {group.children.map((month) => {
                    const monthCollapsed = collapsedGroups.has(month.id)
                    return (
                      <DateGroupBox
                        key={month.id}
                        id={month.id}
                        label={month.label}
                        count={month.nodes.length}
                        collapsed={monthCollapsed}
                        onToggle={toggleGroup}
                      >
                        <NodeGrid
                          nodes={month.nodes}
                          sortMode={sortMode}
                          gridSize={gridSize}
                          gridColumns={gridColumns}
                          showPath={showPath}
                          selectedIds={selectedIds}
                          selectionMode={selectionMode}
                          nextIndex={() => index++}
                          onOpen={onOpen}
                          onNodePointerDown={onNodePointerDown}
                          onNodeClick={onNodeClick}
                        />
                      </DateGroupBox>
                    )
                  })}
                </div>
              ) : (
                <NodeGrid
                  nodes={group.nodes}
                  sortMode={sortMode}
                  gridSize={gridSize}
                  gridColumns={gridColumns}
                  showPath={showPath}
                  selectedIds={selectedIds}
                  selectionMode={selectionMode}
                  nextIndex={() => index++}
                  onOpen={onOpen}
                  onNodePointerDown={onNodePointerDown}
                  onNodeClick={onNodeClick}
                />
              ))}
          </div>
        )
      })}
    </section>
  )
}

function DateGroupHeader({
  id,
  label,
  count,
  collapsed,
  level,
  onToggle,
}: {
  id: string
  label: string
  count: number
  collapsed: boolean
  level: "year" | "month"
  onToggle: (id: string) => void
}) {
  return (
    <button
      type="button"
      className={cn(
        "group/group-header sticky flex w-full items-center gap-3 bg-background transition-colors",
        level === "year" ? "top-0 z-20 py-2.5" : "top-10 z-10 py-2 pl-3",
      )}
      onClick={() => onToggle(id)}
    >
      <span
        className={cn(
          "grid place-items-center rounded-full transition-colors",
          level === "year" ? "size-6 bg-primary/12 text-primary" : "size-5 bg-muted text-muted-foreground",
        )}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")} />
      </span>
      <span
        className={cn(
          "truncate font-heading font-semibold tracking-tight",
          level === "year" ? "text-base text-foreground" : "text-sm text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
          level === "year" ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  )
}

/** Bloc mensuel : une boite arrondie qui contient ses medias et se replie en douceur. */
function DateGroupBox({
  id,
  label,
  count,
  collapsed,
  onToggle,
  children,
}: {
  id: string
  label: string
  count: number
  collapsed: boolean
  onToggle: (id: string) => void
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
        onClick={() => onToggle(id)}
        aria-expanded={!collapsed}
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
          <ChevronRight className={cn("size-3.5 transition-transform duration-200", !collapsed && "rotate-90")} />
        </span>
        <span className="truncate font-heading text-sm font-semibold tracking-tight text-foreground">{label}</span>
        <span className="h-px flex-1 bg-border" />
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold leading-none tabular-nums text-muted-foreground">
          {count}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-2 pb-2 sm:px-2.5 sm:pb-2.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function NodeGrid({
  nodes,
  sortMode,
  gridSize,
  gridColumns,
  showPath,
  selectedIds,
  selectionMode,
  nextIndex,
  onOpen,
  onNodePointerDown,
  onNodeClick,
}: {
  nodes: NodeDto[]
  sortMode: SortMode
  gridSize: GridSize
  gridColumns: number
  showPath: boolean
  selectedIds?: Set<string>
  selectionMode: boolean
  nextIndex: () => number
  onOpen: (node: NodeDto) => void
  onNodePointerDown?: (node: NodeDto, event: ReactPointerEvent<HTMLElement>) => void
  onNodeClick?: (node: NodeDto, open: () => void, event: ReactMouseEvent<HTMLElement>) => void
}) {
  return (
    <div className="gallery-grid grid gap-1 sm:gap-1.5" style={galleryGridStyle(gridSize, gridColumns)}>
      {nodes.map((node) => (
        <NodeCard
          key={node.id}
          node={node}
          sortMode={sortMode}
          showPath={showPath}
          index={nextIndex()}
          selected={selectedIds?.has(node.id) ?? false}
          selectionMode={selectionMode}
          onPointerDown={(event) => onNodePointerDown?.(node, event)}
          onOpen={(event) => {
            const open = () => onOpen(node)
            if (onNodeClick) {
              onNodeClick(node, open, event)
            } else {
              open()
            }
          }}
        />
      ))}
    </div>
  )
}

function NodeCard({
  node,
  sortMode,
  showPath = false,
  index,
  selected,
  selectionMode,
  onPointerDown,
  onOpen,
}: {
  node: NodeDto
  sortMode: SortMode
  showPath?: boolean
  index: number
  selected: boolean
  selectionMode: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  const isFolder = node.kind === "folder"
  const isImage = node.mime_type?.startsWith("image/")
  const isVideo = node.mime_type?.startsWith("video/")

  return (
    <div
      data-node-id={node.id}
      data-node-index={index}
      className="group relative"
    >
      <button
        type="button"
        className={cn(
          "block w-full touch-manipulation text-left transition-transform",
          selected ? "scale-[0.98]" : "active:translate-y-px",
        )}
        draggable={false}
        aria-pressed={selected}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={onPointerDown}
        onClick={onOpen}
      >
        <div
          className={cn(
            "relative grid aspect-square place-items-center overflow-hidden rounded-lg border transition-all group-hover:-translate-y-0.5 group-hover:shadow-md",
            isFolder
              ? "border-secondary-foreground/15 bg-secondary text-secondary-foreground shadow-sm"
              : node.preview_url
                ? "border-border bg-muted text-muted-foreground"
                : "border-border bg-muted text-muted-foreground shadow-sm",
            selectionMode && !selected && "opacity-70",
          )}
        >
          {isFolder ? (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center">
              <span className="grid size-11 place-items-center rounded-lg bg-card text-secondary-foreground shadow-sm">
                <Folder className="size-6 shrink-0" />
              </span>
              <span className="line-clamp-2 max-w-full text-[11px] font-semibold leading-tight break-words sm:text-xs">
                {node.name}
              </span>
            </div>
          ) : node.preview_url ? (
            <ProtectedPreview src={node.preview_url} className="rounded-lg" />
          ) : (
            <span className="grid size-12 place-items-center rounded-full bg-card text-muted-foreground shadow-sm">
              {isImage ? <Image className="size-6" /> : isVideo ? <Video className="size-6" /> : <FileIcon className="size-6" />}
            </span>
          )}
          {isVideo && (
            <div className="absolute right-2 bottom-2 rounded-full bg-foreground/75 p-1.5 text-background shadow-sm">
              <Video className="size-3.5" />
            </div>
          )}
          {selected && (
            <div className="pointer-events-none absolute inset-0 z-30 rounded-lg ring-[3px] ring-inset ring-primary" />
          )}
          {selected && (
            <div className="absolute top-2 left-2 z-40 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-background">
              <Check className="size-4" />
            </div>
          )}
        </div>
        {!isFolder && (
          <span className="sr-only">
            {node.name}
            {showPath ? `, ${parentPathLabel(node.relative_path)}` : ""}
            {sortMode === "date" ? `, ${formatShortDate(node.display_date_at)}` : ""}
          </span>
        )}
      </button>

    </div>
  )
}

function ProtectedPreview({
  src,
  fit = "cover",
  className,
  showFallback = true,
  onImageLoad,
}: {
  src: string
  fit?: "cover" | "contain"
  className?: string
  showFallback?: boolean
  onImageLoad?: (image: HTMLImageElement) => void
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let nextUrl: string | null = null

    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error("preview")
        return response.blob()
      })
      .then((blob) => {
        if (!active) return
        nextUrl = URL.createObjectURL(blob)
        setObjectUrl(nextUrl)
      })
      .catch(() => {
        if (active) setObjectUrl(null)
      })

    return () => {
      active = false
      if (nextUrl) URL.revokeObjectURL(nextUrl)
    }
  }, [src])

  if (!objectUrl) {
    return showFallback ? <Image className={cn("size-8", className)} /> : null
  }

  const imageClassName = cn("size-full", fit === "contain" ? "object-contain" : "object-cover", className)
  const imageProps = {
    src: objectUrl,
    alt: "",
    className: imageClassName,
    draggable: false,
    loading: "lazy" as const,
    onLoad: (event: SyntheticEvent<HTMLImageElement>) => onImageLoad?.(event.currentTarget),
  }

  return <img {...imageProps} />
}

function CreateFolderDialog({
  open,
  value,
  onValueChange,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  value: string
  onValueChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="grid gap-5" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Nouveau dossier</DialogTitle>
            <DialogDescription>Le dossier sera cree dans le dossier courant.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="folder-name">Nom</Label>
            <Input
              id="folder-name"
              autoFocus
              className="h-11"
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder="Photos"
            />
          </div>
          <DialogFooter>
            <Button type="submit" size="lg" className="h-11" disabled={!value.trim()}>
              <Check />
              Creer le dossier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({
  target,
  value,
  onValueChange,
  onOpenChange,
  onSubmit,
}: {
  target: NodeDto | null
  value: string
  onValueChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="grid gap-5" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Renommer</DialogTitle>
            <DialogDescription className="break-words">{target?.name}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="rename-name">Nouveau nom</Label>
            <Input
              id="rename-name"
              autoFocus
              className="h-11"
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" size="lg" className="h-11" disabled={!value.trim()}>
              <Pencil />
              Renommer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({
  target,
  onOpenChange,
  onConfirm,
}: {
  target: NodeDto | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer cet element ?</DialogTitle>
          <DialogDescription className="break-words">
            {target?.name} sera retire du stockage et ses previews seront supprimees.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" size="lg" className="h-11 sm:h-9" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button variant="destructive" size="lg" className="h-11 sm:h-9" onClick={onConfirm}>
            <Trash2 />
            Supprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BatchDeleteDialog({
  targets,
  onOpenChange,
  onConfirm,
}: {
  targets: NodeDto[]
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const fileCount = targets.filter(isFileNode).length
  const folderCount = targets.length - fileCount

  return (
    <Dialog open={targets.length > 0} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer la selection ?</DialogTitle>
          <DialogDescription>
            {targets.length} element{targets.length > 1 ? "s" : ""} seront retires du stockage
            {folderCount > 0 ? `, dont ${folderCount} dossier${folderCount > 1 ? "s" : ""}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" size="lg" className="h-11 sm:h-9" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button variant="destructive" size="lg" className="h-11 sm:h-9" onClick={onConfirm}>
            <Trash2 />
            Supprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FileImportDestinationDialog({
  pending,
  folderName,
  onFolderNameChange,
  onOpenChange,
  onImportHere,
  onImportInFolder,
}: {
  pending: PendingFileImport | null
  folderName: string
  onFolderNameChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onImportHere: () => void
  onImportInFolder: () => void
}) {
  const count = pending?.files.length ?? 0

  return (
    <Dialog open={!!pending} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Destination de l'import</DialogTitle>
          <DialogDescription>
            {count} fichier{count > 1 ? "s" : ""} selectionne{count > 1 ? "s" : ""}. Choisis ou les enregistrer pour lancer l'upload.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Button size="lg" className="h-12 justify-start" onClick={onImportHere}>
            <Upload />
            Importer dans ce dossier
          </Button>
          <div className="grid gap-2">
            <Label htmlFor="import-folder-name">Nom du nouveau dossier</Label>
            <Input
              id="import-folder-name"
              className="h-11"
              value={folderName}
              onChange={(event) => onFolderNameChange(event.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            size="lg"
            className="h-12 justify-start"
            disabled={!folderName.trim()}
            onClick={onImportInFolder}
          >
            <FolderPlus />
            Creer ce dossier puis importer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DuplicateConflictDialog({
  request,
  onResolve,
}: {
  request: DuplicateConflictRequest | null
  onResolve: (decision: DuplicateDecision) => void
}) {
  const [applyToAll, setApplyToAll] = useState(false)

  useEffect(() => {
    if (request) setApplyToAll(false)
  }, [request])

  function resolve(action: DuplicateAction) {
    onResolve({ action, applyToAll })
  }

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && resolve("skip")}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ce fichier existe deja</DialogTitle>
          <DialogDescription className="break-words">
            {request?.fileName}
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(event) => setApplyToAll(event.target.checked)}
          />
          Faire de meme pour tous les conflits de cet envoi
        </label>
        <DialogFooter className="!grid grid-cols-2 gap-2 sm:!grid sm:grid-cols-2 sm:justify-stretch">
          <Button className="col-span-2 h-11" onClick={() => resolve("rename")}>
            Enregistrer quand meme
          </Button>
          <Button variant="outline" className="h-11" onClick={() => resolve("skip")}>
            Ignorer
          </Button>
          <Button variant="destructive" className="h-11" onClick={() => resolve("replace")}>
            Remplacer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const FULL_IMAGE_MAX_RETRIES = 3

function ThumbnailBackdrop({
  thumbnailSrc,
  icon,
}: {
  thumbnailSrc: string | null
  icon: ReactNode
}) {
  if (!thumbnailSrc) {
    return <div className="absolute inset-0 grid place-items-center text-muted-foreground">{icon}</div>
  }

  const imageProps = {
    src: thumbnailSrc,
    alt: "",
    "aria-hidden": true,
    draggable: false,
    className: "absolute inset-0 size-full object-contain brightness-75 saturate-125",
  }

  return (
    <>
      <img {...imageProps} />
      <div className="absolute inset-0 bg-background/30" />
    </>
  )
}

function CarouselImageSlide({
  thumbnailSrc,
  fullSrc,
  alt,
}: {
  thumbnailSrc: string | null
  fullSrc: string
  alt: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setLoaded(false)
    setAttempt(0)
  }, [fullSrc])

  const retrySrc = attempt === 0 ? fullSrc : `${fullSrc}${fullSrc.includes("?") ? "&" : "?"}retry=${attempt}`

  return (
    <div className="relative size-full overflow-hidden bg-background">
      <ThumbnailBackdrop thumbnailSrc={thumbnailSrc} icon={<Image className="size-12" />} />
      {!loaded && (
        <img
          src={retrySrc}
          alt=""
          aria-hidden
          draggable={false}
          decoding="async"
          loading="eager"
          className="pointer-events-none absolute inset-0 size-full object-contain opacity-0"
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (attempt < FULL_IMAGE_MAX_RETRIES) {
              window.setTimeout(() => setAttempt((value) => value + 1), 600)
            }
          }}
        />
      )}
      {loaded && (
        <img
          src={retrySrc}
          alt={alt}
          draggable={false}
          decoding="async"
          className="absolute inset-0 z-10 size-full object-contain"
        />
      )}
    </div>
  )
}

function MediaPreviewSlide({ node, fullSrc }: { node: NodeDto; fullSrc?: string }) {
  const isVideo = node.mime_type?.startsWith("video/")
  return (
    <div className="relative size-full overflow-hidden bg-background">
      <ThumbnailBackdrop
        thumbnailSrc={node.preview_url}
        icon={isVideo ? <Video className="size-12" /> : <Image className="size-12" />}
      />
      {isVideo && fullSrc && (
        <video src={fullSrc} preload="auto" muted tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 size-full opacity-0" />
      )}
      {isVideo && (
        <div className="absolute inset-0 z-20 grid place-items-center">
          <span className="grid size-14 place-items-center rounded-full bg-foreground/55 text-background">
            <Play className="ml-0.5 size-6 fill-current" />
          </span>
        </div>
      )}
    </div>
  )
}

const CAROUSEL_ANIMATION_MS = 210
const CAROUSEL_SWIPE_MIN_PX = 52
const CAROUSEL_SWIPE_MAX_PX = 150
const CAROUSEL_SWIPE_PROJECT_MS = 170
const CAROUSEL_EDGE_RESISTANCE = 0.28
const CAROUSEL_WHEEL_SETTLE_MS = 120
type MediaActionHandlers = {
  onShare?: (node: NodeDto) => void
  onDownload?: (node: NodeDto) => void
  onDelete?: (node: NodeDto) => void
  onClose: () => void
}
type FullscreenTargetRef = { current: HTMLElement | null }

function isDialogLayerTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('[data-slot="dialog-content"], [data-slot="dialog-overlay"]')
}

function MediaViewer({
  node,
  nodes,
  onNavigate,
  onOpenChange,
  onShare,
  onDownload,
  onDelete,
}: {
  node: NodeDto | null
  nodes: NodeDto[]
  onNavigate: (node: NodeDto) => void
  onOpenChange: (open: boolean) => void
  onShare?: (node: NodeDto) => void
  onDownload?: (node: NodeDto) => void
  onDelete?: (node: NodeDto) => void
}) {
  const index = node ? nodes.findIndex((candidate) => candidate.id === node.id) : -1
  const [chromeVisible, setChromeVisible] = useState(true)
  const wasOpenRef = useRef(false)
  const viewerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const carouselRef = useRef<HTMLDivElement | null>(null)
  const navigationTimerRef = useRef(0)
  const suppressClickUntilRef = useRef(0)
  const gestureRef = useRef({
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    velocityX: 0,
    offset: 0,
    dragging: false,
    cancelled: false,
  })
  const wheelRef = useRef({ delta: 0, settleTimer: 0 })
  const [trackOffset, setTrackOffset] = useState(0)
  const [trackAnimating, setTrackAnimating] = useState(false)
  const [dragging, setDragging] = useState(false)
  const { width } = useViewportSize()

  const prev = index > 0 ? nodes[index - 1] : null
  const next = index >= 0 && index < nodes.length - 1 ? nodes[index + 1] : null
  const slots = node ? [prev, node, next].filter((candidate): candidate is NodeDto => !!candidate) : []
  const activeSlot = prev ? 1 : 0
  const activeIsVideo = node?.mime_type?.startsWith("video/") ?? false

  // Chrome visible a chaque nouvelle ouverture, conserve entre les navigations.
  useEffect(() => {
    if (node && !wasOpenRef.current) setChromeVisible(true)
    wasOpenRef.current = !!node
  }, [node])

  const carouselWidth = useCallback(() => carouselRef.current?.clientWidth || width, [width])

  const clearNavigationTimer = useCallback(() => {
    if (!navigationTimerRef.current) return
    window.clearTimeout(navigationTimerRef.current)
    navigationTimerRef.current = 0
  }, [])

  const clearWheelTimer = useCallback(() => {
    if (!wheelRef.current.settleTimer) return
    window.clearTimeout(wheelRef.current.settleTimer)
    wheelRef.current.settleTimer = 0
  }, [])

  const swipeThreshold = useCallback(() => {
    const w = carouselWidth()
    return Math.min(CAROUSEL_SWIPE_MAX_PX, Math.max(CAROUSEL_SWIPE_MIN_PX, w * 0.18))
  }, [carouselWidth])

  const applyEdgeResistance = useCallback(
    (offset: number) => {
      const w = carouselWidth()
      const limited = w > 0 ? Math.max(-w, Math.min(w, offset)) : offset
      if ((limited > 0 && !prev) || (limited < 0 && !next)) return limited * CAROUSEL_EDGE_RESISTANCE
      return limited
    },
    [carouselWidth, next, prev],
  )

  const animateBack = useCallback(() => {
    clearNavigationTimer()
    setDragging(false)
    setTrackAnimating(true)
    setTrackOffset(0)
    navigationTimerRef.current = window.setTimeout(() => {
      navigationTimerRef.current = 0
      setTrackAnimating(false)
    }, CAROUSEL_ANIMATION_MS)
  }, [clearNavigationTimer])

  const goTo = useCallback(
    (dir: number) => {
      const target = nodes[index + dir]
      if (!target) {
        animateBack()
        return
      }

      clearNavigationTimer()
      clearWheelTimer()
      wheelRef.current.delta = 0
      setDragging(false)

      const w = carouselWidth()
      if (w === 0) {
        setTrackAnimating(false)
        setTrackOffset(0)
        onNavigate(target)
        return
      }

      setTrackAnimating(true)
      setTrackOffset(-dir * w)
      navigationTimerRef.current = window.setTimeout(() => {
        navigationTimerRef.current = 0
        setTrackAnimating(false)
        setTrackOffset(0)
        onNavigate(target)
      }, CAROUSEL_ANIMATION_MS)
    },
    [animateBack, carouselWidth, clearNavigationTimer, clearWheelTimer, index, nodes, onNavigate],
  )

  useEffect(() => {
    if (!node) return
    clearNavigationTimer()
    clearWheelTimer()
    wheelRef.current.delta = 0
    gestureRef.current.pointerId = null
    setDragging(false)
    setTrackAnimating(false)
    setTrackOffset(0)
  }, [clearNavigationTimer, clearWheelTimer, node?.id])

  useEffect(() => {
    return () => {
      clearNavigationTimer()
      clearWheelTimer()
    }
  }, [clearNavigationTimer, clearWheelTimer])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!node || trackAnimating) return
      if (event.pointerType === "mouse" && event.button !== 0) return

      clearNavigationTimer()
      clearWheelTimer()
      wheelRef.current.delta = 0
      setTrackAnimating(false)

      const now = performance.now()
      gestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastTime: now,
        velocityX: 0,
        offset: 0,
        dragging: false,
        cancelled: false,
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Le navigateur peut refuser la capture si le geste est deja annule.
      }
    },
    [clearNavigationTimer, clearWheelTimer, node, trackAnimating],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current
      if (gesture.pointerId !== event.pointerId || gesture.cancelled) return

      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)

      if (!gesture.dragging) {
        if (absX < 6 && absY < 6) return
        if (absY > absX * 1.25 && absY > 12) {
          gesture.cancelled = true
          return
        }
        gesture.dragging = true
        setDragging(true)
      }

      const now = performance.now()
      const elapsed = Math.max(1, now - gesture.lastTime)
      gesture.velocityX = (event.clientX - gesture.lastX) / elapsed
      gesture.lastX = event.clientX
      gesture.lastTime = now
      gesture.offset = applyEdgeResistance(dx)

      setTrackOffset(gesture.offset)
      event.preventDefault()
    },
    [applyEdgeResistance],
  )

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current
      if (gesture.pointerId !== event.pointerId) return

      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Ignore les echecs de liberation de capture.
      }

      gesture.pointerId = null
      if (!gesture.dragging) return

      event.preventDefault()
      event.stopPropagation()
      suppressClickUntilRef.current = performance.now() + 350

      const projected = gesture.offset + gesture.velocityX * CAROUSEL_SWIPE_PROJECT_MS
      const threshold = swipeThreshold()
      if (projected <= -threshold && next) {
        goTo(1)
      } else if (projected >= threshold && prev) {
        goTo(-1)
      } else {
        animateBack()
      }
    },
    [animateBack, goTo, next, prev, swipeThreshold],
  )

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (trackAnimating) return

      const dominantDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0
      if (dominantDelta === 0) return

      event.preventDefault()
      clearNavigationTimer()
      clearWheelTimer()

      const wheel = wheelRef.current
      wheel.delta += dominantDelta
      const offset = applyEdgeResistance(-wheel.delta)
      setDragging(false)
      setTrackAnimating(false)
      setTrackOffset(offset)

      wheel.settleTimer = window.setTimeout(() => {
        wheel.settleTimer = 0
        const projectedOffset = -wheel.delta
        wheel.delta = 0
        const threshold = swipeThreshold()

        if (projectedOffset <= -threshold && next) {
          goTo(1)
        } else if (projectedOffset >= threshold && prev) {
          goTo(-1)
        } else {
          animateBack()
        }
      }, CAROUSEL_WHEEL_SETTLE_MS)
    },
    [animateBack, applyEdgeResistance, clearNavigationTimer, clearWheelTimer, goTo, next, prev, swipeThreshold, trackAnimating],
  )

  const handleCarouselClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (performance.now() < suppressClickUntilRef.current) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    setChromeVisible((visible) => !visible)
  }, [])

  const trackStyle: CSSProperties = {
    transform: `translate3d(calc(${-activeSlot * 100}% + ${trackOffset}px), 0, 0)`,
    transition: trackAnimating ? `transform ${CAROUSEL_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : "none",
  }

  useEffect(() => {
    if (!node) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") goTo(1)
      else if (event.key === "ArrowLeft") goTo(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [node, goTo])

  return (
    <Dialog open={!!node} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        animateContent={false}
        onPointerDownOutside={(event) => {
          const target = event.detail.originalEvent.target
          if (isDialogLayerTarget(target)) {
            event.preventDefault()
          }
        }}
        onInteractOutside={(event) => {
          const target = event.detail.originalEvent.target
          if (isDialogLayerTarget(target)) {
            event.preventDefault()
          }
        }}
        className="h-svh max-h-svh w-screen max-w-none gap-0 overflow-hidden rounded-none border-0 bg-transparent p-0 text-foreground shadow-none ring-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{node?.name ?? "Apercu"}</DialogTitle>
        {node && (
          <div
            ref={viewerSurfaceRef}
            className="relative size-full overflow-hidden bg-background"
          >
            <div
              ref={carouselRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onWheel={handleWheel}
              onClick={handleCarouselClick}
              className={cn(
                "relative size-full touch-none select-none overflow-hidden [overflow-anchor:none]",
                dragging ? "cursor-grabbing" : "cursor-grab",
              )}
            >
              <div className="flex size-full will-change-transform" style={trackStyle}>
                {slots.map((slotNode) => {
                  const slotImage = slotNode.mime_type?.startsWith("image/")
                  const slotVideo = slotNode.mime_type?.startsWith("video/")
                  return (
                    <div key={slotNode.id} className="h-full w-full shrink-0 overflow-hidden">
                      {slotImage ? (
                        <CarouselImageSlide
                          thumbnailSrc={slotNode.preview_url}
                          fullSrc={mediaInlineUrl(slotNode)}
                          alt={slotNode.name}
                        />
                      ) : slotVideo ? (
                        slotNode.id === node.id ? (
                          <ModernVideoPlayer
                            node={slotNode}
                            src={mediaInlineUrl(slotNode)}
                            chromeVisible={chromeVisible}
                            fullscreenTargetRef={viewerSurfaceRef}
                            actions={{
                              onDownload,
                              onShare,
                              onDelete,
                              onClose: () => onOpenChange(false),
                            }}
                          />
                        ) : (
                          <MediaPreviewSlide node={slotNode} fullSrc={mediaInlineUrl(slotNode)} />
                        )
                      ) : slotNode.id === node.id ? (
                        <div className="grid size-full place-items-center">
                          <FileIcon className="size-16 text-muted-foreground" />
                        </div>
                      ) : (
                        <MediaPreviewSlide node={slotNode} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {prev && (
              <button
                type="button"
                onClick={() => goTo(-1)}
                className={cn(
                  "absolute top-1/2 left-3 z-30 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-foreground/55 text-background transition-opacity hover:bg-foreground/75 sm:grid",
                  chromeVisible ? "opacity-100" : "opacity-0",
                )}
              >
                <ChevronLeft />
                <span className="sr-only">Precedent</span>
              </button>
            )}
            {next && (
              <button
                type="button"
                onClick={() => goTo(1)}
                className={cn(
                  "absolute top-1/2 right-3 z-30 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-foreground/55 text-background transition-opacity hover:bg-foreground/75 sm:grid",
                  chromeVisible ? "opacity-100" : "opacity-0",
                )}
              >
                <ChevronRight />
                <span className="sr-only">Suivant</span>
              </button>
            )}

            <AnimatePresence initial={false}>
              {chromeVisible && !activeIsVideo && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  transition={{ duration: 0.18 }}
                  className="absolute inset-x-0 bottom-0 z-40 flex justify-center px-3 pt-8 pb-[calc(0.9rem+env(safe-area-inset-bottom))] sm:px-6"
                >
                  <div className="pointer-events-none absolute inset-x-0 -top-10 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent" />
                  <div className="relative flex w-full max-w-2xl items-center gap-2 rounded-[1.75rem] bg-foreground p-2 text-background shadow-lg">
                    <Button
                      size="icon"
                      className="size-11 shrink-0 bg-accent text-accent-foreground hover:bg-accent/80"
                      onClick={() => onDownload?.(node)}
                    >
                      <Download />
                      <span className="sr-only">Telecharger</span>
                    </Button>
                    <Button
                      className="h-11 flex-1 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      onClick={() => onShare?.(node)}
                    >
                      <Share2 />
                      Partager
                    </Button>
                    <Button
                      className="h-11 flex-1 bg-destructive text-white hover:bg-destructive/90"
                      onClick={() => onDelete?.(node)}
                    >
                      <Trash2 />
                      Supprimer
                    </Button>
                    <Button
                      size="icon"
                      className="size-11 shrink-0 bg-muted text-foreground hover:bg-muted/70"
                      onClick={() => onOpenChange(false)}
                    >
                      <X />
                      <span className="sr-only">Fermer</span>
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function BlurredPreviewLayer({
  node,
  visible,
  onAspectRatio,
}: {
  node: NodeDto
  visible: boolean
  onAspectRatio?: (aspectRatio: number) => void
}) {
  if (!node.preview_url) return null

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden bg-muted",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <img
        src={node.preview_url}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 size-full scale-110 object-cover blur-2xl brightness-75 saturate-125"
      />
      <img
        src={node.preview_url}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 size-full object-contain"
        onLoad={(event) => {
          const ratio = imageAspectRatio(event.currentTarget)
          if (ratio) onAspectRatio?.(ratio)
        }}
      />
      <div className="absolute inset-0 bg-background/30" />
    </div>
  )
}

function ModernVideoPlayer({
  node,
  src,
  chromeVisible,
  fullscreenTargetRef,
  actions,
}: {
  node: NodeDto
  src: string
  chromeVisible: boolean
  fullscreenTargetRef?: FullscreenTargetRef
  actions?: MediaActionHandlers
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [mediaReady, setMediaReady] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 })
  const [previewAspectRatio, setPreviewAspectRatio] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const viewport = useViewportSize()

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0
  const videoAspectRatio = videoSize.width > 0 && videoSize.height > 0 ? videoSize.width / videoSize.height : previewAspectRatio
  const frameStyle = containedMediaFrameStyle(videoAspectRatio, viewport)
  const showActionRow = !!actions && !fullscreen

  useEffect(() => {
    setPlaying(false)
    setWaiting(true)
    setMediaReady(false)
    setDuration(0)
    setCurrentTime(0)
    setBuffered(0)
    setVideoSize({ width: 0, height: 0 })
    setPreviewAspectRatio(null)
  }, [src])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }

  function updateBuffered() {
    const video = videoRef.current
    if (!video || !video.buffered.length) return
    setBuffered(video.buffered.end(video.buffered.length - 1))
  }

  function seek(value: number) {
    const video = videoRef.current
    if (!video) return
    video.currentTime = value
    setCurrentTime(value)
  }

  useEffect(() => {
    const onChange = () => {
      const fullscreenTarget = fullscreenTargetRef?.current ?? containerRef.current
      setFullscreen(document.fullscreenElement === fullscreenTarget)
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [fullscreenTargetRef])

  async function toggleFullscreen() {
    const fullscreenTarget = fullscreenTargetRef?.current ?? containerRef.current
    if (!fullscreenTarget) return
    // L'API de verrouillage d'orientation n'est pas typee partout : acces souple.
    const orientation = screen.orientation as
      | (ScreenOrientation & { lock?: (orientation: string) => Promise<void>; unlock?: () => void })
      | undefined
    if (document.fullscreenElement) {
      try {
        orientation?.unlock?.()
      } catch {
        // l'orientation ne peut pas toujours etre deverrouillee
      }
      await document.exitFullscreen().catch(() => undefined)
      return
    }
    await fullscreenTarget.requestFullscreen?.().catch(() => undefined)
    // Pour une video horizontale on tente de basculer l'ecran en paysage (mobile).
    if (videoSize.width > videoSize.height) {
      try {
        await orientation?.lock?.("landscape")?.catch(() => undefined)
      } catch {
        // verrouillage d'orientation non supporte
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative grid size-full place-items-center overflow-hidden bg-background"
    >
      <div
        className="relative grid place-items-center overflow-hidden"
        style={frameStyle ?? fallbackMediaFrameStyle()}
      >
        <BlurredPreviewLayer node={node} visible={!mediaReady} onAspectRatio={setPreviewAspectRatio} />
        <video
          ref={videoRef}
          src={src}
          className={cn(
            "relative z-10 size-full object-contain",
            mediaReady ? "opacity-100" : "opacity-0",
          )}
          autoPlay
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration || 0)
            setVideoSize({
              width: event.currentTarget.videoWidth,
              height: event.currentTarget.videoHeight,
            })
            updateBuffered()
          }}
          onLoadedData={() => setMediaReady(true)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onProgress={updateBuffered}
          onWaiting={() => setWaiting(true)}
          onCanPlay={() => {
            setWaiting(false)
            setMediaReady(true)
          }}
          onPlay={() => {
            setPlaying(true)
            setWaiting(false)
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      </div>

      {waiting && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center text-background">
          <span className="grid size-14 place-items-center rounded-full bg-foreground/60">
            <Loader2 className="size-7 animate-spin" />
          </span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {chromeVisible && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
              "absolute inset-x-0 z-40 flex touch-none justify-center px-3 sm:px-6",
              showActionRow ? "bottom-0 pb-[calc(0.9rem+env(safe-area-inset-bottom))]" : "bottom-0 pb-[calc(0.35rem+env(safe-area-inset-bottom))]",
            )}
          >
            <div className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent" />
            <div
              className={cn(
                "relative w-full max-w-2xl bg-foreground text-background shadow-lg",
                showActionRow ? "grid gap-2 rounded-[1.75rem] p-2" : "flex max-w-5xl items-center gap-3 rounded-full px-2.5 py-2",
              )}
            >
              <div className={cn("flex w-full items-center gap-3", showActionRow && "px-0.5")}>
                <button
                  type="button"
                  onClick={togglePlay}
                  className="grid size-10 shrink-0 place-items-center rounded-full text-background transition-colors hover:bg-background/20"
                >
                  {playing ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
                  <span className="sr-only">{playing ? "Pause" : "Lecture"}</span>
                </button>
                <div className="relative h-5 flex-1">
                  <div className="absolute top-1/2 right-0 left-0 h-1.5 -translate-y-1/2 rounded-full bg-background/25">
                    <div className="h-full rounded-full bg-background/45" style={{ width: `${bufferedProgress}%` }} />
                    <div className="absolute top-0 left-0 h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                  </div>
                  <input
                    aria-label="Progression video"
                    className="video-range absolute inset-0"
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.05}
                    value={Math.min(currentTime, duration || currentTime)}
                    onChange={(event) => seek(Number(event.target.value))}
                  />
                </div>
                <span className="shrink-0 text-xs font-medium tabular-nums text-background/85">
                  {formatDuration(currentTime)} / {formatDuration(duration)}
                </span>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-background transition-colors hover:bg-background/20"
                >
                  {fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
                  <span className="sr-only">Plein ecran</span>
                </button>
              </div>
              {showActionRow && (
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    className="size-11 shrink-0 bg-accent text-accent-foreground hover:bg-accent/80"
                    onClick={() => actions.onDownload?.(node)}
                  >
                    <Download />
                    <span className="sr-only">Telecharger</span>
                  </Button>
                  <Button
                    className="h-11 flex-1 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    onClick={() => actions.onShare?.(node)}
                  >
                    <Share2 />
                    Partager
                  </Button>
                  <Button
                    className="h-11 flex-1 bg-destructive text-white hover:bg-destructive/90"
                    onClick={() => actions.onDelete?.(node)}
                  >
                    <Trash2 />
                    Supprimer
                  </Button>
                  <Button
                    size="icon"
                    className="size-11 shrink-0 bg-muted text-foreground hover:bg-muted/70"
                    onClick={actions.onClose}
                  >
                    <X />
                    <span className="sr-only">Fermer</span>
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DetailsDialog({
  node,
  showPath = false,
  onOpenChange,
  onDownload,
  onShare,
  onRename,
  onDelete,
  onOpenParent,
}: {
  node: NodeDto | null
  showPath?: boolean
  onOpenChange: (open: boolean) => void
  onDownload: (node: NodeDto) => void
  onShare: (node: NodeDto) => void
  onRename: (node: NodeDto) => void
  onDelete: (node: NodeDto) => void
  onOpenParent?: (node: NodeDto) => void
}) {
  const isFolder = node?.kind === "folder"
  const isVideo = node?.mime_type?.startsWith("video/")
  const isImage = node?.mime_type?.startsWith("image/")

  return (
    <Dialog open={!!node} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] w-[calc(100vw-1.5rem)] overflow-hidden p-0 sm:max-w-3xl">
        {node && (
          <div className="grid max-h-[92svh] overflow-y-auto">
            <div className="grid aspect-square max-h-[62svh] place-items-center bg-muted text-muted-foreground sm:aspect-video">
              {node.preview_url ? (
                <ProtectedPreview src={node.preview_url} fit="contain" />
              ) : isFolder ? (
                <Folder className="size-16 text-primary" />
              ) : isVideo ? (
                <Video className="size-16" />
              ) : isImage ? (
                <Image className="size-16" />
              ) : (
                <FileIcon className="size-16" />
              )}
            </div>

            <div className="grid gap-5 p-4 sm:p-5">
              <DialogHeader className="gap-2 text-left">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{fileTypeLabel(node)}</Badge>
                  {isVideo && <Badge variant="outline">Video</Badge>}
                  {isImage && <Badge variant="outline">Image</Badge>}
                </div>
                <DialogTitle className="break-words text-xl">{node.name}</DialogTitle>
                {showPath && (
                  <DialogDescription className="break-words">
                    {parentPathLabel(node.relative_path)}
                  </DialogDescription>
                )}
              </DialogHeader>

              <div className="grid gap-2 rounded-2xl border border-border bg-muted p-3 text-sm">
                <DetailRow label="Taille" value={isFolder ? "Dossier" : formatBytes(node.size_bytes ?? 0)} />
                <DetailRow label="Date fichier" value={formatShortDate(node.display_date_at)} />
                <DetailRow label="Ajoute" value={formatShortDate(node.created_at)} />
                <DetailRow label="Chemin" value={node.relative_path || "Racine"} />
              </div>

              <DialogFooter className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                {showPath && onOpenParent && (
                  <Button variant="outline" onClick={() => { onOpenChange(false); onOpenParent(node) }}>
                    <Folder />
                    Dossier
                  </Button>
                )}
                {!isFolder && (
                  <>
                    <Button variant="outline" onClick={() => onDownload(node)}>
                      <Download />
                      Telecharger
                    </Button>
                    <Button variant="outline" onClick={() => { onOpenChange(false); onShare(node) }}>
                      <Share2 />
                      Partager
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => { onOpenChange(false); onRename(node) }}>
                  <Pencil />
                  Renommer
                </Button>
                <Button variant="destructive" onClick={() => { onOpenChange(false); onDelete(node) }}>
                  <Trash2 />
                  Supprimer
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:items-start">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  )
}

function ShareDialog({
  node,
  request,
  onOpenChange,
}: {
  node: NodeDto | null
  request: <T>(path: string, init?: RequestInit) => Promise<T>
  onOpenChange: (open: boolean) => void
}) {
  const [shares, setShares] = useState<ShareDto[]>([])
  const [newLink, setNewLink] = useState("")
  const [copied, setCopied] = useState(false)
  const now = Math.floor(Date.now() / 1000)

  const load = useCallback(async () => {
    if (!node) return
    const payload = await request<{ shares: ShareDto[] }>(`/api/files/${node.id}/shares`)
    setShares(payload.shares)
  }, [node, request])

  useEffect(() => {
    if (!node) return
    setNewLink("")
    setCopied(false)
    void load().catch(() => toast.error("Chargement des liens impossible."))
  }, [load, node])

  async function create() {
    if (!node) return
    try {
      const payload = await request<CreateShareResponse>(`/api/files/${node.id}/shares`, { method: "POST" })
      const absolute = toAbsoluteUrl(payload.public_url)
      setShares((current) => [payload.share, ...current.filter((share) => share.id !== payload.share.id)])
      setNewLink(absolute)
      await navigator.clipboard?.writeText(absolute)
      setCopied(true)
      toast.success("Lien copie")
    } catch {
      toast.error("Creation du lien impossible.")
    }
  }

  async function revoke(id: string) {
    const previousShare = shares.find((share) => share.id === id) ?? null
    const revokedAt = Math.floor(Date.now() / 1000)
    setShares((current) =>
      current.map((share) => (share.id === id ? { ...share, revoked_at: share.revoked_at ?? revokedAt } : share)),
    )

    try {
      await request<void>(`/api/shares/${id}`, { method: "DELETE" })
      toast.success("Lien revoque")
    } catch {
      if (previousShare) {
        setShares((current) => current.map((share) => (share.id === id ? previousShare : share)))
      }
      toast.error("Revocation impossible.")
    }
  }

  return (
    <Dialog open={!!node} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="break-words">Partager « {node?.name} »</DialogTitle>
          <DialogDescription>Creer un lien public non listable pour ce fichier.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Button size="lg" className="h-11" onClick={create}>
            <Link />
            Creer un lien public
          </Button>
          {newLink && (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input readOnly className="h-11" value={newLink} />
              <Button
                variant="outline"
                size="icon"
                className="size-11"
                onClick={async () => {
                  await navigator.clipboard?.writeText(newLink)
                  setCopied(true)
                  toast.success("Lien copie")
                }}
              >
                {copied ? <Check /> : <Copy />}
                <span className="sr-only">Copier</span>
              </Button>
            </div>
          )}
          <Separator />
          <div className="grid gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Liens existants</p>
            {shares.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun lien actif pour le moment.</p>
            ) : (
              shares.map((share) => (
                <div key={share.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted p-3">
                  <div className="grid gap-1.5">
                    <Badge variant={share.revoked_at || share.expires_at <= now ? "secondary" : "default"}>
                      {share.revoked_at ? "Revoque" : share.expires_at <= now ? "Expire" : "Actif"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Expire le {formatDateTime(share.expires_at)}</span>
                    <span className="text-xs text-muted-foreground">{share.download_count} telechargement(s)</span>
                  </div>
                  {!share.revoked_at && share.expires_at > now && (
                    <Button variant="destructive" size="sm" onClick={() => void revoke(share.id)}>
                      Revoquer
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BatchShareDialog({
  files,
  request,
  onOpenChange,
}: {
  files: NodeDto[]
  request: <T>(path: string, init?: RequestInit) => Promise<T>
  onOpenChange: (open: boolean) => void
}) {
  const [links, setLinks] = useState<BatchShareLink[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (files.length === 0) return
    setLinks([])
    setCopied(false)
    setLoading(false)
  }, [files])

  async function copyLinks(nextLinks = links) {
    if (nextLinks.length === 0) return
    await navigator.clipboard?.writeText(nextLinks.map((link) => `${link.name}\n${link.url}`).join("\n\n"))
    setCopied(true)
    toast.success("Liens copies")
  }

  async function createLinks() {
    if (files.length === 0) return
    setLoading(true)
    setCopied(false)

    const nextLinks: BatchShareLink[] = []
    let errorCount = 0
    for (const file of files) {
      try {
        const payload = await request<CreateShareResponse>(`/api/files/${file.id}/shares`, { method: "POST" })
        nextLinks.push({
          fileId: file.id,
          name: file.name,
          url: toAbsoluteUrl(payload.public_url),
        })
      } catch {
        errorCount += 1
      }
    }

    setLinks(nextLinks)
    setLoading(false)
    if (nextLinks.length > 0) {
      await copyLinks(nextLinks)
    }
    if (errorCount > 0) {
      toast.error(`${errorCount} lien${errorCount > 1 ? "s" : ""} impossible${errorCount > 1 ? "s" : ""}`)
    }
  }

  return (
    <Dialog open={files.length > 0} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Partager les fichiers selectionnes</DialogTitle>
          <DialogDescription>
            {files.length} fichier{files.length > 1 ? "s" : ""} selectionne{files.length > 1 ? "s" : ""}. Les dossiers sont ignores.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Button size="lg" className="h-11" onClick={createLinks} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Link />}
            Creer les liens publics
          </Button>
          {links.length > 0 && (
            <>
              <Button variant="outline" className="h-11" onClick={() => void copyLinks()}>
                {copied ? <Check /> : <Copy />}
                Copier tous les liens
              </Button>
              <Separator />
              <div className="grid max-h-[45svh] gap-2 overflow-y-auto pr-1">
                {links.map((link) => (
                  <div key={link.fileId} className="grid gap-2 rounded-2xl border border-border bg-muted p-3">
                    <p className="line-clamp-2 break-all text-sm font-medium">{link.name}</p>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <Input readOnly className="h-10 min-w-0" value={link.url} />
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-10"
                        onClick={async () => {
                          await navigator.clipboard?.writeText(link.url)
                          toast.success("Lien copie")
                        }}
                      >
                        <Copy />
                        <span className="sr-only">Copier</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SharePage({ shareToken }: { shareToken: string }) {
  const [file, setFile] = useState<NodeDto | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch(`/api/public/shares/${shareToken}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response))
        return response.json() as Promise<{ file: NodeDto }>
      })
      .then((payload) => setFile(payload.file))
      .catch(() => setError("Lien invalide ou revoque."))
  }, [shareToken])

  return (
    <main className="grid min-h-svh place-items-center px-5 py-10">
      <div className="w-full max-w-md">
        <Brand className="mb-6 justify-center" />
        <Card>
          <CardHeader>
            <CardDescription>Partage public</CardDescription>
            {file && <CardTitle className="break-words text-2xl">{file.name}</CardTitle>}
          </CardHeader>
          <CardContent className="grid gap-5">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!file && !error && (
              <div className="grid justify-items-center gap-3 py-8 text-muted-foreground">
                <Loader2 className="size-7 animate-spin" />
                Chargement
              </div>
            )}
            {file && (
              <>
                <div className="grid aspect-video place-items-center overflow-hidden rounded-2xl border border-border bg-muted text-muted-foreground">
                  {file.preview_url ? (
                    <img src={file.preview_url} alt="" draggable={false} className="size-full object-cover" />
                  ) : (
                    <FileIcon className="size-10" />
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>{formatBytes(file.size_bytes ?? 0)}</span>
                  <span>{formatShortDate(file.display_date_at)}</span>
                  <Badge variant="secondary">{fileTypeLabel(file)}</Badge>
                </div>
              </>
            )}
          </CardContent>
          {file && (
            <CardFooter>
              <Button asChild className="h-11 w-full" size="lg">
                <a href={file.download_url ?? "#"} download>
                  <Download />
                  Telecharger
                </a>
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>
    </main>
  )
}

function showUploadToast(
  id: string,
  name: string,
  progress: number,
  label: string,
  state: "active" | "done" | "error" = "active",
) {
  toast.custom(
    () => (
      <UploadToastView
        name={name}
        progress={progress}
        label={label}
        state={state}
      />
    ),
    {
      id,
      duration: state === "active" ? Infinity : 3200,
      dismissible: true,
    },
  )
}

function UploadToastView({
  name,
  progress,
  label,
  state,
}: {
  name: string
  progress: number
  label: string
  state: "active" | "done" | "error"
}) {
  return (
    <div className="grid w-[min(92vw,360px)] max-w-[92vw] gap-2 overflow-hidden rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="line-clamp-2 max-w-full break-all text-sm font-medium leading-snug">{name}</p>
          <p className={cn("truncate text-xs text-muted-foreground", state === "error" && "text-destructive")}>{label}</p>
        </div>
        {state === "active" ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : state === "done" ? (
          <Check className="mt-0.5 size-4 shrink-0 text-primary" />
        ) : (
          <X className="mt-0.5 size-4 shrink-0 text-destructive" />
        )}
      </div>
      <Progress value={progress} className={cn(state === "error" && "[&_[data-slot=progress-indicator]]:bg-destructive")} />
    </div>
  )
}

function isAllowedMediaFile(file: File) {
  const type = file.type.toLowerCase()
  if (type.startsWith("image/") || type.startsWith("video/")) return true
  const extension = file.name.split(".").pop()?.toLowerCase()
  return !!extension && MEDIA_EXTENSIONS.has(extension)
}

function isPreviewCandidate(file: File) {
  const type = file.type.toLowerCase()
  if (type.startsWith("image/") || type.startsWith("video/")) return true
  const extension = file.name.split(".").pop()?.toLowerCase()
  return !!extension && MEDIA_EXTENSIONS.has(extension)
}

function isVideoFile(file: File) {
  const type = file.type.toLowerCase()
  return type.startsWith("video/") || videoExtension(file.name)
}

function shouldUseLightImport(files: File[]) {
  if (files.length > LIGHT_IMPORT_FILE_LIMIT) return true
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  if (totalBytes > LIGHT_IMPORT_BYTES_LIMIT) return true
  return isConstrainedMobileBrowser() && files.length > 8
}

function isConstrainedMobileBrowser() {
  return /Android|Mobile|Brave/i.test(navigator.userAgent)
}

function releaseBrowserMemory(delay = 20) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delay)
  })
}

function uploadDisplayName(file: File, strippedRoot = "") {
  const path = importedPathParts(file, strippedRoot).join("/")
  return path && path !== file.name ? path : file.name
}

function importFolderSegments(file: File, strippedRoot = "") {
  const parts = importedPathParts(file, strippedRoot)
  parts.pop()
  return parts.map((segment) => segment.trim()).filter(isSafeImportSegment)
}

function importedRelativePath(file: File) {
  return ((file as FileWithPath).webkitRelativePath || file.name).replaceAll("\\", "/")
}

function importedPathParts(file: File, strippedRoot = "") {
  const parts = importedRelativePath(file).split("/").filter(Boolean)
  if (strippedRoot && parts.length > 1 && parts[0] === strippedRoot) {
    return parts.slice(1)
  }
  return parts
}

function defaultImportFolderName(files: File[], suggestedFolderName?: string) {
  if (suggestedFolderName) {
    return sanitizeSuggestedFolderName(suggestedFolderName)
  }

  const commonRoot = commonImportedRoot(files)
  if (commonRoot) {
    return sanitizeSuggestedFolderName(commonRoot)
  }

  if (files.length === 1) {
    return sanitizeSuggestedFolderName(fileBaseName(files[0].name))
  }

  const now = new Date()
  return `Import ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function commonImportedRoot(files: File[]) {
  if (files.length === 0) return ""
  const roots = files
    .map((file) => {
      const parts = importedPathParts(file)
      return parts.length > 1 ? (parts[0] ?? "") : ""
    })
    .filter(Boolean)
  if (roots.length !== files.length) return ""
  const first = roots[0]
  return roots.every((root) => root === first) ? first : ""
}

function fileBaseName(name: string) {
  const dotIndex = name.lastIndexOf(".")
  return dotIndex > 0 ? name.slice(0, dotIndex) : name
}

function sanitizeSuggestedFolderName(name: string) {
  return name.replace(/[\\/\0]/g, "-").trim() || "Import"
}

function isSafeImportSegment(value: string) {
  return !!value && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\") && !value.includes("\0")
}

function supportsDirectoryInput() {
  const input = document.createElement("input")
  return "webkitdirectory" in input || "directory" in input
}

async function collectDirectoryFiles(directory: FileSystemDirectoryHandleLike, prefix = directory.name): Promise<File[]> {
  const files: File[] = []

  for await (const entry of directory.values()) {
    if (entry.kind === "file") {
      const file = await entry.getFile()
      files.push(withImportedRelativePath(file, `${prefix}/${file.name}`))
    } else if (entry.kind === "directory") {
      files.push(...(await collectDirectoryFiles(entry, `${prefix}/${entry.name}`)))
    }
  }

  return files
}

function withImportedRelativePath(file: File, relativePath: string) {
  try {
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: relativePath,
    })
    return file
  } catch {
    const copy = new File([file], file.name, {
      lastModified: file.lastModified,
      type: file.type,
    })
    Object.defineProperty(copy, "webkitRelativePath", {
      configurable: true,
      value: relativePath,
    })
    return copy
  }
}

async function ensureFolderPath(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
  rootId: string,
  segments: string[],
  cache: Map<string, string>,
  onFolderReady?: (folder: NodeDto) => void,
) {
  let parentId = rootId

  for (const segment of segments) {
    const cacheKey = `${parentId}\u0000${segment}`
    const cached = cache.get(cacheKey)
    if (cached) {
      parentId = cached
      continue
    }

    try {
      const created = await request<NodeDto>(`/api/folders/${parentId}/folders`, {
        method: "POST",
        body: JSON.stringify({ name: segment }),
      })
      onFolderReady?.(created)
      parentId = created.id
    } catch (error) {
      const payload = await request<FolderResponse>(`/api/folders/${parentId}?sort=name`)
      const existing = payload.children.find((node) => node.kind === "folder" && node.name === segment)
      if (!existing) throw error
      parentId = existing.id
    }

    cache.set(cacheKey, parentId)
  }

  return parentId
}

function uploadWindowBytes(file: File) {
  return Math.max(1, Number.isFinite(file.size) ? file.size : 1)
}

function runUploadsWithinByteWindow(
  fileCount: number,
  getBytes: (fileIndex: number) => number,
  runFile: (fileIndex: number) => Promise<void>,
) {
  return new Promise<void>((resolve) => {
    let activeBytes = 0
    let activeUploads = 0
    let nextIndex = 0
    let resolved = false

    const resolveIfDone = () => {
      if (resolved || activeUploads > 0 || nextIndex < fileCount) return
      resolved = true
      resolve()
    }

    const schedule = () => {
      while (nextIndex < fileCount) {
        const cost = Math.max(1, getBytes(nextIndex))
        if (activeUploads > 0 && activeBytes + cost > MAX_ACTIVE_UPLOAD_BYTES) break

        const fileIndex = nextIndex
        nextIndex += 1
        activeUploads += 1
        activeBytes += cost

        void runFile(fileIndex)
          .catch(() => undefined)
          .finally(() => {
            activeBytes = Math.max(0, activeBytes - cost)
            activeUploads -= 1
            schedule()
            resolveIfDone()
          })
      }

      resolveIfDone()
    }

    schedule()
  })
}

async function uploadFileWithConflictHandling({
  request,
  clientId,
  folderId,
  file,
  onProgress,
  getDuplicateDecision,
}: {
  request: <T>(path: string, init?: RequestInit) => Promise<T>
  clientId: string
  folderId: string
  file: File
  onProgress: (progress: number) => void
  getDuplicateDecision: (fileName: string) => Promise<DuplicateDecision>
}) {
  let uploadName = file.name

  for (;;) {
    try {
      return await uploadRawFile(clientId, folderId, file, onProgress, uploadName)
    } catch (err) {
      if (!isConflictError(err)) throw err

      const decision = await getDuplicateDecision(uploadName)
      if (decision.action === "skip") return null

      if (decision.action === "rename") {
        uploadName = await nextAvailableFileName(request, folderId, uploadName)
        continue
      }

      const existing = await findChildByName(request, folderId, uploadName)
      if (!existing) {
        throw new Error("Un fichier existe deja sur le disque.")
      }
      if (existing.kind !== "file") {
        throw new Error("Un dossier porte deja ce nom.")
      }

      return await replaceRawFile(clientId, existing.id, file, onProgress)
    }
  }
}

async function nextAvailableFileName(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
  folderId: string,
  name: string,
) {
  const payload = await request<FolderResponse>(`/api/folders/${folderId}?sort=name`)
  const usedNames = new Set(payload.children.map((node) => node.name))
  return incrementFileName(name, usedNames)
}

async function findChildByName(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
  folderId: string,
  name: string,
) {
  const payload = await request<FolderResponse>(`/api/folders/${folderId}?sort=name`)
  return payload.children.find((node) => node.name === name) ?? null
}

function incrementFileName(name: string, usedNames: Set<string>) {
  const dotIndex = name.lastIndexOf(".")
  const hasExtension = dotIndex > 0
  const base = hasExtension ? name.slice(0, dotIndex) : name
  const extension = hasExtension ? name.slice(dotIndex) : ""

  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${base}_${index}${extension}`
    if (!usedNames.has(candidate)) return candidate
  }

  return `${base}_${crypto.randomUUID()}${extension}`
}

class UploadHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function isConflictError(err: unknown) {
  return err instanceof UploadHttpError && err.status === 409
}

function uploadRawFile(
  clientId: string,
  folderId: string,
  file: File,
  onProgress: (progress: number) => void,
  uploadName = file.name,
) {
  return new Promise<NodeDto>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const params = new URLSearchParams({
      name: uploadName,
      file_date_at: String(Math.max(1, Math.floor(file.lastModified / 1000))),
    })
    xhr.open("POST", `/api/folders/${folderId}/files?${params}`)
    xhr.setRequestHeader("X-NAS-Client-ID", clientId)
    if (file.type) xhr.setRequestHeader("Content-Type", file.type)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onerror = () => reject(new Error("Upload interrompu."))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as NodeDto)
      } else {
        reject(new UploadHttpError(xhr.status, parseUploadError(xhr.responseText) || "Upload refuse."))
      }
    }
    xhr.send(file)
  })
}

function replaceRawFile(
  clientId: string,
  fileId: string,
  file: File,
  onProgress: (progress: number) => void,
) {
  return new Promise<NodeDto>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const params = new URLSearchParams({
      file_date_at: String(Math.max(1, Math.floor(file.lastModified / 1000))),
    })
    xhr.open("PUT", `/api/files/${fileId}?${params}`)
    xhr.setRequestHeader("X-NAS-Client-ID", clientId)
    if (file.type) xhr.setRequestHeader("Content-Type", file.type)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onerror = () => reject(new Error("Remplacement interrompu."))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as NodeDto)
      } else {
        reject(new UploadHttpError(xhr.status, parseUploadError(xhr.responseText) || "Remplacement refuse."))
      }
    }
    xhr.send(file)
  })
}

function parseUploadError(value: string) {
  try {
    const payload = JSON.parse(value) as { error?: string }
    return payload.error
  } catch {
    return value
  }
}

function createPreviewForUpload(file: File) {
  if (!isPreviewCandidate(file)) return Promise.resolve(null)
  return createThumbnail(file)
}

async function uploadPreparedPreview(
  clientId: string,
  fileId: string,
  previewPromise: Promise<Blob | null>,
  onPreviewed: (node: NodeDto) => void,
) {
  try {
    const preview = await previewPromise
    if (!preview) return

    onPreviewed(await uploadPreviewBlob(clientId, fileId, preview))
  } catch {
    // Preview generation/upload is intentionally silent.
  }
}

async function uploadPreviewBlob(clientId: string, fileId: string, preview: Blob) {
  const response = await fetch(`/api/files/${fileId}/preview`, {
    method: "PUT",
    headers: {
      "X-NAS-Client-ID": clientId,
      "Content-Type": preview.type,
    },
    body: preview,
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  return (await response.json()) as NodeDto
}

async function createThumbnail(file: File) {
  if (file.type.startsWith("video/") || videoExtension(file.name)) {
    return createVideoThumbnail(file)
  }

  if (!file.type.startsWith("image/") && !imageExtension(file.name)) {
    return null
  }

  let bitmap: ImageBitmap | null = null
  let canvas: HTMLCanvasElement | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    const maxSize = 360
    const ratio = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * ratio))
    const height = Math.max(1, Math.round(bitmap.height * ratio))
    canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) return null
    context.drawImage(bitmap, 0, 0, width, height)
    const outputCanvas = canvas

    return await canvasToPreviewBlob(outputCanvas, 0.75)
  } catch {
    return null
  } finally {
    bitmap?.close()
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
    }
  }
}

async function createVideoThumbnail(file: File) {
  const objectUrl = URL.createObjectURL(file)
  return createVideoThumbnailFromSource(objectUrl, () => URL.revokeObjectURL(objectUrl))
}

async function createVideoThumbnailFromSource(source: string, disposeSource?: () => void) {
  return new Promise<Blob | null>((resolve) => {
    const video = document.createElement("video")
    let settled = false
    let seekTimer = 0
    const timer = window.setTimeout(() => fail(), 8000)
    const cleanup = () => {
      window.clearTimeout(timer)
      window.clearTimeout(seekTimer)
      video.pause()
      video.removeAttribute("src")
      video.load()
      video.remove()
      disposeSource?.()
    }
    const fail = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(null)
    }
    const capture = () => {
      if (settled) return
      try {
        const width = video.videoWidth
        const height = video.videoHeight
        if (!width || !height) {
          fail()
          return
        }

        const maxSize = 480
        const ratio = Math.min(1, maxSize / Math.max(width, height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(width * ratio))
        canvas.height = Math.max(1, Math.round(height * ratio))
        const context = canvas.getContext("2d")
        if (!context) {
          fail()
          return
        }

        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        void canvasToPreviewBlob(canvas, 0.76).then((blob) => {
          if (settled) return
          settled = true
          canvas.width = 1
          canvas.height = 1
          cleanup()
          resolve(blob)
        })
      } catch {
        fail()
      }
    }
    const captureWhenReady = () => {
      if (video.readyState >= 2) {
        capture()
      }
    }

    video.preload = "auto"
    video.muted = true
    video.playsInline = true
    video.onerror = fail
    video.onloadeddata = captureWhenReady
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const target = duration > 0.25 ? Math.min(Math.max(duration * 0.08, 0.1), 1.5, duration - 0.05) : 0
      if (target > 0) {
        try {
          seekTimer = window.setTimeout(captureWhenReady, 1800)
          video.currentTime = target
        } catch {
          captureWhenReady()
        }
      } else {
        captureWhenReady()
      }
    }
    video.onseeked = () => {
      window.clearTimeout(seekTimer)
      captureWhenReady()
    }
    video.style.position = "fixed"
    video.style.left = "-9999px"
    video.style.top = "0"
    video.style.width = "1px"
    video.style.height = "1px"
    video.style.opacity = "0"
    video.style.pointerEvents = "none"
    video.src = source
    document.body.appendChild(video)
    video.load()
  })
}

async function canvasToPreviewBlob(canvas: HTMLCanvasElement, quality: number) {
  return (await canvasToBlob(canvas, "image/webp", quality)) ?? (await canvasToBlob(canvas, "image/jpeg", quality))
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

function imageExtension(name: string) {
  return ["avif", "gif", "heic", "heif", "jpeg", "jpg", "png", "webp"].includes(
    name.split(".").pop()?.toLowerCase() ?? "",
  )
}

function videoExtension(name: string) {
  return ["m4v", "mkv", "mov", "mp4", "webm"].includes(name.split(".").pop()?.toLowerCase() ?? "")
}

async function downloadProtectedFile(node: NodeDto) {
  if (!node.download_url) return

  const loadingId = toast.loading("Preparation du telechargement", { description: node.name })
  try {
    const response = await fetch(node.download_url)
    if (!response.ok) throw new Error(await readError(response))

    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = objectUrl
    link.download = node.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
    toast.success("Telechargement lance", { id: loadingId })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Telechargement impossible.", { id: loadingId })
  }
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string }
    return payload.error || response.statusText
  } catch {
    return response.statusText
  }
}

function groupNodesBySort(nodes: NodeDto[], sortMode: SortMode): NodeGroup[] {
  if (sortMode === "name") {
    return [{ id: "all", label: "Tous", nodes: sortNodesForMode(nodes, sortMode) }]
  }

  const years = new Map<string, NodeGroup>()
  const monthsByYear = new Map<string, Map<string, NodeGroup>>()
  const sortedNodes = sortNodesForMode(nodes, sortMode)

  for (const node of sortedNodes) {
    const yearId = yearKey(node.display_date_at)
    const year = years.get(yearId) ?? {
      id: yearId,
      label: yearLabel(node.display_date_at),
      nodes: [],
      children: [],
    }
    year.nodes.push(node)
    years.set(yearId, year)

    let monthGroups = monthsByYear.get(yearId)
    if (!monthGroups) {
      monthGroups = new Map<string, NodeGroup>()
      monthsByYear.set(yearId, monthGroups)
    }

    const monthId = monthKey(node.display_date_at)
    const month = monthGroups.get(monthId) ?? {
      id: monthId,
      label: monthLabel(node.display_date_at),
      nodes: [],
    }
    month.nodes.push(node)
    monthGroups.set(monthId, month)
    year.children = Array.from(monthGroups.values())
  }

  return Array.from(years.values())
}

/** Aplatit les groupes dans l'ordre exact d'affichage de la grille (annee > mois, ou "Tous"),
 * pour que la navigation du carrousel suive l'ordre visible et pas l'ordre brut des donnees. */
function flattenGroupNodes(groups: NodeGroup[]): NodeDto[] {
  const out: NodeDto[] = []
  for (const group of groups) {
    if (group.children) {
      for (const child of group.children) out.push(...child.nodes)
    } else {
      out.push(...group.nodes)
    }
  }
  return out
}

function upsertNode(nodes: NodeDto[], node: NodeDto) {
  const index = nodes.findIndex((candidate) => candidate.id === node.id)
  if (index === -1) return [...nodes, node]

  const next = [...nodes]
  next[index] = node
  return next
}

function removeNodeById(nodes: NodeDto[], id: string) {
  const next = nodes.filter((node) => node.id !== id)
  return next.length === nodes.length ? nodes : next
}

function removeNodesByIds(nodes: NodeDto[], ids: Set<string>) {
  const next = nodes.filter((node) => !ids.has(node.id))
  return next.length === nodes.length ? nodes : next
}

function restoreNodes(nodes: NodeDto[], nodesToRestore: NodeDto[], sortMode: SortMode) {
  if (nodesToRestore.length === 0) return nodes

  return sortNodesForMode(
    nodesToRestore.reduce((current, node) => upsertNode(current, node), nodes),
    sortMode,
  )
}

function isFileNode(node: NodeDto) {
  return node.kind === "file"
}

function replacementMediaNodeAfterDelete(mediaNodes: NodeDto[], deletedIds: Set<string>, currentId: string) {
  const index = mediaNodes.findIndex((node) => node.id === currentId)
  if (index < 0) return null

  for (let i = index + 1; i < mediaNodes.length; i += 1) {
    const candidate = mediaNodes[i]
    if (!deletedIds.has(candidate.id)) return candidate
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = mediaNodes[i]
    if (!deletedIds.has(candidate.id)) return candidate
  }
  return null
}

function reconcileNodeChildren(nodes: NodeDto[], node: NodeDto, parentId: string, sortMode: SortMode) {
  const alreadyVisible = nodes.some((candidate) => candidate.id === node.id)
  if (node.parent_id === parentId) {
    return sortNodesForMode(upsertNode(nodes, node), sortMode)
  }
  return alreadyVisible ? removeNodeById(nodes, node.id) : nodes
}

function reconcileSearchNodes(
  nodes: NodeDto[],
  node: NodeDto,
  query: string,
  scope: SearchScope,
  currentFolder: NodeDto | null,
  sortMode: SortMode,
) {
  const alreadyVisible = nodes.some((candidate) => candidate.id === node.id)
  if (nodeMatchesSearch(node, query) && nodeInSearchScope(node, scope, currentFolder)) {
    return sortNodesForMode(upsertNode(nodes, node), sortMode)
  }
  return alreadyVisible ? removeNodeById(nodes, node.id) : nodes
}

function reconcileAllFiles(nodes: NodeDto[], node: NodeDto, query: string) {
  const alreadyVisible = nodes.some((candidate) => candidate.id === node.id)
  if (node.kind === "file" && nodeMatchesSearch(node, query)) {
    return upsertNode(nodes, node)
  }
  return alreadyVisible ? removeNodeById(nodes, node.id) : nodes
}

function nodeMatchesSearch(node: NodeDto, query: string) {
  const search = query.trim().toLowerCase()
  if (!search) return true
  return node.name.toLowerCase().includes(search) || node.relative_path.toLowerCase().includes(search)
}

function nodeInSearchScope(node: NodeDto, scope: SearchScope, currentFolder: NodeDto | null) {
  if (scope === "all") return true
  if (!currentFolder) return false
  if (currentFolder.id === ROOT_ID || !currentFolder.relative_path) return true
  const prefix = `${currentFolder.relative_path}/`
  return node.relative_path === currentFolder.relative_path || node.relative_path.startsWith(prefix)
}

function sortNodesForMode(nodes: NodeDto[], sortMode: SortMode) {
  return [...nodes].sort((left, right) => {
    if (sortMode === "date") {
      const byDate = right.display_date_at - left.display_date_at
      if (byDate !== 0) return byDate
    } else {
      const byKind = kindOrder(left) - kindOrder(right)
      if (byKind !== 0) return byKind
    }

    return left.name.localeCompare(right.name, "fr", { sensitivity: "base" })
  })
}

function kindOrder(node: NodeDto) {
  return node.kind === "folder" ? 0 : 1
}

function monthKey(timestamp: number) {
  const date = new Date(timestamp * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function yearKey(timestamp: number) {
  return `year-${new Date(timestamp * 1000).getFullYear()}`
}

function yearLabel(timestamp: number) {
  return String(new Date(timestamp * 1000).getFullYear())
}

function monthLabel(timestamp: number) {
  return capitalizeFirstLetter(new Intl.DateTimeFormat("fr-FR", {
    month: "long",
  }).format(new Date(timestamp * 1000)))
}

function capitalizeFirstLetter(value: string) {
  return value ? value.charAt(0).toLocaleUpperCase("fr-FR") + value.slice(1) : value
}

function formatShortDate(timestamp: number) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp * 1000))
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000))
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00"
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainingSeconds = total % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`
}

function fileTypeLabel(node: NodeDto) {
  if (node.kind === "folder") return "Dossier"
  if (!node.mime_type) return "Fichier"
  return node.mime_type.split("/").at(-1)?.toUpperCase() || "Fichier"
}

function parentPathLabel(relativePath: string) {
  const parts = relativePath.split("/").filter(Boolean)
  parts.pop()
  return parts.length > 0 ? parts.join(" / ") : "Racine"
}

function useViewportSize() {
  const [size, setSize] = useState(currentViewportSize)

  useEffect(() => {
    const update = () => setSize(currentViewportSize())
    window.addEventListener("resize", update)
    window.addEventListener("orientationchange", update)
    window.visualViewport?.addEventListener("resize", update)
    window.visualViewport?.addEventListener("scroll", update)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)
      window.visualViewport?.removeEventListener("resize", update)
      window.visualViewport?.removeEventListener("scroll", update)
    }
  }, [])

  return size
}

function currentViewportSize() {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  }
}

function containedMediaFrameStyle(
  aspectRatio: number | null,
  viewport: { width: number; height: number },
) {
  if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return undefined
  }

  let width = viewport.width
  let height = width / aspectRatio
  if (height > viewport.height) {
    height = viewport.height
    width = height * aspectRatio
  }

  return {
    width: `${Math.round(width)}px`,
    height: `${Math.round(height)}px`,
  }
}

function fallbackMediaFrameStyle() {
  return {
    width: "min(70vw, 70svh)",
    height: "min(70vw, 70svh)",
  }
}

function imageAspectRatio(image: HTMLImageElement) {
  const width = image.naturalWidth
  const height = image.naturalHeight
  return width > 0 && height > 0 ? width / height : null
}

function galleryGridStyle(gridSize: GridSize, gridColumns: number): GalleryGridStyle {
  const mobileColumns = GRID_SIZE_OPTIONS.find((option) => option.value === gridSize)?.columns ?? 3
  return {
    "--gallery-mobile-columns": mobileColumns,
    "--gallery-desktop-columns": clampGridColumns(gridColumns),
  }
}

function toAbsoluteUrl(value: string) {
  if (value.startsWith("http://") || value.startsWith("https://")) return value
  return `${window.location.origin}${value}`
}

function mediaInlineUrl(node: NodeDto) {
  return `/api/files/${node.id}/inline`
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster richColors closeButton position="top-center" />
    </TooltipProvider>
  </StrictMode>,
)
