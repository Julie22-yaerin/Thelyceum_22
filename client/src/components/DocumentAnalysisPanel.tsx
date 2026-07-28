/**
 * DocumentAnalysisPanel — The Lyceum
 *
 * Displays the results of Muse Spark 1.1 document analysis:
 *   - Document overview
 *   - Sections with expandable content groups
 *   - Each content group has a "Create Task" button that opens the TaskComposer
 *
 * When the user clicks "Create Task", the selected content group's
 * pinned content is sent to the TaskComposerPanel for specification.
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  X,
  FileText,
  Sparkles,
  Send,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Brain,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  useWorkspaceStore,
  type DocAnalysis,
  type DocumentSection,
  type ContentGroup,
} from "@/store/useWorkspaceStore";

// ── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({
  section,
  documentId,
  onSelectGroup,
}: {
  section: DocumentSection;
  documentId: string;
  onSelectGroup: (docId: string, groupId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-white/5 rounded-lg overflow-hidden bg-white/[0.02]">
      {/* Section header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-white/90 truncate">{section.title}</p>
          <p className="text-[8px] text-muted-foreground mt-0.5 line-clamp-1">{section.summary}</p>
        </div>
        <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-muted-foreground border-white/5 shrink-0">
          {section.groups.length} group{section.groups.length !== 1 ? "s" : ""}
        </Badge>
      </button>

      {/* Content groups */}
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {section.groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              documentId={documentId}
              onSelect={onSelectGroup}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Content Group Card ───────────────────────────────────────────────────────

function GroupCard({
  group,
  documentId,
  onSelect,
}: {
  group: ContentGroup;
  documentId: string;
  onSelect: (docId: string, groupId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-white/5 rounded-md bg-white/[0.01] overflow-hidden hover:border-white/10 transition-colors">
      {/* Group header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="w-4 h-4 rounded bg-white/[0.03] flex items-center justify-center shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-teal-400" />
        </div>
        <span className="text-[10px] text-white/80 flex-1 truncate">{group.title}</span>
        <div className="flex items-center gap-1 shrink-0">
          {group.topics.slice(0, 2).map((topic) => (
            <Badge
              key={topic}
              variant="outline"
              className="text-[6px] h-3 px-1 text-muted-foreground border-white/5"
            >
              {topic}
            </Badge>
          ))}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-2.5 pb-2 space-y-2">
          <div className="bg-white/[0.03] rounded px-2 py-1.5">
            <p className="text-[9px] text-white/70 leading-relaxed">{group.content}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {group.suggestedAgentRole && (
              <Badge
                variant="outline"
                className="text-[7px] h-4 px-1.5 text-teal-400 border-teal-500/20 bg-teal-500/5"
              >
                <Brain className="w-2 h-2 mr-0.5" />
                {group.suggestedAgentRole}
              </Badge>
            )}
            <Button
              size="sm"
              className="h-6 text-[8px] px-2 ml-auto bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30"
              onClick={() => onSelect(documentId, group.id)}
            >
              <Send className="w-2.5 h-2.5 mr-1" />
              Create Task
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export default function DocumentAnalysisPanel() {
  const {
    analyses,
    selectedDocumentId,
    showAnalysisPanel,
    setShowAnalysisPanel,
    setSelectedGroup,
  } = useWorkspaceStore();

  const analysis = selectedDocumentId ? analyses[selectedDocumentId] : null;

  if (!showAnalysisPanel || !analysis) return null;

  const handleSelectGroup = (docId: string, groupId: string) => {
    setSelectedGroup(docId, groupId);
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0e]">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-teal-500/15 flex items-center justify-center">
            {analysis.status === "complete" ? (
              <CheckCircle2 className="w-3 h-3 text-teal-400" />
            ) : analysis.status === "error" ? (
              <AlertCircle className="w-3 h-3 text-red-400" />
            ) : (
              <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
            )}
          </div>
          <div>
            <h4 className="text-[10px] font-medium text-white/90">Document Analysis</h4>
            <p className="text-[7px] text-muted-foreground">
              {analysis.status === "complete"
                ? `${analysis.sections.length} sections · ${analysis.sections.reduce((s, sec) => s + sec.groups.length, 0)} content groups`
                : analysis.status === "error"
                  ? "Analysis failed"
                  : "Analyzing..."}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAnalysisPanel(false)}
          className="text-muted-foreground hover:text-white"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Status indicator */}
          {analysis.status === "analyzing" && (
            <div className="flex items-center gap-2 text-[10px] text-amber-400 bg-amber-500/5 border border-amber-500/10 rounded-lg px-3 py-2">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              Muse Spark 1.1 is analyzing the document structure...
            </div>
          )}

          {analysis.status === "error" && (
            <div className="flex items-center gap-2 text-[10px] text-red-400 bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-3 h-3 shrink-0" />
              {analysis.error || "Analysis failed. The file may be too large or in an unsupported format."}
            </div>
          )}

          {analysis.status === "complete" && (
            <>
              {/* Overview */}
              <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-lg px-3 py-2">
                <p className="text-[8px] text-indigo-400 uppercase tracking-wider mb-1">Overview</p>
                <p className="text-[10px] text-white/70 leading-relaxed">{analysis.overview}</p>
              </div>

              {/* Sections */}
              <div className="space-y-1.5">
                <p className="text-[8px] text-muted-foreground uppercase tracking-wider px-0.5">
                  Extracted Sections ({analysis.sections.length})
                </p>
                {analysis.sections.map((section) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    documentId={selectedDocumentId!}
                    onSelectGroup={handleSelectGroup}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
