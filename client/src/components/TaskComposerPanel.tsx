/**
 * TaskComposerPanel — The Lyceum
 *
 * The user crafts a precise AI task specification:
 *   1. Pinned content region (from Muse document analysis)
 *   2. Action requirements (bullet points — what to do)
 *   3. Output requirements (bullet points — expected format)
 *   4. Input requirements (bullet points — research needed, optional)
 *   5. Target AI agent selection (from the workforce canvas)
 *   6. Dispatch to agent
 *
 * This ensures the AI agent receives exactly the content it needs
 * without re-reading the entire document.
 */

import { useState, useMemo } from "react";
import {
  X,
  Send,
  Plus,
  Trash2,
  Target,
  FileText,
  Brain,
  ListTodo,
  Download,
  Search,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  useWorkspaceStore,
  type ContentGroup,
  type DocAnalysis,
} from "@/store/useWorkspaceStore";
import { useWorkforceStore } from "@/store/useWorkforceStore";

// ── Bullet List Editor ───────────────────────────────────────────────────────

function BulletListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    if (!input.trim()) return;
    onChange([...items, input.trim()]);
    setInput("");
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 group">
          <div className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
          <span className="text-[9px] text-ws-text-soft flex-1 leading-relaxed">{item}</span>
          <button
            onClick={() => handleRemove(i)}
            className="text-muted-foreground/50 hover:text-red-800 opacity-0 group-hover:opacity-100 transition-all"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-1 pt-0.5">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          className="h-6 text-[9px] bg-ws-subtle border-ws-border text-ws-text placeholder:text-muted-foreground/50 flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-ws-text"
          onClick={handleAdd}
          disabled={!input.trim()}
        >
          <Plus className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Agent Selector ───────────────────────────────────────────────────────────

function AgentSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (agentId: string) => void;
}) {
  const nodes = useWorkforceStore((s) => s.nodes);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = search
    ? nodes.filter(
        (n) =>
          n.data.label.toLowerCase().includes(search.toLowerCase()) ||
          n.data.role.toLowerCase().includes(search.toLowerCase()) ||
          n.id.toLowerCase().includes(search.toLowerCase())
      )
    : nodes;

  const selected = nodes.find((n) => n.id === value);

  return (
    <div className="relative">
      <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-1">Target Agent</p>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-colors",
          "bg-ws-subtle border border-ws-border hover:border-ws-border",
          !value && "text-muted-foreground"
        )}
      >
        <Target className="w-3 h-3 text-indigo-700 shrink-0" />
        <span className="text-[10px] flex-1 truncate">
          {selected
            ? `${selected.data.label} — ${selected.data.role}`
            : "Select an AI agent..."}
        </span>
        {selected && (
          <Badge
            variant="outline"
            className={cn(
              "text-[7px] h-3.5 px-1 border-ws-border",
              selected.data.status === "AWAKE_WORKING"
                ? "text-green-700"
                : selected.data.status === "DROWSY_WARNING"
                  ? "text-yellow-700"
                  : "text-red-700"
            )}
          >
            {selected.data.status === "AWAKE_WORKING"
              ? "Active"
              : selected.data.status === "DROWSY_WARNING"
                ? "Low"
                : "Strike"}
          </Badge>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-md border border-ws-border bg-ws-hover shadow-2xl overflow-hidden">
            <div className="p-1.5">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agents..."
                className="h-7 text-[9px] bg-ws-subtle border-ws-border text-ws-text placeholder:text-muted-foreground/50 mb-1"
                autoFocus
              />
              <ScrollArea className="max-h-36">
                {filtered.length === 0 ? (
                  <p className="text-[9px] text-muted-foreground text-center py-3">
                    No agents found
                  </p>
                ) : (
                  filtered.map((node) => (
                    <button
                      key={node.id}
                      onClick={() => {
                        onChange(node.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors",
                        node.id === value
                          ? "bg-teal-50 text-teal-700"
                          : "hover:bg-ws-hover text-ws-text"
                      )}
                    >
                      <div
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          node.data.status === "AWAKE_WORKING"
                            ? "bg-green-400"
                            : node.data.status === "DROWSY_WARNING"
                              ? "bg-yellow-400"
                              : "bg-red-400"
                        )}
                      />
                      <span className="text-[10px] flex-1 truncate">{node.data.label}</span>
                      <span className="text-[7px] text-muted-foreground truncate max-w-[80px]">
                        {node.data.role}
                      </span>
                      {node.id === value && (
                        <Check className="w-2.5 h-2.5 text-teal-700 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </ScrollArea>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export default function TaskComposerPanel() {
  const {
    analyses,
    selectedDocumentId,
    selectedGroupId,
    showTaskComposer,
    setShowTaskComposer,
    setSelectedGroup,
    createTaskSpec,
    dispatchTask,
  } = useWorkspaceStore();

  const [actionRequirements, setActionRequirements] = useState<string[]>([
    "Extract and summarize the key data points",
    "Format the results as structured JSON",
  ]);
  const [outputRequirements, setOutputRequirements] = useState<string[]>([
    "Return valid JSON with clear field names",
    "Include confidence scores where applicable",
  ]);
  const [inputRequirements, setInputRequirements] = useState<string[]>([
    "Cross-reference with company policy if applicable",
  ]);
  const [targetAgentId, setTargetAgentId] = useState("");
  const [dispatched, setDispatched] = useState(false);

  const analysis = selectedDocumentId ? analyses[selectedDocumentId] : null;
  const group: ContentGroup | undefined = useMemo(() => {
    if (!analysis || !selectedGroupId) return undefined;
    for (const section of analysis.sections) {
      const found = section.groups.find((g) => g.id === selectedGroupId);
      if (found) return found;
    }
    return undefined;
  }, [analysis, selectedGroupId]);

  if (!showTaskComposer || !group) return null;

  const handleDispatch = () => {
    if (!targetAgentId) return;

    createTaskSpec({
      documentId: selectedDocumentId!,
      groupId: group.id,
      pinnedContent: group.content,
      actionRequirements,
      outputRequirements,
      inputRequirements,
      targetAgentId,
    });

    setDispatched(true);
    setTimeout(() => {
      setDispatched(false);
      setShowTaskComposer(false);
      setTargetAgentId("");
    }, 1500);
  };

  return (
    <div className="h-full flex flex-col bg-ws-bg">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-ws-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-indigo-100 flex items-center justify-center">
            <Send className="w-3 h-3 text-indigo-700" />
          </div>
          <div>
            <h4 className="text-[10px] font-medium text-ws-text">Task Composer</h4>
            <p className="text-[7px] text-muted-foreground">
              {group.title} · {group.topics.join(", ")}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowTaskComposer(false)}
          className="text-muted-foreground hover:text-ws-text"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Pinned Content */}
          <div>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <FileText className="w-2.5 h-2.5" />
              Pinned Content Region
            </p>
            <div className="bg-ws-subtle border border-ws-border rounded-md px-2.5 py-2">
              <p className="text-[9px] text-ws-text-soft leading-relaxed">
                {group.content}
              </p>
            </div>
          </div>

          <Separator className="bg-ws-subtle" />

          {/* Action Requirements */}
          <div>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <ListTodo className="w-2.5 h-2.5" />
              Action Requirements
            </p>
            <BulletListEditor
              items={actionRequirements}
              onChange={setActionRequirements}
              placeholder="Add requirement..."
            />
          </div>

          {/* Output Requirements */}
          <div>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Download className="w-2.5 h-2.5" />
              Output Requirements
            </p>
            <BulletListEditor
              items={outputRequirements}
              onChange={setOutputRequirements}
              placeholder="Add output spec..."
            />
          </div>

          {/* Input Requirements */}
          <div>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Search className="w-2.5 h-2.5" />
              Input / Research Requirements
              <span className="text-[6px] text-muted-foreground">(optional)</span>
            </p>
            <BulletListEditor
              items={inputRequirements}
              onChange={setInputRequirements}
              placeholder="Add research requirement..."
            />
          </div>

          <Separator className="bg-ws-subtle" />

          {/* Target Agent */}
          <AgentSelector value={targetAgentId} onChange={setTargetAgentId} />

          {/* Suggested agent badge */}
          {group.suggestedAgentRole && (
            <div className="bg-teal-50 border border-teal-200 rounded-md px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <Brain className="w-3 h-3 text-teal-700" />
                <span className="text-[9px] text-teal-700">
                  Suggested: <strong>{group.suggestedAgentRole}</strong>
                </span>
              </div>
            </div>
          )}

          {/* Dispatch button */}
          <Button
            className={cn(
              "w-full h-8 text-[10px] transition-all",
              dispatched
                ? "bg-green-100 text-green-700 border border-green-200"
                : targetAgentId
                  ? "bg-indigo-500 hover:bg-indigo-600 text-white"
                  : "bg-ws-subtle text-muted-foreground cursor-not-allowed"
            )}
            onClick={handleDispatch}
            disabled={!targetAgentId || dispatched}
          >
            {dispatched ? (
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                Dispatched to Agent!
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" />
                Dispatch to AI Agent
              </span>
            )}
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
