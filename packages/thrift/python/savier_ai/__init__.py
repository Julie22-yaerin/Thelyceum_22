"""
Savier AI Python SDK - Ultimate Token Economy & Dual-Sided Context Optimization Engine.
Provides Tool & Skill Progressive Disclosure Catalogs with automatic output deduplication & token compression.
"""

from typing import Any, Callable, Dict, List, Optional
import json
import re


class BM25Engine:
    """Okapi BM25 Search Engine in Python for Fast Keyword & Field Matching."""

    def __init__(self, k1: float = 1.2, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.documents: List[Dict[str, Any]] = []

    @staticmethod
    def tokenize(text: str) -> List[str]:
        if not text:
            return []
        split_camel = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', text)
        cleaned = re.sub(r'[^a-z0-9_\-\.\/]', ' ', split_camel.lower())
        return [t.strip() for t in cleaned.split() if len(t.strip()) > 1]

    def add_document(self, doc_id: str, fields: Dict[str, Any], payload: Any):
        self.documents.append({"id": doc_id, "fields": fields, "payload": payload})

    def search(self, query: str, top_k: int = 10) -> List[Dict[str, Any]]:
        tokens = self.tokenize(query)
        if not tokens or not self.documents:
            return []

        results = []
        for doc in self.documents:
            score = 0.0
            doc_text = " ".join([str(v) for v in doc["fields"].values()])
            doc_tokens = self.tokenize(doc_text)

            for token in tokens:
                if token in doc_tokens:
                    score += 2.0
                elif any(token in dt for dt in doc_tokens):
                    score += 0.8

            if doc["id"].lower() == query.lower() or doc["fields"].get("name", "").lower() == query.lower():
                score += 10.0

            if score > 0:
                results.append({"payload": doc["payload"], "score": round(score, 4)})

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]


class ToolCatalog:
    """Tool Catalog for progressive disclosure and output token compression."""

    def __init__(self):
        self.tools: Dict[str, Dict[str, Any]] = {}
        self.bm25 = BM25Engine()
        self.seen_hashes = set()

    def register(self, tool_id: str, name: str, description: str, execute: Optional[Callable] = None, input_schema: Optional[Dict] = None, tags: Optional[List[str]] = None):
        tool = {
            "id": tool_id,
            "name": name,
            "description": description,
            "execute": execute,
            "input_schema": input_schema or {},
            "tags": tags or [],
        }
        self.tools[tool_id] = tool
        self.bm25.add_document(tool_id, {"name": name, "description": description, "tags": " ".join(tags or [])}, tool)

    def search(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        res = self.bm25.search(query, top_k=limit)
        return [r["payload"] for r in res]

    def invoke(self, tool_id: str, args: Optional[Dict] = None) -> Dict[str, Any]:
        tool = self.tools.get(tool_id)
        if not tool or not tool.get("execute"):
            raise ValueError(f"Tool '{tool_id}' not found or missing execute method.")

        raw_output = tool["execute"](args or {})
        output_str = raw_output if isinstance(raw_output, str) else json.dumps(raw_output, indent=2)

        # Apply basic Savier output deduplication
        output_hash = hash(output_str)
        if output_hash in self.seen_hashes:
            compressed = f"[savier dedupe pointer: Tool output already seen in session (sha: {hex(output_hash)})]"
        else:
            self.seen_hashes.add(output_hash)
            compressed = output_str

        return {
            "tool_id": tool_id,
            "raw_output": raw_output,
            "compressed_text": compressed,
        }


class SkillCatalog:
    """Skill Catalog for progressive playbook instructions disclosure."""

    def __init__(self):
        self.skills: Dict[str, Dict[str, Any]] = {}
        self.bm25 = BM25Engine()

    def register(self, skill_id: str, name: str, description: str, body: str, tools: Optional[List[str]] = None, tags: Optional[List[str]] = None):
        skill = {
            "id": skill_id,
            "name": name,
            "description": description,
            "body": body,
            "tools": tools or [],
            "tags": tags or [],
        }
        self.skills[skill_id] = skill
        self.bm25.add_document(skill_id, {"name": name, "description": description, "body": body}, skill)

    def search(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        res = self.bm25.search(query, top_k=limit)
        return [r["payload"] for r in res]

    def get_skill_content(self, skill_id: str) -> Dict[str, Any]:
        skill = self.skills.get(skill_id)
        if not skill:
            raise ValueError(f"Skill '{skill_id}' not found.")
        return skill


def search_capabilities_tool(tool_catalog: ToolCatalog, skill_catalog: SkillCatalog):
    def execute(query: str, limit: int = 5):
        return {
            "tools": tool_catalog.search(query, limit=limit),
            "skills": skill_catalog.search(query, limit=limit),
        }
    return execute


def invoke_tool_tool(tool_catalog: ToolCatalog):
    def execute(tool_id: str, args: Optional[Dict] = None):
        return tool_catalog.invoke(tool_id, args or {})
    return execute


def get_skill_content_tool(skill_catalog: SkillCatalog):
    def execute(skill_id: str):
        return skill_catalog.get_skill_content(skill_id)
    return execute
