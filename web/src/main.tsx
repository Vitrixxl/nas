import {
  StrictMode,
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
  ArrowDownAZ,
  CalendarDays,
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
const GRID_SIZE_KEY = "nas.gallery.grid-size"
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
}

type PendingFileImport = {
  files: File[]
  suggestedFolderName?: string
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

const MEDIA_ACCEPT = "image/*,video/*"
const GRID_SIZE_OPTIONS: Array<{ value: GridSize; label: string; min: number }> = [
  { value: "small", label: "Petite", min: 116 },
  { value: "medium", label: "Moyenne", min: 170 },
  { value: "large", label: "Grande", min: 240 },
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

function folderRoute(folderId: string, sortMode: SortMode, query = "", scope: SearchScope = "current") {
  const params = new URLSearchParams({ sort: sortMode })
  const trimmedQuery = query.trim()
  if (trimmedQuery) {
    params.set("q", trimmedQuery)
    params.set("scope", scope)
  }
  return `/folder/${folderId}?${params}`
}

function allFilesRoute(sortMode: SortMode, query = "") {
  const params = new URLSearchParams({ sort: sortMode })
  const trimmedQuery = query.trim()
  if (trimmedQuery) {
    params.set("q", trimmedQuery)
  }
  return `/files?${params}`
}

function parseSortMode(value: string | null): SortMode {
  return value === "name" ? "name" : "date"
}

function parseSearchScope(value: string | null): SearchScope {
  return value === "all" ? "all" : "current"
}

function parseGridSize(value: string | null): GridSize {
  return value === "small" || value === "large" ? value : "medium"
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

function useAuthedRequest(token: string, onAuthExpired: () => void) {
  return useCallback(
    async <T,>(path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set("Authorization", `Bearer ${token}`)
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
    [onAuthExpired, token],
  )
}

function useGridSize() {
  const [gridSize, setGridSizeState] = useState<GridSize>(() => parseGridSize(localStorage.getItem(GRID_SIZE_KEY)))

  const setGridSize = useCallback((nextGridSize: GridSize) => {
    setGridSizeState(nextGridSize)
    localStorage.setItem(GRID_SIZE_KEY, nextGridSize)
  }, [])

  return [gridSize, setGridSize] as const
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
    }
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const setSelectedId = useCallback((id: string, selected: boolean) => {
    if (!selectableIdsRef.current.has(id)) return
    setSelectedIds((current) => {
      if (selected && current.has(id)) return current
      if (!selected && !current.has(id)) return current
      const next = new Set(current)
      if (selected) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
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

  const applySelectionAtPoint = useCallback(
    (x: number, y: number, selected: boolean) => {
      const element = document.elementFromPoint(x, y)?.closest("[data-node-id]") as HTMLElement | null
      const id = element?.dataset.nodeId
      if (id) setSelectedId(id, selected)
    },
    [setSelectedId],
  )

  const handlePointerDown = useCallback(
    (node: NodeDto, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.defaultPrevented) return
      if ((event.target as HTMLElement).closest("[data-selection-ignore]")) return

      cleanupRef.current?.()

      const selectionModeAtStart = selectedIdsRef.current.size > 0
      const shouldSelect = !selectedIdsRef.current.has(node.id)
      const gesture = {
        active: false,
        cancelled: false,
        startX: event.clientX,
        startY: event.clientY,
        timer: 0,
      }

      const startSelection = () => {
        if (gesture.active || gesture.cancelled) return
        gesture.active = true
        document.body.classList.add("is-selecting-nodes")
        setSelectedId(node.id, shouldSelect)
        navigator.vibrate?.(8)
      }

      if (!selectionModeAtStart) {
        gesture.timer = window.setTimeout(startSelection, 420)
      }

      function cleanup() {
        window.clearTimeout(gesture.timer)
        window.removeEventListener("pointermove", handleMove)
        window.removeEventListener("pointerup", handleEnd)
        window.removeEventListener("pointercancel", handleEnd)
        document.body.classList.remove("is-selecting-nodes")
        cleanupRef.current = null
      }

      function handleMove(moveEvent: globalThis.PointerEvent) {
        if (moveEvent.pointerId !== event.pointerId) return

        const distance = Math.hypot(moveEvent.clientX - gesture.startX, moveEvent.clientY - gesture.startY)
        if (!gesture.active) {
          if (selectionModeAtStart && distance > 8) {
            startSelection()
          } else if (!selectionModeAtStart && distance > 18) {
            gesture.cancelled = true
            window.clearTimeout(gesture.timer)
          }
        }

        if (gesture.active) {
          moveEvent.preventDefault()
          applySelectionAtPoint(moveEvent.clientX, moveEvent.clientY, shouldSelect)
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
    [applySelectionAtPoint, setSelectedId],
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
  const [shareNode, setShareNode] = useState<NodeDto | null>(null)
  const [detailsNode, setDetailsNode] = useState<NodeDto | null>(null)
  const [viewerNode, setViewerNode] = useState<NodeDto | null>(null)
  const [pendingFileImport, setPendingFileImport] = useState<PendingFileImport | null>(null)
  const [importFolderName, setImportFolderName] = useState("")
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateConflictRequest | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const directoryInput = useRef<HTMLInputElement | null>(null)
  const request = useAuthedRequest(token, onAuthExpired)
  const [gridSize, setGridSize] = useGridSize()

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

  function changeSortMode(nextSortMode: SortMode) {
    navigate(folderRoute(routeFolderId, nextSortMode, query, searchScope))
  }

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
      await createFolderNamed(name)
      setNewFolderName("")
      setCreateOpen(false)
      toast.success("Dossier cree")
      await fetchFolder(routeFolderId, sortMode)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Creation impossible.")
    }
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

  function startFileImport(files: FileList | File[] | null, suggestedFolderName?: string) {
    const selectedFiles = Array.from(files ?? [])
    if (selectedFiles.length === 0) return
    setPendingFileImport({ files: selectedFiles, suggestedFolderName })
    setImportFolderName(defaultImportFolderName(selectedFiles, suggestedFolderName))
  }

  async function importPendingFilesHere() {
    const pending = pendingFileImport
    if (!pending) return
    setPendingFileImport(null)
    await uploadFiles(pending.files)
  }

  async function importPendingFilesInNewFolder() {
    const pending = pendingFileImport
    const name = importFolderName.trim()
    if (!pending || !name) return

    try {
      const folder = await createFolderNamed(name)
      setPendingFileImport(null)
      toast.success("Dossier cree")
      await uploadFiles(pending.files, { baseFolderId: folder.id })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Creation impossible.")
    }
  }

  function askDuplicateConflict(fileName: string) {
    return new Promise<DuplicateDecision>((resolve) => {
      setDuplicateConflict({ fileName, resolve })
    })
  }

  async function uploadFiles(files: FileList | File[], options: { baseFolderId?: string } = {}) {
    const currentFolderAtStart = routeFolderId
    const uploadRootId = options.baseFolderId ?? routeFolderId
    let duplicatePolicy: DuplicateAction | null = null
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

    const folderCache = new Map<string, string>()
    for (const file of mediaFiles) {
      const folderSegments = importFolderSegments(file)
      const toastId = `upload:${crypto.randomUUID()}`
      const toastName = uploadDisplayName(file)
      showUploadToast(toastId, toastName, 0, "Envoi")

      try {
        const targetFolderId = folderSegments.length
          ? await ensureFolderPath(request, uploadRootId, folderSegments, folderCache)
          : uploadRootId
        const uploaded = await uploadFileWithConflictHandling({
          request,
          token,
          folderId: targetFolderId,
          file,
          onProgress: (progress) => showUploadToast(toastId, toastName, progress, "Envoi"),
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
          showUploadToast(toastId, toastName, 100, "Ignore", "done")
          continue
        }

        if (isPreviewCandidate(file)) {
          showUploadToast(toastId, toastName, 100, "Miniature")
          try {
            await uploadClientPreview(token, uploaded.id, file)
          } catch {
            toast.warning("Miniature non generee", { description: toastName })
          }
        }

        showUploadToast(toastId, toastName, 100, "Termine", "done")
      } catch (err) {
        showUploadToast(toastId, toastName, 100, err instanceof Error ? err.message : "Upload impossible", "error")
      }
    }

    if (currentFolderAtStart === routeFolderId) {
      await fetchFolder(routeFolderId, sortMode)
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
        startFileImport(files, directory.name)
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
  const selection = useNodeSelection(visibleNodes)

  useEffect(() => {
    if (!viewerId) {
      setViewerNode(null)
      return
    }

    const node = visibleNodes.find((candidate) => candidate.id === viewerId && candidate.kind === "file")
    setViewerNode(node ?? null)
  }, [viewerId, visibleNodes])

  return (
    <div className="min-h-svh" onContextMenu={preventAppContextMenu}>
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-[env(safe-area-inset-top)] sm:pb-12 sm:pt-6">
        <SearchControls
          value={searchValue}
          onValueChange={setSearchValue}
          scope={searchScope}
          onScopeChange={changeSearchScope}
          sortMode={sortMode}
          onSortChange={changeSortMode}
          currentLabel={data?.folder.name || "Racine"}
          loading={searchLoading}
          gridSize={gridSize}
          onGridSizeChange={setGridSize}
        />

        <SelectionBar count={selection.selectedNodes.length} onClear={selection.clearSelection} />

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
              onSelect: () => fileInput.current?.click(),
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
            startFileImport(event.target.files)
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
            startFileImport(event.target.files)
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

        <DropZone onFiles={startFileImport}>
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
              <LoadingGrid gridSize={gridSize} />
            ) : searchResults.length > 0 ? (
              <GroupedNodeGrid
                groups={groups}
                sortMode={sortMode}
                token={token}
                gridSize={gridSize}
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
            <LoadingGrid gridSize={gridSize} />
          ) : data && data.children.length > 0 ? (
            <GroupedNodeGrid
              groups={groups}
              sortMode={sortMode}
              token={token}
              gridSize={gridSize}
              onOpen={(node) => (node.kind === "folder" ? openFolder(node.id) : openViewer(node))}
              selectedIds={selection.selectedIds}
              selectionMode={selection.selectionMode}
              onNodePointerDown={selection.handlePointerDown}
              onNodeClick={selection.handleClick}
            />
          ) : (
            <EmptyState onUpload={() => fileInput.current?.click()} onCreateFolder={() => setCreateOpen(true)} />
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
  const [shareNode, setShareNode] = useState<NodeDto | null>(null)
  const [detailsNode, setDetailsNode] = useState<NodeDto | null>(null)
  const [viewerNode, setViewerNode] = useState<NodeDto | null>(null)
  const request = useAuthedRequest(token, onAuthExpired)
  const [gridSize, setGridSize] = useGridSize()

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

  function changeSortMode(nextSortMode: SortMode) {
    navigate(allFilesRoute(nextSortMode, query))
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

  const groups = useMemo(() => groupNodesBySort(files, sortMode), [files, sortMode])
  const selection = useNodeSelection(files)

  useEffect(() => {
    if (!viewerId) {
      setViewerNode(null)
      return
    }

    const node = files.find((candidate) => candidate.id === viewerId)
    setViewerNode(node ?? null)
  }, [files, viewerId])

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
          sortMode={sortMode}
          onSortChange={changeSortMode}
          currentLabel="Racine"
          loading={loading}
          gridSize={gridSize}
          onGridSizeChange={setGridSize}
        />

        <SelectionBar count={selection.selectedNodes.length} onClear={selection.clearSelection} />

        {loading ? (
          <LoadingGrid gridSize={gridSize} />
        ) : files.length > 0 ? (
          <GroupedNodeGrid
            groups={groups}
            sortMode={sortMode}
            token={token}
            gridSize={gridSize}
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
    </div>
  )
}

function preventAppContextMenu(event: ReactMouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement
  if (target.closest("input, textarea, [contenteditable='true']")) return
  event.preventDefault()
}

function SelectionBar({ count, onClear }: { count: number; onClear: () => void }) {
  if (count === 0) return null

  return (
    <div className="sticky top-[7.25rem] z-30 mb-4 flex items-center justify-between gap-3 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur-xl sm:top-3">
      <Badge variant="default">{count} selectionne{count > 1 ? "s" : ""}</Badge>
      <Button variant="ghost" size="icon-sm" onClick={onClear}>
        <X />
        <span className="sr-only">Annuler la selection</span>
      </Button>
    </div>
  )
}

function MobileActionMenu({
  actions,
}: {
  actions: Array<{
    label: string
    icon: ReactNode
    onSelect: () => void
    variant?: "default" | "outline" | "secondary"
  }>
}) {
  const [open, setOpen] = useState(false)
  const [pressedAction, setPressedAction] = useState<string | null>(null)

  function runAction(action: (typeof actions)[number]) {
    setPressedAction(action.label)
    action.onSelect()
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
                return (
                  <Button
                    key={action.label}
                    variant="secondary"
                    size="lg"
                    className={cn(
                      "h-24 flex-col gap-2 rounded-2xl border px-3 text-center text-sm shadow-sm transition-all active:scale-[0.98]",
                      "border-border bg-secondary/90 text-secondary-foreground hover:border-primary/70 hover:bg-secondary",
                      pressed && "border-primary bg-primary text-primary-foreground shadow-lg",
                      firstSingle && "col-span-2",
                    )}
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
  sortMode,
  onSortChange,
  currentLabel,
  loading,
  gridSize,
  onGridSizeChange,
}: {
  value: string
  onValueChange: (value: string) => void
  scope: SearchScope
  onScopeChange: (scope: SearchScope) => void
  sortMode: SortMode
  onSortChange: (sortMode: SortMode) => void
  currentLabel: string
  loading: boolean
  gridSize: GridSize
  onGridSizeChange: (gridSize: GridSize) => void
}) {
  const gridSizeLabel = GRID_SIZE_OPTIONS.find((option) => option.value === gridSize)?.label ?? "Moyenne"

  return (
    <div className="sticky top-0 z-30 -mx-4 mb-3 grid gap-2 border-b bg-background/90 px-4 pt-1 pb-2 backdrop-blur-xl sm:static sm:mx-0 sm:mb-4 sm:gap-3 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-0 sm:pb-0 sm:backdrop-blur-none">
      <div className="grid grid-cols-[1fr_auto_auto] gap-1.5 sm:gap-2">
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-10 sm:h-11 sm:w-auto sm:px-3">
              {sortMode === "date" ? <CalendarDays /> : <ArrowDownAZ />}
              <span className="hidden sm:inline">Trier</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onSortChange("name")}>
              <ArrowDownAZ />
              Nom
              {sortMode === "name" && <Check className="ml-auto" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSortChange("date")}>
              <CalendarDays />
              Date
              {sortMode === "date" && <Check className="ml-auto" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-10 sm:h-11 sm:w-auto sm:px-3">
              <Files />
              <span className="hidden sm:inline">Taille</span>
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

function EmptyState({ onUpload, onCreateFolder }: { onUpload: () => void; onCreateFolder: () => void }) {
  return (
    <Card className="grid min-h-[46svh] place-items-center border-dashed">
      <CardContent className="grid max-w-xs justify-items-center gap-4 text-center">
        <div className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Folder className="size-7" />
        </div>
        <div className="grid gap-1">
          <p className="font-medium">Dossier vide</p>
          <p className="text-sm text-muted-foreground">Envoie un fichier ou cree un dossier pour commencer.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={onCreateFolder}>
            <FolderPlus />
            Dossier
          </Button>
          <Button size="sm" onClick={onUpload}>
            <Upload />
            Envoyer
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function LoadingGrid({ gridSize }: { gridSize: GridSize }) {
  return (
    <section className="grid gap-2 sm:gap-3" style={galleryGridStyle(gridSize)}>
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
  showPath?: boolean
  onOpen: (node: NodeDto) => void
  selectedIds?: Set<string>
  selectionMode?: boolean
  onNodePointerDown?: (node: NodeDto, event: ReactPointerEvent<HTMLElement>) => void
  onNodeClick?: (node: NodeDto, open: () => void, event: ReactMouseEvent<HTMLElement>) => void
}) {
  let index = 0

  return (
    <section className="grid gap-5">
      {groups.map((group) => (
        <div key={group.id} className="grid gap-3">
          {sortMode === "date" && (
            <div className="sticky top-0 z-20 -mx-1 rounded-xl border bg-background/90 px-3 py-2 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{group.label}</h2>
                <Badge variant="secondary">{group.nodes.length}</Badge>
              </div>
            </div>
          )}
          <div className="grid gap-2 sm:gap-3" style={galleryGridStyle(gridSize)}>
            {group.nodes.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                token={token}
                sortMode={sortMode}
                showPath={showPath}
                index={index++}
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
        </div>
      ))}
    </section>
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
            isFolder ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
            !isFolder && "bg-neutral-950 p-1",
            selected && "ring-primary ring-offset-background ring-[3px] ring-offset-2",
            selectionMode && !selected && "brightness-90",
          )}
        >
          {isFolder ? (
            <div className="grid size-full place-items-center p-3 text-center">
              <div className="grid max-w-full justify-items-center gap-2">
                <Folder className="size-9 shrink-0" />
                <span className="line-clamp-3 max-w-full text-sm font-medium leading-tight break-words">
                  {node.name}
                </span>
              </div>
            </div>
          ) : node.preview_url ? (
            <ProtectedPreview token={token} src={node.preview_url} />
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
}: {
  token: string
  src: string
  fit?: "cover" | "contain"
  className?: string
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
    return <Image className={cn("size-8", className)} />
  }

  return (
    <img
      src={objectUrl}
      alt=""
      className={cn("size-full", fit === "contain" ? "object-contain" : "object-cover", className)}
      draggable={false}
      loading="lazy"
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
            {count} fichier{count > 1 ? "s" : ""} selectionne{count > 1 ? "s" : ""}.
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

  useEffect(() => {
    setLoaded(false)
  }, [src])

  return (
    <div className="relative grid size-full place-items-center overflow-hidden bg-neutral-950">
      <BlurredPreviewLayer token={token} node={node} visible={!loaded} />
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
          "relative z-20 max-h-svh max-w-screen object-contain transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  )
}

function BlurredPreviewLayer({
  token,
  node,
  visible,
}: {
  token: string
  node: NodeDto
  visible: boolean
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
        className="scale-110 blur-2xl brightness-75 saturate-125"
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

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0
  const isLandscape = videoSize.width > videoSize.height

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
      <BlurredPreviewLayer token={token} node={node} visible={!mediaReady} />
      <video
        ref={videoRef}
        src={src}
        className={cn(
          "relative z-10 object-contain transition-[opacity,transform] duration-200",
          mediaReady ? "opacity-100" : "opacity-0",
          rotated
            ? "h-[100vw] max-h-none w-[100svh] max-w-none rotate-90"
            : "max-h-svh max-w-screen",
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

      {(waiting || !playing) && (
        <button
          type="button"
          className="absolute inset-0 grid place-items-center text-white"
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
          "pointer-events-none absolute inset-x-0 bottom-0 grid gap-3 bg-linear-to-t from-black/85 via-black/45 to-transparent px-3 pt-16 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-white transition-opacity sm:px-5 sm:pb-5",
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

function uploadDisplayName(file: File) {
  const path = importedRelativePath(file)
  return path && path !== file.name ? path : file.name
}

function importFolderSegments(file: File) {
  const parts = importedRelativePath(file).split("/").filter(Boolean)
  parts.pop()
  return parts.map((segment) => segment.trim()).filter(isSafeImportSegment)
}

function importedRelativePath(file: File) {
  return ((file as FileWithPath).webkitRelativePath || file.name).replaceAll("\\", "/")
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
    .map((file) => importedRelativePath(file).split("/").filter(Boolean)[0] ?? "")
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
  folderId,
  file,
  onProgress,
  getDuplicateDecision,
}: {
  request: <T>(path: string, init?: RequestInit) => Promise<T>
  token: string
  folderId: string
  file: File
  onProgress: (progress: number) => void
  getDuplicateDecision: (fileName: string) => Promise<DuplicateDecision>
}) {
  let uploadName = file.name

  for (;;) {
    try {
      return await uploadRawFile(token, folderId, file, onProgress, uploadName)
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

      return await replaceRawFile(token, existing.id, file, onProgress)
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

async function uploadClientPreview(token: string, fileId: string, file: File) {
  const preview = await createThumbnail(file)
  if (!preview) return

  const response = await fetch(`/api/files/${fileId}/preview`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": preview.type,
    },
    body: preview,
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }
}

async function createThumbnail(file: File) {
  if (file.type.startsWith("video/") || videoExtension(file.name)) {
    return createVideoThumbnail(file)
  }

  if (!file.type.startsWith("image/") && !imageExtension(file.name)) {
    return null
  }

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    const maxSize = 360
    const ratio = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * ratio))
    const height = Math.max(1, Math.round(bitmap.height * ratio))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) return null
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/webp", 0.75)
    })
  } catch {
    return null
  }
}

async function createVideoThumbnail(file: File) {
  return new Promise<Blob | null>((resolve) => {
    const video = document.createElement("video")
    const objectUrl = URL.createObjectURL(file)
    let settled = false
    const timer = window.setTimeout(() => fail(), 8000)
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeAttribute("src")
      video.load()
      URL.revokeObjectURL(objectUrl)
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
        canvas.toBlob(
          (blob) => {
            if (settled) return
            settled = true
            cleanup()
            resolve(blob)
          },
          "image/webp",
          0.76,
        )
      } catch {
        fail()
      }
    }

    video.preload = "metadata"
    video.muted = true
    video.playsInline = true
    video.onerror = fail
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const target = duration > 0.25 ? Math.min(Math.max(duration * 0.08, 0.1), 1.5, duration - 0.05) : 0
      if (target > 0) {
        try {
          video.currentTime = target
        } catch {
          capture()
        }
      } else {
        capture()
      }
    }
    video.onseeked = capture
    video.src = objectUrl
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
    return [{ id: "all", label: "Tous", nodes }]
  }

  const groups = new Map<string, NodeGroup>()
  const sortedNodes = [...nodes].sort((left, right) => {
    const byDate = right.display_date_at - left.display_date_at
    if (byDate !== 0) return byDate
    return left.name.localeCompare(right.name, "fr", { sensitivity: "base" })
  })

  for (const node of sortedNodes) {
    const key = monthKey(node.display_date_at)
    const group = groups.get(key) ?? {
      id: key,
      label: monthLabel(node.display_date_at),
      nodes: [],
    }
    group.nodes.push(node)
    groups.set(key, group)
  }

  return Array.from(groups.values())
}

function monthKey(timestamp: number) {
  const date = new Date(timestamp * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function monthLabel(timestamp: number) {
  return capitalizeFirstLetter(new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
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

function galleryGridStyle(gridSize: GridSize) {
  const min = GRID_SIZE_OPTIONS.find((option) => option.value === gridSize)?.min ?? 170
  return {
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}px), 1fr))`,
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
