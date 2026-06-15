import {
  StrictMode,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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
  RotateCw,
  Search,
  Share2,
  Trash2,
  Upload,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import { toast } from "sonner"

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
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import "./styles.css"

const ROOT_ID = "00000000-0000-0000-0000-000000000000"
const TOKEN_KEY = "nas.session.token"
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
  revoked_at: number | null
  download_count: number
}

type SortMode = "name" | "date"
type SearchScope = "current" | "all"
type GridSize = "small" | "medium" | "large"
type GalleryGridStyle = CSSProperties & {
  "--gallery-mobile-columns": number
  "--gallery-desktop-columns": number
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
type PreviewUploadJob = {
  source: "local-file"
  file: File
  fileId: string
  name: string
}
type PreviewUploadStats = {
  total: number
  done: number
  errors: number
}
type RemoteVideoPreviewStats = PreviewUploadStats
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
const LIGHT_IMPORT_BATCH_SIZE = 8
const MOBILE_UPLOAD_CONCURRENCY = 2
const DESKTOP_UPLOAD_CONCURRENCY = 4
const MIN_GRID_COLUMNS = 1
const MAX_GRID_COLUMNS = 12
const SELECTION_LONG_PRESS_MS = 420
const SELECTION_EXISTING_PRESS_MS = 180
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
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY))

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/share/:shareToken" element={<ShareRoute />} />
        <Route
          path="/"
          element={token ? <Navigate to={folderRoute(ROOT_ID, "date")} replace /> : <Login onLogin={setToken} />}
        />
        <Route
          path="/folder/:folderId"
          element={
            token ? (
              <FileManager
                token={token}
                onAuthExpired={() => {
                  sessionStorage.removeItem(TOKEN_KEY)
                  setToken(null)
                }}
              />
            ) : (
              <Login onLogin={setToken} />
            )
          }
        />
        <Route
          path="/files"
          element={
            token ? (
              <AllFilesView
                token={token}
                onAuthExpired={() => {
                  sessionStorage.removeItem(TOKEN_KEY)
                  setToken(null)
                }}
              />
            ) : (
              <Login onLogin={setToken} />
            )
          }
        />
        <Route path="*" element={<Navigate to={token ? folderRoute(ROOT_ID, "date") : "/"} replace />} />
      </Routes>
    </BrowserRouter>
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
      <HardDrive className="size-5 text-primary" />
      <span className="text-base font-semibold tracking-tight">NAS</span>
    </div>
  )
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
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

      const payload = (await response.json()) as { token: string }
      sessionStorage.setItem(TOKEN_KEY, payload.token)
      onLogin(payload.token)
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

function useAuthedRequest(token: string, onAuthExpired: () => void, clientId: string) {
  return useCallback(
    async <T,>(path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set("Authorization", `Bearer ${token}`)
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
    [clientId, onAuthExpired, token],
  )
}

function useRealtimeEvents(token: string, clientId: string, onEvent: (event: RealtimeEvent) => void) {
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
      const params = new URLSearchParams({ token, client_id: clientId })
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
  }, [clientId, token])
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

function useRemoteVideoPreviewQueue({
  token,
  clientId,
  onPreviewed,
  pausedRef,
}: {
  token: string
  clientId: string
  onPreviewed: (node: NodeDto) => void
  pausedRef?: { current: boolean }
}) {
  const queueRef = useRef<NodeDto[]>([])
  const queuedIdsRef = useRef<Set<string>>(new Set())
  const attemptedIdsRef = useRef<Set<string>>(new Set())
  const statsRef = useRef<RemoteVideoPreviewStats>({ total: 0, done: 0, errors: 0 })
  const runnerRef = useRef(false)
  const toastIdRef = useRef(`remote-preview:${crypto.randomUUID()}`)
  const onPreviewedRef = useRef(onPreviewed)
  const pausedStateRef = useRef(pausedRef)

  useEffect(() => {
    onPreviewedRef.current = onPreviewed
  }, [onPreviewed])

  useEffect(() => {
    pausedStateRef.current = pausedRef
  }, [pausedRef])

  const showQueueToast = useCallback((label: string, state: "active" | "done" | "error" = "active") => {
    const stats = statsRef.current
    const processed = stats.done + stats.errors
    const progress = stats.total > 0 ? Math.round((processed / stats.total) * 100) : 0
    showUploadToast(toastIdRef.current, `${stats.total} miniatures video`, progress, label, state)
  }, [])

  const runQueue = useCallback(async () => {
    if (runnerRef.current) return
    runnerRef.current = true

    try {
      while (queueRef.current.length > 0) {
        if (pausedStateRef.current?.current) {
          await releaseBrowserMemory(450)
          continue
        }

        const node = queueRef.current.shift()
        if (!node) continue

        const currentIndex = statsRef.current.done + statsRef.current.errors + 1
        showQueueToast(`Video ${currentIndex}/${statsRef.current.total}`)

        try {
          const previewed = await uploadStoredVideoPreview(token, clientId, node)
          if (previewed) {
            onPreviewedRef.current(previewed)
            statsRef.current = {
              ...statsRef.current,
              done: statsRef.current.done + 1,
            }
          } else {
            statsRef.current = {
              ...statsRef.current,
              errors: statsRef.current.errors + 1,
            }
          }
        } catch {
          statsRef.current = {
            ...statsRef.current,
            errors: statsRef.current.errors + 1,
          }
        } finally {
          queuedIdsRef.current.delete(node.id)
          await releaseBrowserMemory(260)
        }
      }
    } finally {
      runnerRef.current = false
    }

    if (queueRef.current.length === 0 && statsRef.current.total > 0) {
      const stats = statsRef.current
      showQueueToast(
        stats.errors > 0 ? `${stats.done} creees, ${stats.errors} erreurs` : "Termine",
        stats.errors > 0 ? "error" : "done",
      )
      statsRef.current = { total: 0, done: 0, errors: 0 }
      toastIdRef.current = `remote-preview:${crypto.randomUUID()}`
    }
  }, [clientId, showQueueToast, token])

  return useCallback(
    (node: NodeDto) => {
      if (!shouldGenerateStoredVideoPreview(node)) return
      if (attemptedIdsRef.current.has(node.id) || queuedIdsRef.current.has(node.id)) return

      attemptedIdsRef.current.add(node.id)
      queuedIdsRef.current.add(node.id)
      queueRef.current.push(node)
      statsRef.current = {
        ...statsRef.current,
        total: statsRef.current.total + 1,
      }
      showQueueToast("En attente")
      void runQueue()
    },
    [runQueue, showQueueToast],
  )
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

function useNodeSelection(nodes: NodeDto[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
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

  const handlePointerDown = useCallback(
    (node: NodeDto, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.defaultPrevented) return
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
    clearSelection,
    selectAll,
    handlePointerDown,
    handleClick,
  }
}

function FileManager({ token, onAuthExpired }: { token: string; onAuthExpired: () => void }) {
  const { folderId: routeFolderId = ROOT_ID } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const sortMode = parseSortMode(searchParams.get("sort"))
  const query = searchParams.get("q") ?? ""
  const searchScope = parseSearchScope(searchParams.get("scope"))
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
  const request = useAuthedRequest(token, onAuthExpired, clientId)
  const [gridSize, setGridSize] = useGridSize()
  const [gridColumns, setGridColumns] = useGridColumns()
  const uploadActiveRef = useRef(false)
  const previewQueueRef = useRef<PreviewUploadJob[]>([])
  const previewStatsRef = useRef<PreviewUploadStats>({ total: 0, done: 0, errors: 0 })
  const previewRunnerRef = useRef(false)
  const previewToastIdRef = useRef(`preview:${crypto.randomUUID()}`)
  const duplicatePromptQueueRef = useRef<Promise<void>>(Promise.resolve())

  const fetchFolder = useCallback(
    async (id: string, nextSortMode: SortMode) => {
      setLoading(true)
      try {
        setData(await request<FolderResponse>(`/api/folders/${id}?sort=${nextSortMode}`))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Chargement impossible.")
      } finally {
        setLoading(false)
      }
    },
    [request],
  )

  useEffect(() => {
    void fetchFolder(routeFolderId, sortMode)
  }, [fetchFolder, routeFolderId, sortMode])

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

  function openViewer(node: NodeDto) {
    const params = new URLSearchParams(searchParams)
    params.set(VIEW_PARAM, node.id)
    setViewerNode(node)
    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params}` : "",
    })
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

    try {
      const renamed = await request<NodeDto>(`/api/nodes/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      })
      setRenameTarget(null)
      setDetailsNode((current) => (current?.id === renamed.id ? renamed : current))
      setViewerNode((current) => (current?.id === renamed.id ? renamed : current))
      toast.success("Element renomme")
      await fetchFolder(routeFolderId, sortMode)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Renommage impossible.")
    }
  }

  async function submitDelete() {
    const target = deleteTarget
    if (!target) return

    try {
      await request<void>(`/api/nodes/${target.id}`, { method: "DELETE" })
      setDeleteTarget(null)
      setDetailsNode((current) => (current?.id === target.id ? null : current))
      setViewerNode((current) => (current?.id === target.id ? null : current))
      toast.success(target.kind === "folder" ? "Dossier supprime" : "Fichier supprime")
      await fetchFolder(routeFolderId, sortMode)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suppression impossible.")
    }
  }

  async function submitBatchDelete() {
    const targets = batchDeleteNodes
    if (targets.length === 0) return

    const targetIds = new Set(targets.map((node) => node.id))
    let deletedCount = 0
    let errorCount = 0

    for (const target of targets) {
      try {
        await request<void>(`/api/nodes/${target.id}`, { method: "DELETE" })
        deletedCount += 1
      } catch {
        errorCount += 1
      }
    }

    setBatchDeleteNodes([])
    selection.clearSelection()
    setDetailsNode((current) => (current && targetIds.has(current.id) ? null : current))
    setViewerNode((current) => (current && targetIds.has(current.id) ? null : current))
    setData((current) => current ? { ...current, children: removeNodesByIds(current.children, targetIds) } : current)
    setSearchResults((current) => removeNodesByIds(current, targetIds))

    if (deletedCount > 0) {
      toast.success(`${deletedCount} element${deletedCount > 1 ? "s" : ""} supprime${deletedCount > 1 ? "s" : ""}`)
    }
    if (errorCount > 0) {
      toast.error(`${errorCount} suppression${errorCount > 1 ? "s" : ""} impossible${errorCount > 1 ? "s" : ""}`)
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

  function showPreviewQueueToast(label: string, state: "active" | "done" | "error" = "active") {
    const stats = previewStatsRef.current
    const processed = stats.done + stats.errors
    const progress = stats.total > 0 ? Math.round((processed / stats.total) * 100) : 0
    showUploadToast(previewToastIdRef.current, `${stats.total} miniatures`, progress, label, state)
  }

  function enqueuePreviewUpload(file: File, node: NodeDto, lightImport: boolean) {
    if (isVideoFile(file)) return
    if (!shouldQueueClientPreview(file, lightImport)) return

    previewQueueRef.current.push({ source: "local-file", file, fileId: node.id, name: node.name })
    previewStatsRef.current = {
      ...previewStatsRef.current,
      total: previewStatsRef.current.total + 1,
    }
    showPreviewQueueToast("En attente")
    void runPreviewQueue()
  }

  async function runPreviewQueue() {
    if (previewRunnerRef.current) return
    previewRunnerRef.current = true

    try {
      while (previewQueueRef.current.length > 0) {
        if (uploadActiveRef.current) {
          await releaseBrowserMemory(350)
          continue
        }

        const job = previewQueueRef.current.shift()
        if (!job) continue

        const currentIndex = previewStatsRef.current.done + previewStatsRef.current.errors + 1
        showPreviewQueueToast(`Miniature ${currentIndex}/${previewStatsRef.current.total}`)

        try {
          const previewed = await uploadClientPreview(token, clientId, job.fileId, job.file)
          if (previewed) {
            upsertClientNode(previewed)
          }
          previewStatsRef.current = {
            ...previewStatsRef.current,
            done: previewStatsRef.current.done + 1,
          }
        } catch {
          previewStatsRef.current = {
            ...previewStatsRef.current,
            errors: previewStatsRef.current.errors + 1,
          }
        } finally {
          await releaseBrowserMemory(220)
        }
      }
    } finally {
      previewRunnerRef.current = false
    }

    if (previewQueueRef.current.length === 0 && !uploadActiveRef.current && previewStatsRef.current.total > 0) {
      const stats = previewStatsRef.current
      showPreviewQueueToast(
        stats.errors > 0 ? `${stats.done} creees, ${stats.errors} erreurs` : "Termine",
        stats.errors > 0 ? "error" : "done",
      )
      previewStatsRef.current = { total: 0, done: 0, errors: 0 }
      previewToastIdRef.current = `preview:${crypto.randomUUID()}`
    }
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
        description: "Import par lots sans miniatures locales pour limiter la memoire de Brave.",
      })
      showUploadToast(batchToastId, `${mediaFiles.length} medias`, 0, "Preparation")
    }

    const uploadConcurrency = uploadConcurrencyFor(mediaFiles, lightImport)
    if (mediaFiles.length > 1 && uploadConcurrency > 1) {
      toast.info("Uploads paralleles", {
        description: `${uploadConcurrency} fichiers envoyes en meme temps.`,
      })
    }

    uploadActiveRef.current = true
    try {
      const folderCache = new Map<string, string>()
      const progressByIndex = new Array<number>(mediaFiles.length).fill(0)
      const batchSize = lightImport ? LIGHT_IMPORT_BATCH_SIZE : mediaFiles.length
      const totalBatches = Math.max(1, Math.ceil(mediaFiles.length / batchSize))

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
          const uploaded = await uploadFileWithConflictHandling({
            request,
            token,
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
          if (isVideoFile(file)) {
            queueVideoPreview(uploaded)
          } else {
            enqueuePreviewUpload(file, uploaded, lightImport)
          }
          successCount += 1
          updateToast(100, "Termine", "done")
        } catch (err) {
          errorCount += 1
          updateToast(100, err instanceof Error ? err.message : "Upload impossible", "error")
        } finally {
          await releaseBrowserMemory()
        }
      }

      for (let batchStart = 0; batchStart < mediaFiles.length; batchStart += batchSize) {
        const batchNumber = Math.floor(batchStart / batchSize) + 1
        const batchEnd = Math.min(batchStart + batchSize, mediaFiles.length)
        if (lightImport && batchToastId) {
          showUploadToast(
            batchToastId,
            `${mediaFiles.length} medias`,
            Math.round((batchStart / mediaFiles.length) * 100),
            `Lot ${batchNumber}/${totalBatches}`,
          )
        }

        const batchIndexes = Array.from({ length: batchEnd - batchStart }, (_, index) => batchStart + index)
        let nextBatchIndex = 0
        const workerCount = Math.min(uploadConcurrency, batchIndexes.length)
        await Promise.all(
          Array.from({ length: workerCount }, async () => {
            for (;;) {
              const fileIndex = batchIndexes[nextBatchIndex]
              nextBatchIndex += 1
              if (fileIndex === undefined) return
              await uploadFileAtIndex(fileIndex)
            }
          }),
        )

        if (lightImport) {
          await releaseBrowserMemory(250)
        }
      }

      if (lightImport && batchToastId) {
        const label = errorCount > 0 ? `${successCount} importes, ${errorCount} erreurs` : "Termine"
        showUploadToast(batchToastId, `${mediaFiles.length} medias`, 100, label, errorCount > 0 ? "error" : "done")
      }
    } finally {
      uploadActiveRef.current = false
      void runPreviewQueue()
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

  const queueVideoPreview = useRemoteVideoPreviewQueue({
    token,
    clientId,
    onPreviewed: upsertClientNode,
  })
  const visibleNodes = searchActive ? searchResults : (data?.children ?? [])
  const groups = useMemo(() => groupNodesBySort(visibleNodes, sortMode), [visibleNodes, sortMode])
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
    [clientId, data?.folder, query, searchScope, sortMode],
  )

  useRealtimeEvents(token, clientId, handleRealtimeEvent)

  return (
    <div className="min-h-svh" onContextMenu={preventAppContextMenu}>
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-[env(safe-area-inset-top)] sm:pb-12 sm:pt-6">
        <SearchControls
          value={searchValue}
          onValueChange={setSearchValue}
          scope={searchScope}
          onScopeChange={changeSearchScope}
          currentLabel={data?.folder.name || "Racine"}
          loading={searchLoading}
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

        <div className="hidden sm:mb-4 sm:flex sm:w-auto sm:gap-2">
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

        {data && data.breadcrumbs.length > 1 && (
          <Breadcrumbs items={data.breadcrumbs} onNavigate={openFolder} />
        )}

        <DropZone onFiles={importSelectedFiles}>
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
                token={token}
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
              token={token}
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
        token={token}
        node={detailsNode}
        showPath={searchActive}
        onOpenChange={(open) => !open && setDetailsNode(null)}
        onDownload={(node) => void downloadProtectedFile(token, node)}
        onShare={(node) => setShareNode(node)}
        onRename={openRename}
        onDelete={setDeleteTarget}
        onOpenParent={(node) => openFolder(node.parent_id ?? ROOT_ID)}
      />
      <MediaViewer
        token={token}
        node={viewerNode}
        onOpenChange={(open) => !open && closeViewer()}
      />
      <ShareDialog
        token={token}
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
  )
}

function AllFilesView({ token, onAuthExpired }: { token: string; onAuthExpired: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const sortMode = parseSortMode(searchParams.get("sort"))
  const query = searchParams.get("q") ?? ""
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
  const request = useAuthedRequest(token, onAuthExpired, clientId)
  const [gridSize, setGridSize] = useGridSize()
  const [gridColumns, setGridColumns] = useGridColumns()

  const fetchFiles = useCallback(
    async (nextSortMode: SortMode, nextQuery: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ sort: nextSortMode })
        if (nextQuery.trim()) {
          params.set("q", nextQuery.trim())
        }
        const payload = await request<FilesResponse>(`/api/files?${params}`)
        setFiles(payload.files)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Recherche impossible.")
      } finally {
        setLoading(false)
      }
    },
    [request],
  )

  useEffect(() => {
    setSearchValue(query)
  }, [query])

  useEffect(() => {
    void fetchFiles(sortMode, query)
  }, [fetchFiles, query, sortMode])

  useEffect(() => {
    if (searchValue === query) return
    const timer = window.setTimeout(() => {
      navigate(allFilesRoute(sortMode, searchValue), { replace: true })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [navigate, query, searchValue, sortMode])

  function openViewer(node: NodeDto) {
    const params = new URLSearchParams(searchParams)
    params.set(VIEW_PARAM, node.id)
    setViewerNode(node)
    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params}` : "",
    })
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

  async function submitRename(event: FormEvent) {
    event.preventDefault()
    const target = renameTarget
    const name = renameValue.trim()
    if (!target || !name || name === target.name) {
      setRenameTarget(null)
      return
    }

    try {
      const renamed = await request<NodeDto>(`/api/nodes/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      })
      setRenameTarget(null)
      setDetailsNode((current) => (current?.id === renamed.id ? renamed : current))
      setViewerNode((current) => (current?.id === renamed.id ? renamed : current))
      toast.success("Fichier renomme")
      await fetchFiles(sortMode, query)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Renommage impossible.")
    }
  }

  async function submitDelete() {
    const target = deleteTarget
    if (!target) return

    try {
      await request<void>(`/api/nodes/${target.id}`, { method: "DELETE" })
      setDeleteTarget(null)
      setDetailsNode((current) => (current?.id === target.id ? null : current))
      setViewerNode((current) => (current?.id === target.id ? null : current))
      toast.success("Fichier supprime")
      await fetchFiles(sortMode, query)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suppression impossible.")
    }
  }

  async function submitBatchDelete() {
    const targets = batchDeleteNodes
    if (targets.length === 0) return

    const targetIds = new Set(targets.map((node) => node.id))
    let deletedCount = 0
    let errorCount = 0

    for (const target of targets) {
      try {
        await request<void>(`/api/nodes/${target.id}`, { method: "DELETE" })
        deletedCount += 1
      } catch {
        errorCount += 1
      }
    }

    setBatchDeleteNodes([])
    selection.clearSelection()
    setDetailsNode((current) => (current && targetIds.has(current.id) ? null : current))
    setViewerNode((current) => (current && targetIds.has(current.id) ? null : current))
    setFiles((current) => removeNodesByIds(current, targetIds))

    if (deletedCount > 0) {
      toast.success(`${deletedCount} fichier${deletedCount > 1 ? "s" : ""} supprime${deletedCount > 1 ? "s" : ""}`)
    }
    if (errorCount > 0) {
      toast.error(`${errorCount} suppression${errorCount > 1 ? "s" : ""} impossible${errorCount > 1 ? "s" : ""}`)
    }
  }

  const groups = useMemo(() => groupNodesBySort(files, sortMode), [files, sortMode])
  const selection = useNodeSelection(files)
  const selectedFiles = useMemo(() => selection.selectedNodes.filter(isFileNode), [selection.selectedNodes])

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
        setFiles((current) => reconcileAllFiles(current, node, query))
        setDetailsNode((current) => (current?.id === node.id ? node : current))
        setViewerNode((current) => (current?.id === node.id && node.kind === "file" ? node : current))
        return
      }

      setFiles((current) => removeNodeById(current, event.id))
      setDetailsNode((current) => (current?.id === event.id ? null : current))
      setViewerNode((current) => (current?.id === event.id ? null : current))
    },
    [clientId, query],
  )

  useRealtimeEvents(token, clientId, handleRealtimeEvent)

  return (
    <div className="min-h-svh" onContextMenu={preventAppContextMenu}>
      <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-[env(safe-area-inset-top)] sm:pt-6">
        <SearchControls
          value={searchValue}
          onValueChange={setSearchValue}
          scope="all"
          onScopeChange={(nextScope) => {
            if (nextScope === "current") {
              navigate(folderRoute(ROOT_ID, sortMode, query, "current"))
            }
          }}
          currentLabel="Racine"
          loading={loading}
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

        {loading ? (
          <LoadingGrid gridSize={gridSize} gridColumns={gridColumns} />
        ) : files.length > 0 ? (
          <GroupedNodeGrid
            groups={groups}
            sortMode={sortMode}
            token={token}
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
          <Card className="grid min-h-[42svh] place-items-center border-dashed">
            <CardContent className="grid max-w-xs justify-items-center gap-4 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
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
        token={token}
        node={detailsNode}
        showPath
        onOpenChange={(open) => !open && setDetailsNode(null)}
        onDownload={(node) => void downloadProtectedFile(token, node)}
        onShare={(node) => setShareNode(node)}
        onRename={openRename}
        onDelete={setDeleteTarget}
        onOpenParent={(node) => navigate(folderRoute(node.parent_id ?? ROOT_ID, sortMode))}
      />
      <MediaViewer
        token={token}
        node={viewerNode}
        onOpenChange={(open) => !open && closeViewer()}
      />
      <ShareDialog
        token={token}
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
    <div className="sticky top-[7.25rem] z-30 mb-4 flex items-center justify-between gap-3 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur-xl sm:top-3">
      <Badge variant="default">{count} selectionne{count > 1 ? "s" : ""}</Badge>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon-sm" onClick={onSelectAll}>
          <Check />
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
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 size-14 rounded-full shadow-2xl sm:hidden"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-7" />
        <span className="sr-only">Actions</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="w-screen max-w-none place-items-center border-0 bg-transparent p-0 shadow-none ring-0 sm:hidden"
        >
          <DialogTitle className="sr-only">Actions</DialogTitle>
          <div className="w-[min(88vw,23rem)] rounded-3xl border bg-background/92 p-4 shadow-2xl ring-1 ring-primary/25 backdrop-blur-2xl">
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
                  "border-border bg-secondary/90 text-secondary-foreground hover:border-primary/70 hover:bg-secondary",
                  pressed && "border-primary bg-primary text-primary-foreground shadow-lg",
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

function SearchControls({
  value,
  onValueChange,
  scope,
  onScopeChange,
  currentLabel,
  loading,
  gridSize,
  onGridSizeChange,
  gridColumns,
  onGridColumnsChange,
}: {
  value: string
  onValueChange: (value: string) => void
  scope: SearchScope
  onScopeChange: (scope: SearchScope) => void
  currentLabel: string
  loading: boolean
  gridSize: GridSize
  onGridSizeChange: (gridSize: GridSize) => void
  gridColumns: number
  onGridColumnsChange: (gridColumns: number) => void
}) {
  const gridSizeLabel = GRID_SIZE_OPTIONS.find((option) => option.value === gridSize)?.label ?? "Moyenne"
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
    <div className="sticky top-0 z-30 -mx-4 mb-3 grid gap-2 border-b bg-background/90 px-4 pt-1 pb-2 backdrop-blur-xl sm:static sm:mx-0 sm:mb-4 sm:gap-3 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-0 sm:pb-0 sm:backdrop-blur-none">
      <div className="grid grid-cols-[1fr_auto] gap-1.5 sm:gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            className="h-10 rounded-full pr-10 pl-9 sm:h-11"
            placeholder="Rechercher"
          />
          {loading ? (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : value ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute right-1.5 top-1/2 -translate-y-1/2"
              onClick={() => onValueChange("")}
            >
              <X />
              <span className="sr-only">Effacer</span>
            </Button>
          ) : null}
        </div>
        <div className="hidden h-11 items-center gap-2 rounded-full border bg-background px-3 shadow-xs sm:flex">
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
            className="h-8 w-16 rounded-full px-2 text-center"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-10 sm:hidden">
              <Files />
              <span className="sr-only">Taille de la grille: {gridSizeLabel}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {GRID_SIZE_OPTIONS.map((option) => (
              <DropdownMenuItem key={option.value} onSelect={() => onGridSizeChange(option.value)}>
                <Files />
                {option.label}
                {gridSize === option.value && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <Button
          variant={scope === "current" ? "secondary" : "outline"}
          size="sm"
          className="min-w-0"
          onClick={() => onScopeChange("current")}
        >
          <Folder />
          <span className="truncate">Ce dossier</span>
        </Button>
        <Button
          variant={scope === "all" ? "secondary" : "outline"}
          size="sm"
          onClick={() => onScopeChange("all")}
        >
          <Files />
          Tous les dossiers
        </Button>
        <p className="hidden min-w-0 text-xs text-muted-foreground sm:block">
          {scope === "current" ? `Recherche recursive dans ${currentLabel || "Racine"}.` : "Recherche recursive partout."}
        </p>
      </div>
    </div>
  )
}

function SearchEmptyState({ query, scope }: { query: string; scope: SearchScope }) {
  return (
    <Card className="grid min-h-[42svh] place-items-center border-dashed">
      <CardContent className="grid max-w-xs justify-items-center gap-4 text-center">
        <div className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
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

function DropZone({ children, onFiles }: { children: ReactNode; onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={cn(
        "relative min-h-[48svh] rounded-xl transition-colors",
        dragging && "outline-2 outline-offset-4 outline-dashed outline-primary",
      )}
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
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-background/85 backdrop-blur-sm">
          <div className="grid justify-items-center gap-2 text-primary">
            <Upload className="size-8" />
            <p className="text-sm font-medium">Depose pour envoyer</p>
          </div>
        </div>
      )}
      {children}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="grid min-h-[46svh] place-items-center text-center text-sm font-medium text-muted-foreground">
      Dossier vide
    </div>
  )
}

function LoadingGrid({ gridSize, gridColumns }: { gridSize: GridSize; gridColumns: number }) {
  return (
    <section className="gallery-grid grid gap-1 sm:gap-1.5" style={galleryGridStyle(gridSize, gridColumns)}>
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index}>
          <Skeleton className="aspect-square w-full rounded-md" />
        </div>
      ))}
    </section>
  )
}

function GroupedNodeGrid({
  groups,
  sortMode,
  token,
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
  token: string
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
          <div key={group.id} className="grid gap-2">
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
                      <div key={month.id} className="grid gap-1.5">
                        <DateGroupHeader
                          id={month.id}
                          label={month.label}
                          count={month.nodes.length}
                          collapsed={monthCollapsed}
                          level="month"
                          onToggle={toggleGroup}
                        />
                        {!monthCollapsed && (
                          <NodeGrid
                            nodes={month.nodes}
                            token={token}
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
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <NodeGrid
                  nodes={group.nodes}
                  token={token}
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
        "sticky -mx-0.5 flex items-center justify-between gap-2 border px-2 shadow-sm backdrop-blur-md",
        level === "year"
          ? "top-0 z-20 rounded-lg border-border/80 bg-background/92 py-1.5"
          : "top-8 z-10 rounded-md border-border/60 bg-muted/55 py-1",
      )}
      onClick={() => onToggle(id)}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-90")} />
        <span className={cn("truncate font-medium", level === "year" ? "text-xs" : "text-[11px] text-muted-foreground")}>{label}</span>
      </span>
      <span className="shrink-0 rounded-full bg-secondary/90 px-1.5 py-0.5 text-[10px] leading-none text-secondary-foreground">
        {count}
      </span>
    </button>
  )
}

function NodeGrid({
  nodes,
  token,
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
  token: string
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
          token={token}
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
  token,
  sortMode,
  showPath = false,
  index,
  selected,
  selectionMode,
  onPointerDown,
  onOpen,
}: {
  node: NodeDto
  token: string
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
      className="group relative animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
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
            "relative grid aspect-square place-items-center overflow-hidden rounded-md transition-all",
            isFolder
              ? "bg-primary/10 text-primary"
              : node.preview_url
                ? "bg-transparent text-muted-foreground"
                : "bg-muted text-muted-foreground",
            selected && "ring-primary ring-offset-background ring-[3px] ring-offset-2",
            selectionMode && !selected && "brightness-90",
          )}
        >
          {isFolder ? (
            <div className="grid size-full place-items-center p-2 text-center">
              <div className="grid max-w-full justify-items-center gap-1.5">
                <Folder className="size-7 shrink-0" />
                <span className="line-clamp-3 max-w-full text-[11px] font-medium leading-[1.05] break-words sm:text-xs">
                  {node.name}
                </span>
              </div>
            </div>
          ) : node.preview_url ? (
            <ProtectedPreview token={token} src={node.preview_url} className="rounded-md" />
          ) : isImage ? (
            <Image className="size-8" />
          ) : isVideo ? (
            <Video className="size-8" />
          ) : (
            <FileIcon className="size-8" />
          )}
          {isVideo && (
            <div className="absolute right-2 bottom-2 rounded-full bg-background/90 p-1.5 text-foreground shadow-sm backdrop-blur-sm">
              <Video className="size-3.5" />
            </div>
          )}
          {selected && (
            <div className="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
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
  token,
  src,
  fit = "cover",
  className,
  showFallback = true,
  onImageLoad,
}: {
  token: string
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

    fetch(src, { headers: { Authorization: `Bearer ${token}` } })
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
  }, [src, token])

  if (!objectUrl) {
    return showFallback ? <Image className={cn("size-8", className)} /> : null
  }

  return (
    <img
      src={objectUrl}
      alt=""
      className={cn("size-full", fit === "contain" ? "object-contain" : "object-cover", className)}
      draggable={false}
      loading="lazy"
      onLoad={(event) => onImageLoad?.(event.currentTarget)}
    />
  )
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

function MediaViewer({
  token,
  node,
  onOpenChange,
}: {
  token: string
  node: NodeDto | null
  onOpenChange: (open: boolean) => void
}) {
  const isImage = node?.mime_type?.startsWith("image/")
  const isVideo = node?.mime_type?.startsWith("video/")
  const source = node ? mediaInlineUrl(token, node) : ""

  return (
    <Dialog open={!!node} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="h-svh w-screen max-w-none rounded-none border-0 bg-neutral-950 p-0 text-white shadow-none ring-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{node?.name ?? "Apercu"}</DialogTitle>
        {node && (
          <div className="grid size-full place-items-center p-0">
            {isImage ? (
              <FullImageViewer token={token} node={node} src={source} />
            ) : isVideo ? (
              <ModernVideoPlayer
                token={token}
                node={node}
                src={source}
                name={node.name}
              />
            ) : (
              <FileIcon className="size-16 text-neutral-500" />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function FullImageViewer({ token, node, src }: { token: string; node: NodeDto; src: string }) {
  const [loaded, setLoaded] = useState(false)
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const viewport = useViewportSize()
  const frameStyle = containedMediaFrameStyle(aspectRatio, viewport)

  useEffect(() => {
    setLoaded(false)
    setAspectRatio(null)
  }, [src])

  return (
    <div className="relative grid size-full place-items-center overflow-hidden bg-neutral-950">
      <div
        className="relative grid place-items-center overflow-hidden"
        style={frameStyle ?? fallbackMediaFrameStyle()}
      >
        <BlurredPreviewLayer
          token={token}
          node={node}
          visible={!loaded}
          onAspectRatio={setAspectRatio}
        />
        {!loaded && (
          <div className="absolute inset-0 z-10 grid place-items-center text-white">
            <Loader2 className="size-8 animate-spin drop-shadow-lg" />
          </div>
        )}
        <img
          src={src}
          alt={node.name}
          draggable={false}
          className={cn(
            "relative z-20 size-full object-contain transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={(event) => {
            const ratio = imageAspectRatio(event.currentTarget)
            if (ratio) setAspectRatio(ratio)
            setLoaded(true)
          }}
          onError={() => setLoaded(true)}
        />
      </div>
    </div>
  )
}

function BlurredPreviewLayer({
  token,
  node,
  visible,
  onAspectRatio,
}: {
  token: string
  node: NodeDto
  visible: boolean
  onAspectRatio?: (aspectRatio: number) => void
}) {
  if (!node.preview_url) return null

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden bg-neutral-950 transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <ProtectedPreview
        token={token}
        src={node.preview_url}
        showFallback={false}
        className="scale-105 blur-2xl brightness-75 saturate-125"
        onImageLoad={(image) => {
          const ratio = imageAspectRatio(image)
          if (ratio) onAspectRatio?.(ratio)
        }}
      />
      <div className="absolute inset-0 bg-neutral-950/20" />
    </div>
  )
}

function ModernVideoPlayer({ token, node, src, name }: { token: string; node: NodeDto; src: string; name: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [mediaReady, setMediaReady] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [rotated, setRotated] = useState(false)
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 })
  const [previewAspectRatio, setPreviewAspectRatio] = useState<number | null>(null)
  const viewport = useViewportSize()

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0
  const isLandscape = videoSize.width > videoSize.height
  const videoAspectRatio = videoSize.width > 0 && videoSize.height > 0 ? videoSize.width / videoSize.height : previewAspectRatio
  const frameStyle = rotated ? undefined : containedMediaFrameStyle(videoAspectRatio, viewport)

  useEffect(() => {
    setPlaying(false)
    setWaiting(true)
    setMediaReady(false)
    setDuration(0)
    setCurrentTime(0)
    setBuffered(0)
    setControlsVisible(true)
    setRotated(false)
    setVideoSize({ width: 0, height: 0 })
    setPreviewAspectRatio(null)
  }, [src])

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [])

  useEffect(() => {
    if (!playing || waiting || controlsVisible === false) return
    const timer = window.setTimeout(() => setControlsVisible(false), 2400)
    return () => window.clearTimeout(timer)
  }, [controlsVisible, playing, waiting])

  function showControls() {
    setControlsVisible(true)
  }

  async function togglePlay() {
    const video = videoRef.current
    if (!video) return
    showControls()
    if (video.paused) {
      await video.play().catch(() => undefined)
    } else {
      video.pause()
    }
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
    showControls()
  }

  function changeVolume(value: number) {
    const video = videoRef.current
    if (!video) return
    video.volume = value
    video.muted = value === 0
    setVolume(value)
    setMuted(video.muted)
    showControls()
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
    showControls()
  }

  async function toggleFullscreen() {
    const container = containerRef.current
    if (!container) return
    showControls()
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined)
    } else {
      await container.requestFullscreen?.().catch(() => undefined)
    }
  }

  function toggleRotation() {
    setRotated((current) => !current)
    showControls()
  }

  return (
    <div
      ref={containerRef}
      className="group relative grid size-full place-items-center overflow-hidden bg-neutral-950"
      onPointerMove={showControls}
      onPointerDown={showControls}
    >
      <div
        className={cn(
          "relative grid place-items-center overflow-hidden",
          rotated && "size-full",
        )}
        style={rotated ? undefined : frameStyle ?? fallbackMediaFrameStyle()}
      >
        <BlurredPreviewLayer
          token={token}
          node={node}
          visible={!mediaReady}
          onAspectRatio={setPreviewAspectRatio}
        />
        <video
          ref={videoRef}
          src={src}
          className={cn(
            "relative z-10 object-contain transition-[opacity,transform] duration-200",
            mediaReady ? "opacity-100" : "opacity-0",
            rotated
              ? "h-[100vw] max-h-none w-[100svh] max-w-none rotate-90"
              : "size-full",
          )}
          autoPlay
          playsInline
          preload="metadata"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration || 0)
            setVolume(event.currentTarget.volume)
            setMuted(event.currentTarget.muted)
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
          onPause={() => {
            setPlaying(false)
            setControlsVisible(true)
          }}
          onEnded={() => {
            setPlaying(false)
            setControlsVisible(true)
          }}
        />
      </div>

      {(waiting || !playing) && (
        <button
          type="button"
          className="absolute inset-0 z-20 grid place-items-center text-white"
          onClick={togglePlay}
        >
          <span className="grid size-16 place-items-center rounded-full bg-black/55 shadow-2xl backdrop-blur-md">
            {waiting ? <Loader2 className="size-7 animate-spin" /> : <Play className="ml-1 size-8 fill-current" />}
          </span>
          <span className="sr-only">{playing ? "Pause" : "Lecture"}</span>
        </button>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-30 grid gap-3 bg-linear-to-t from-black/85 via-black/45 to-transparent px-3 pt-16 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-white transition-opacity sm:px-5 sm:pb-5",
          controlsVisible || !playing ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto grid gap-3">
          <div className="relative h-5">
            <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-full bg-white/20">
              <div className="h-full rounded-full bg-white/35" style={{ width: `${bufferedProgress}%` }} />
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

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="size-11 text-white hover:bg-white/15 hover:text-white" onClick={togglePlay}>
              {playing ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
              <span className="sr-only">{playing ? "Pause" : "Lecture"}</span>
            </Button>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/15 hover:text-white" onClick={toggleMute}>
                {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
                <span className="sr-only">Son</span>
              </Button>
              <input
                aria-label="Volume"
                className="video-range hidden w-20 sm:block"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(event) => changeVolume(Number(event.target.value))}
              />
            </div>

            <span className="min-w-28 text-xs font-medium tabular-nums text-white/85">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>

            <div className="min-w-0 flex-1" />

            <span className="hidden max-w-[32vw] truncate text-xs text-white/65 sm:block">{name}</span>
            {isLandscape && (
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-11 text-white hover:bg-white/15 hover:text-white",
                  rotated && "bg-white/15",
                )}
                onClick={toggleRotation}
              >
                <RotateCw />
                <span className="sr-only">Tourner la video</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-11 text-white hover:bg-white/15 hover:text-white"
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
              <span className="sr-only">Plein ecran</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailsDialog({
  token,
  node,
  showPath = false,
  onOpenChange,
  onDownload,
  onShare,
  onRename,
  onDelete,
  onOpenParent,
}: {
  token: string
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
            <div className="grid aspect-square max-h-[62svh] place-items-center bg-neutral-950 text-neutral-400 sm:aspect-video">
              {node.preview_url ? (
                <ProtectedPreview token={token} src={node.preview_url} fit="contain" />
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

              <div className="grid gap-2 rounded-lg border p-3 text-sm">
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
  token,
  node,
  request,
  onOpenChange,
}: {
  token: string
  node: NodeDto | null
  request: <T>(path: string, init?: RequestInit) => Promise<T>
  onOpenChange: (open: boolean) => void
}) {
  const [shares, setShares] = useState<ShareDto[]>([])
  const [newLink, setNewLink] = useState("")
  const [copied, setCopied] = useState(false)

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
      const payload = await request<{ public_url: string }>(`/api/files/${node.id}/shares`, { method: "POST" })
      const absolute = toAbsoluteUrl(payload.public_url)
      setNewLink(absolute)
      await navigator.clipboard?.writeText(absolute)
      setCopied(true)
      toast.success("Lien copie")
      await load()
    } catch {
      toast.error("Creation du lien impossible.")
    }
  }

  async function revoke(id: string) {
    try {
      await request<void>(`/api/shares/${id}`, { method: "DELETE" })
      toast.success("Lien revoque")
      await load()
    } catch {
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
                <div key={share.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div className="grid gap-1.5">
                    <Badge variant={share.revoked_at ? "secondary" : "default"}>
                      {share.revoked_at ? "Revoque" : "Actif"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{share.download_count} telechargement(s)</span>
                  </div>
                  {!share.revoked_at && (
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
        const payload = await request<{ public_url: string }>(`/api/files/${file.id}/shares`, { method: "POST" })
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
                  <div key={link.fileId} className="grid gap-2 rounded-xl border p-3">
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
                <div className="grid aspect-video place-items-center overflow-hidden rounded-xl bg-muted text-muted-foreground">
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
    <div className="grid w-[min(92vw,360px)] max-w-[92vw] gap-2 overflow-hidden rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg">
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

function isVideoNode(node: NodeDto) {
  return node.kind === "file" && !!node.mime_type?.startsWith("video/")
}

function shouldGenerateStoredVideoPreview(node: NodeDto) {
  return isVideoNode(node) && !node.preview_url
}

function shouldUseLightImport(files: File[]) {
  if (files.length > LIGHT_IMPORT_FILE_LIMIT) return true
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  if (totalBytes > LIGHT_IMPORT_BYTES_LIMIT) return true
  return isConstrainedMobileBrowser() && files.length > 8
}

function uploadConcurrencyFor(files: File[], lightImport: boolean) {
  if (files.length <= 1) return 1
  if (isConstrainedMobileBrowser()) return Math.min(MOBILE_UPLOAD_CONCURRENCY, files.length)

  const hasHugeFile = files.some((file) => file.size > 512 * 1024 * 1024)
  const concurrency = hasHugeFile || lightImport ? 3 : DESKTOP_UPLOAD_CONCURRENCY
  return Math.min(concurrency, files.length)
}

function shouldQueueClientPreview(file: File, lightImport: boolean) {
  if (!isPreviewCandidate(file)) return false
  if (isVideoFile(file)) return false
  if (isConstrainedMobileBrowser()) {
    if (file.size > 24 * 1024 * 1024) return false
    if (lightImport && file.size > 12 * 1024 * 1024) return false
  }
  return true
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

async function uploadFileWithConflictHandling({
  request,
  token,
  clientId,
  folderId,
  file,
  onProgress,
  getDuplicateDecision,
}: {
  request: <T>(path: string, init?: RequestInit) => Promise<T>
  token: string
  clientId: string
  folderId: string
  file: File
  onProgress: (progress: number) => void
  getDuplicateDecision: (fileName: string) => Promise<DuplicateDecision>
}) {
  let uploadName = file.name

  for (;;) {
    try {
      return await uploadRawFile(token, clientId, folderId, file, onProgress, uploadName)
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

      return await replaceRawFile(token, clientId, existing.id, file, onProgress)
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
  token: string,
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
    xhr.setRequestHeader("Authorization", `Bearer ${token}`)
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
  token: string,
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
    xhr.setRequestHeader("Authorization", `Bearer ${token}`)
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

async function uploadClientPreview(token: string, clientId: string, fileId: string, file: File) {
  const preview = await createThumbnail(file)
  if (!preview) return null

  return uploadPreviewBlob(token, clientId, fileId, preview)
}

async function uploadStoredVideoPreview(token: string, clientId: string, node: NodeDto) {
  const preview = await createVideoThumbnailFromSource(mediaInlineUrl(token, node))
  if (!preview) return null

  return uploadPreviewBlob(token, clientId, node.id, preview)
}

async function uploadPreviewBlob(token: string, clientId: string, fileId: string, preview: Blob) {
  const response = await fetch(`/api/files/${fileId}/preview`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
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

async function downloadProtectedFile(token: string, node: NodeDto) {
  if (!node.download_url) return

  const loadingId = toast.loading("Preparation du telechargement", { description: node.name })
  try {
    const response = await fetch(node.download_url, {
      headers: { Authorization: `Bearer ${token}` },
    })
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

function isFileNode(node: NodeDto) {
  return node.kind === "file"
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

function mediaInlineUrl(token: string, node: NodeDto) {
  return `/api/files/${node.id}/inline?access_token=${encodeURIComponent(token)}`
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster richColors closeButton position="top-center" />
    </TooltipProvider>
  </StrictMode>,
)
