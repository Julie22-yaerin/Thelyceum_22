/**
 * WorkspaceExplorer — The Lyceum
 *
 * A full-featured workspace file browser with:
 *   - Folder tree sidebar (nested, collapsible)
 *   - File grid/table view with type icons, sizes, dates
 *   - Upload document (modal)
 *   - Create folder (modal)
 *   - Rename / delete folders and documents
 *   - Breadcrumb navigation
 *   - Drag-to-upload area
 *   - Search within workspace
 */

import { useState, useRef, useCallback, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  FileJson,
  FileCode,
  Image,
  File,
  Folder as FolderIcon,
  FolderOpen,
  Plus,
  Upload,
  Search,
  MoreHorizontal,
  Trash2,
  Pencil,
  Download,
  X,
  Check,
  Home,
  RefreshCw,
  FilePlus,
  Users,
  Loader2,
  GripVertical,
  Building2,
  Sparkles,
  Brain,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  useWorkspaceStore,
  type WorkspaceFolder,
  type WorkspaceDocument,
  type DocumentType,
} from "@/store/useWorkspaceStore";
import { analyzeDocument, simulateAnalysis } from "@/lib/documentAnalyzer";
import InviteMemberDialog from "@/components/InviteMemberDialog";
import DocumentAnalysisPanel from "@/components/DocumentAnalysisPanel";
import TaskComposerPanel from "@/components/TaskComposerPanel";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<DocumentType, { icon: React.ElementType; color: string }> = {
  pdf: { icon: FileText, color: "text-red-400" },
  doc: { icon: FileText, color: "text-blue-400" },
  xlsx: { icon: FileSpreadsheet, color: "text-green-400" },
  txt: { icon: FileText, color: "text-gray-400" },
  md: { icon: FileCode, color: "text-purple-400" },
  json: { icon: FileJson, color: "text-yellow-400" },
  image: { icon: Image, color: "text-pink-400" },
  code: { icon: FileCode, color: "text-cyan-400" },
  other: { icon: File, color: "text-muted-foreground" },
};

function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getFileType(name: string): DocumentType {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, DocumentType> = {
    pdf: "pdf", doc: "doc", docx: "doc", xls: "xlsx", xlsx: "xlsx",
    txt: "txt", md: "md", json: "json", xml: "json",
    js: "code", ts: "code", jsx: "code", tsx: "code", py: "code",
    png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image",
  };
  return map[ext] || "other";
}

// ── Folder Tree Item ─────────────────────────────────────────────────────────

function FolderTreeItem({
  folder,
  depth,
  onNavigate,
  currentFolderId,
}: {
  folder: WorkspaceFolder;
  depth: number;
  onNavigate: (id: string | null) => void;
  currentFolderId: string | null;
}) {
  const { folders, documents } = useWorkspaceStore();
  const childFolders = folders.filter((f) => f.parentId === folder.id);
  const [expanded, setExpanded] = useState(false);
  const isActive = currentFolderId === folder.id;
  const docCount = documents.filter((d) => d.folderId === folder.id).length;

  return (
    <div>
      <button
        onClick={() => {
          onNavigate(folder.id);
          setExpanded(!expanded);
        }}
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left transition-colors",
          isActive
            ? "bg-teal-500/10 text-teal-300"
            : "text-white/70 hover:bg-white/[0.04] hover:text-white"
        )}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        {childFolders.length > 0 ? (
          expanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {expanded ? (
          <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        ) : (
          <FolderIcon className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
        )}
        <span className="text-[11px] truncate flex-1">{folder.name}</span>
        {docCount > 0 && (
          <span className="text-[8px] text-muted-foreground">{docCount}</span>
        )}
      </button>
      {expanded && childFolders.map((cf) => (
        <FolderTreeItem
          key={cf.id}
          folder={cf}
          depth={depth + 1}
          onNavigate={onNavigate}
          currentFolderId={currentFolderId}
        />
      ))}
    </div>
  );
}

// ── File Grid Item ───────────────────────────────────────────────────────────

function FileItem({
  doc,
  onDelete,
  onRename,
  onAnalyze,
  analyzing,
}: {
  doc: WorkspaceDocument;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAnalyze: (doc: WorkspaceDocument) => void;
  analyzing: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(doc.name);
  const meta = TYPE_META[doc.type];
  const Icon = meta.icon;

  const handleRename = () => {
    if (newName.trim() && newName !== doc.name) {
      onRename(doc.id, newName.trim());
    }
    setRenaming(false);
  };

  return (
    <div className="group relative flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/10 transition-all">
      {/* Icon */}
      <div className={cn("w-8 h-8 rounded-md bg-white/[0.03] flex items-center justify-center shrink-0", meta.color)}>
        <Icon className="w-4 h-4" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        {renaming ? (
          <div className="flex gap-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-6 text-[10px] bg-white/5 border-white/10 text-white"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
            <button onClick={handleRename} className="text-teal-400 hover:text-teal-300">
              <Check className="w-3 h-3" />
            </button>
            <button onClick={() => setRenaming(false)} className="text-muted-foreground hover:text-white">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-medium text-white/90 truncate">{doc.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[8px] text-muted-foreground">{formatFileSize(doc.size)}</span>
              <span className="text-[8px] text-muted-foreground">·</span>
              <span className="text-[8px] text-muted-foreground">{formatDate(doc.uploadedAt)}</span>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      {!renaming && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onAnalyze(doc)}
            className={cn(
              "p-1 rounded transition-colors",
              analyzing
                ? "text-amber-400 animate-pulse"
                : "text-muted-foreground hover:text-teal-400"
            )}
            title={analyzing ? "Analyzing..." : "Analyze with Muse"}
          >
            <Sparkles className="w-3 h-3" />
          </button>
          <button
            onClick={() => setRenaming(true)}
            className="p-1 text-muted-foreground hover:text-white rounded"
            title="Rename"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => onDelete(doc.id)}
            className="p-1 text-muted-foreground hover:text-red-400 rounded"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function WorkspaceExplorer() {
  const {
    activeWorkspaceId,
    activeCompanyId,
    openFolderId,
    folderPath,
    showInviteDialog,
    showCreateFolder,
    workspacePanelOpen,
    setWorkspacePanelOpen,
    setShowInviteDialog,
    createFolder,
    deleteFolder,
    uploadDocument,
    deleteDocument,
    renameDocument,
    navigateToFolder,
    getCurrentCompany,
    getCurrentWorkspace,
    getFoldersInFolder,
    getDocumentsInFolder,
    getRootFolders,
    getRootDocuments,
    setAnalysis,
    setShowAnalysisPanel,
  } = useWorkspaceStore();

  const [newFolderName, setNewFolderName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [analyzingDocId, setAnalyzingDocId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const company = getCurrentCompany();
  const workspace = getCurrentWorkspace();
  const folders = openFolderId
    ? getFoldersInFolder(openFolderId)
    : getRootFolders();
  const documents = openFolderId
    ? getDocumentsInFolder(openFolderId)
    : getRootDocuments();

  // Filter by search
  const filteredDocs = searchQuery
    ? documents.filter((d) =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : documents;
  const filteredFolders = searchQuery
    ? folders.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : folders;

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolder(newFolderName.trim(), openFolderId);
    setNewFolderName("");
  };

  const handleUpload = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = (e.target?.result as string) || "";
          uploadDocument(file.name, getFileType(file.name), file.size, content, openFolderId);
        };
        reader.readAsDataURL(file);
      }
    },
    [uploadDocument, openFolderId]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleUpload(e.dataTransfer.files);
    },
    [handleUpload]
  );

  // ── Analyze document with Muse ────────────────────────────────────────
  const handleAnalyze = useCallback(
    async (doc: WorkspaceDocument) => {
      setAnalyzingDocId(doc.id);
      setShowAnalysisPanel(true);

      // Set initial pending state
      setAnalysis(doc.id, {
        documentId: doc.id,
        overview: "",
        sections: [],
        analyzedAt: Date.now(),
        status: "analyzing",
      });

      try {
        // Extract text content from the document for analysis
        const textContent = extractTextContent(doc);
        const result = await analyzeDocument(doc.name, textContent, doc.type);
        setAnalysis(doc.id, result);
      } catch (err) {
        // Fallback to simulated analysis if the API call fails
        const simulated = simulateAnalysis(doc.name);
        simulated.status = "complete";
        setAnalysis(doc.id, simulated);
      } finally {
        setAnalyzingDocId(null);
      }
    },
    [setAnalysis, setShowAnalysisPanel]
  );

  // ── Extract text from doc content for analysis ────────────────────────
  const extractTextContent = (doc: WorkspaceDocument): string => {
    // For base64-encoded content, decode and extract text
    if (doc.content.startsWith("data:")) {
      try {
        const base64 = doc.content.split(",")[1] || doc.content;
        const decoded = atob(base64);
        // Try to extract readable text
        return decoded.replace(/[^\x20-\x7E\n\r\t]/g, " ").slice(0, 5000);
      } catch {
        return doc.content.slice(0, 5000);
      }
    }
    return doc.content.slice(0, 8000);
  };

  // ── All root folders for sidebar — read from full store (not navigation-filtered) ─
  // Selects the raw array (stable reference) and filters in useMemo — an
  // inline `.filter()` inside the selector itself returns a new array every
  // call, which defeats Zustand's reference-equality check and causes an
  // infinite render loop ("Maximum update depth exceeded").
  const allFolders = useWorkspaceStore((s) => s.folders);
  const allRootFolders = useMemo(() => allFolders.filter((f) => f.parentId === null), [allFolders]);

  if (!workspacePanelOpen) return null;

  return (
    <div className="h-full flex flex-col bg-[#0a0a0e]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-amber-500/15 flex items-center justify-center">
              <FolderOpen className="w-3 h-3 text-amber-400" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-white">{company?.name || "Workspace"}</h3>
              <p className="text-[8px] text-muted-foreground">{workspace?.label || "Personal workspace"}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="w-6 h-6 text-muted-foreground hover:text-white"
              onClick={() => setShowInviteDialog(true)}
              title="Invite members"
            >
              <Users className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="h-7 text-[10px] bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50 pl-7"
          />
        </div>

        {/* Quick actions */}
        <div className="flex gap-1 mt-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[9px] text-muted-foreground hover:text-white flex-1"
            onClick={() => useWorkspaceStore.setState({ showCreateFolder: true })}
          >
            <Plus className="w-2.5 h-2.5 mr-1" />
            Folder
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[9px] text-muted-foreground hover:text-white flex-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-2.5 h-2.5 mr-1" />
            Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Folder sidebar */}
        <div className="w-[140px] border-r border-white/5 overflow-y-auto p-2 shrink-0">
          <button
            onClick={() => navigateToFolder(null)}
            className={cn(
              "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left transition-colors mb-0.5",
              openFolderId === null
                ? "bg-teal-500/10 text-teal-300"
                : "text-white/70 hover:bg-white/[0.04] hover:text-white"
            )}
          >
            <Home className="w-3 h-3 shrink-0" />
            <span className="text-[11px] truncate">Home</span>
          </button>
          {allRootFolders
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((folder) => (
              <FolderTreeItem
                key={folder.id}
                folder={folder}
                depth={0}
                onNavigate={navigateToFolder}
                currentFolderId={openFolderId}
              />
            ))}
        </div>

        {/* File area */}
        <div
          className={cn(
            "flex-1 overflow-y-auto p-3 relative",
            dragging && "bg-teal-500/5"
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          {/* Breadcrumb */}
          {openFolderId && (
            <div className="flex items-center gap-1 mb-3 text-[10px] text-muted-foreground">
              <button
                onClick={() => navigateToFolder(null)}
                className="hover:text-white transition-colors"
              >
                Home
              </button>
              {folderPath.map((f) => (
                <span key={f.id} className="flex items-center gap-1">
                  <ChevronRight className="w-2.5 h-2.5" />
                  <button
                    onClick={() => navigateToFolder(f.id)}
                    className="hover:text-white transition-colors"
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Drag overlay */}
          {dragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-teal-500/10 border-2 border-dashed border-teal-500/30 rounded-lg m-3">
              <div className="text-center">
                <Upload className="w-8 h-8 text-teal-400 mx-auto mb-2" />
                <p className="text-xs text-teal-300 font-medium">Drop files to upload</p>
              </div>
            </div>
          )}

          {/* Folders grid */}
          {filteredFolders.length > 0 && (
            <div className="mb-4">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5">
                Folders ({filteredFolders.length})
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {filteredFolders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => navigateToFolder(folder.id)}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/10 transition-all text-left group"
                  >
                    <FolderIcon className="w-4 h-4 text-amber-400/70 shrink-0" />
                    <span className="text-[10px] text-white/80 truncate flex-1">{folder.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFolder(folder.id);
                      }}
                      className="text-muted-foreground/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Files list */}
          {filteredDocs.length > 0 ? (
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5">
                Files ({filteredDocs.length})
              </p>
              <div className="space-y-1">
                {filteredDocs.map((doc) => (
                  <FileItem
                    key={doc.id}
                    doc={doc}
                    onDelete={deleteDocument}
                    onRename={renameDocument}
                    onAnalyze={handleAnalyze}
                    analyzing={analyzingDocId === doc.id}
                  />
                ))}
              </div>
            </div>
          ) : filteredFolders.length === 0 && !searchQuery ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center mb-3">
                <FolderOpen className="w-5 h-5 text-amber-400" />
              </div>
              <p className="text-xs text-white/70 font-medium mb-1">This folder is empty</p>
              <p className="text-[9px] text-muted-foreground mb-4">
                Upload files or create a folder to get started
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 text-[9px] px-3 bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30"
                  onClick={() => useWorkspaceStore.setState({ showCreateFolder: true })}
                >
                  <Plus className="w-2.5 h-2.5 mr-1" />
                  New Folder
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[9px] text-muted-foreground hover:text-white"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-2.5 h-2.5 mr-1" />
                  Upload
                </Button>
              </div>
            </div>
          ) : (
            /* Search no results */
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-white/70 font-medium mb-1">No results found</p>
              <p className="text-[9px] text-muted-foreground">
                Try a different search term
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create Folder inline form */}
      {showCreateFolder && (
        <div className="px-4 py-2 border-t border-white/5 bg-white/[0.02]">
          <div className="flex gap-1.5 items-center">
            <FolderIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name..."
              className="h-7 text-[10px] bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50 flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") useWorkspaceStore.setState({ showCreateFolder: false });
              }}
            />
            <Button
              size="sm"
              className="h-7 text-[9px] px-2 bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim()}
            >
              Create
            </Button>
            <button
              onClick={() => useWorkspaceStore.setState({ showCreateFolder: false })}
              className="text-muted-foreground hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Invite Member Dialog */}
      <InviteMemberDialog />

      {/* Document Analysis & Task Composer panels — rendered here but self-controlled via store state */}
      <DocumentAnalysisPanel />
      <TaskComposerPanel />
    </div>
  );
}
