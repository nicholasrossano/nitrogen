#!/usr/bin/env python3
"""Split frontend/src/lib/api.ts into api/ package modules."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API_TS = ROOT / "frontend/src/lib/api.ts"
OUT_DIR = ROOT / "frontend/src/lib/api"
SOURCE = Path("/tmp/original_api.ts")

PROJECT_METHODS = {
    "listProjects", "createProject", "listProjectFindings", "promoteFinding", "getProject",
    "listAssessmentInstances", "createAssessmentInstance", "deleteAssessmentInstance",
    "restoreAssessmentInstance", "permanentlyDeleteAssessmentInstance", "updateProject",
    "generateProjectOverview", "deleteProject", "permanentlyDeleteProject", "restoreProject",
    "confirmProject", "getMemo", "exportMemo", "downloadExport", "getTools",
    "getRecommendedTools", "selectTools", "updateToolInputs", "getProjectPlan",
    "getProjectHealth", "refreshProjectHealth", "overrideProjectHealthDimension",
    "generateProjectPlan", "updatePlanItemStatus", "addPlanItem", "deletePlanItem",
    "deletePlanElement", "deepDiveItem",
}
WORKSPACE_METHODS = {
    "listWorkspaces", "createWorkspace", "getWorkspace", "updateWorkspace",
    "addWorkspaceMember", "removeWorkspaceMember", "listWorkspaceKnowledgeBanks",
    "createWorkspaceKnowledgeBank", "updateWorkspaceKnowledgeBank",
    "reindexWorkspaceKnowledgeBank", "deleteWorkspaceKnowledgeBank", "deleteWorkspace",
    "uploadWorkspaceEvidence", "getWorkspaceEvidence", "importWorkspaceFromDrive",
}
EVIDENCE_METHODS = {
    "uploadEvidence", "pasteEvidence", "getEvidence", "getEvidenceContent",
    "getEvidenceChunks", "getEvidenceChunk", "deleteEvidence", "getMaterials",
    "deleteMaterial", "getProjectFiles", "downloadDeliverable", "deleteGeneratedFile",
    "downloadMaterial", "downloadEvidence", "getEvidenceFileBytes", "getMaterialFileBytes",
    "getEvidenceChunkPreviewBytes", "getCorpusFileBytes", "exportChecklist",
    "getGoogleAuthUrl", "getGoogleDriveStatus", "getGoogleDriveAccessToken",
    "disconnectGoogleDrive", "importFromDrive", "getDriveLinkedFiles", "syncDriveFiles",
    "unlinkDriveFile",
}
CHAT_METHODS = {
    "updateMessageWidget", "getChats", "getChatMessages", "getChatAssessments",
    "associateChatAssessment", "deleteChat", "setChatMessageFeedback", "updateChatTitle",
    "saveChatFromMessages", "sendChatStream", "generateChatTitle",
}
SHARING_METHODS = {"searchUsers", "getShares", "createShare", "updateShare", "deleteShare"}
BILLING_METHODS = {
    "getBillingStatus", "createCheckout", "createPortalSession", "redeemAccessCode",
    "listApiKeys", "storeApiKey", "deleteApiKey",
}


def categorize(name: str) -> str:
    if name in PROJECT_METHODS:
        return "projects"
    if name in WORKSPACE_METHODS:
        return "workspaces"
    if name in EVIDENCE_METHODS:
        return "evidence"
    if name in CHAT_METHODS:
        return "chat"
    if name in SHARING_METHODS:
        return "sharing"
    if name in BILLING_METHODS:
        return "billing"
    return "assessments"


def exported_type_names(types_content: str) -> list[str]:
    return re.findall(r"^export (?:interface|type) (\w+)", types_content, re.MULTILINE)


def types_used_in(text: str, type_names: list[str]) -> list[str]:
    return [name for name in type_names if re.search(rf"\b{re.escape(name)}\b", text)]


def parse_api_methods(api_block: str) -> dict[str, str]:
    """Extract top-level api object methods from line-anchored patterns."""
    method_starts: list[tuple[str, int, int]] = []

    for match in re.finditer(r"(?m)^  async ([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", api_block):
        line_start = api_block.rfind("\n", 0, match.start()) + 1
        method_starts.append((match.group(1), line_start, line_start + 2))

    async_lines = {api_block.rfind("\n", 0, m.start()) + 1 for m in re.finditer(r"(?m)^  async ", api_block)}

    for match in re.finditer(r"(?m)^  ([a-zA-Z_][a-zA-Z0-9_]*)\s*:", api_block):
        line_start = api_block.rfind("\n", 0, match.start()) + 1
        if line_start in async_lines:
            continue
        colon = match.end() - 1
        value_start = colon + 1
        while value_start < len(api_block) and api_block[value_start] in " \t\n":
            value_start += 1
        method_starts.append((match.group(1), line_start, value_start))

    method_starts.sort(key=lambda item: item[1])

    methods: dict[str, str] = {}
    for idx, (name, line_start, value_start) in enumerate(method_starts):
        end = method_starts[idx + 1][1] if idx + 1 < len(method_starts) else len(api_block)
        body = api_block[value_start:end].rstrip()
        if body.endswith(","):
            body = body[:-1].rstrip()
        methods[name] = body
    return methods


def main() -> None:
    text = SOURCE.read_text()
    lines = text.splitlines(keepends=True)

    type_start = next(i for i, line in enumerate(lines) if line.startswith("export interface Project"))
    client_start = next(i for i, line in enumerate(lines) if line.startswith("async function fetchApi"))
    types_content = "".join(lines[type_start:client_start]).rstrip() + "\n"

    header = "".join(lines[:type_start]).rstrip() + "\n"
    client_middle = "".join(lines[client_start: next(i for i, line in enumerate(lines) if line.startswith("export const api = {"))]).rstrip() + "\n"

    api_start = next(i for i, line in enumerate(lines) if line.startswith("export const api = {"))
    api_end = next(
        i for i, line in enumerate(lines)
        if i > api_start and line.rstrip("\n") == "};" and not line.startswith(" ")
    )
    api_block = "".join(lines[api_start + 1 : api_end])

    methods = parse_api_methods(api_block)
    trigger_body = methods.pop("triggerBlobDownload", None)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    client_ts = header
    client_ts = client_ts.replace("async function getAuthToken", "export async function getAuthToken")
    client_ts = client_ts.replace("async function fetchApi", "export async function fetchApi")
    client_ts = client_ts.replace("async function fetchApiWithTimeout", "export async function fetchApiWithTimeout")
    client_ts = client_ts.replace("function workflowVersionHeaders", "export function workflowVersionHeaders")
    client_ts += "\nexport const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';\n"
    client_ts += client_middle.replace("const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';", "")
    if trigger_body:
        client_ts += f"\nexport function triggerBlobDownload(blob: Blob, filename: string) {{\n  {trigger_body}\n}}\n"
    (OUT_DIR / "client.ts").write_text(client_ts)
    (OUT_DIR / "types.ts").write_text(types_content)

    all_types = exported_type_names(types_content)
    module_names = ["projects", "workspaces", "evidence", "chat", "assessments", "sharing", "billing"]
    grouped: dict[str, list[tuple[str, str]]] = {name: [] for name in module_names}
    for name, body in methods.items():
        grouped[categorize(name)].append((name, body))

    for module in module_names:
        entries = grouped[module]
        module_text = "\n".join(body for _, body in entries)
        used_types = types_used_in(module_text, all_types)
        type_import = ""
        if used_types:
            type_import = "import type {\n  " + ",\n  ".join(used_types) + ",\n} from './types';\n"
        extra_import = "import { debugChatFlow } from '@/lib/chatDebug';\n" if module == "chat" else ""
        parts = [
            "import {",
            "  API_URL,",
            "  fetchApi,",
            "  fetchApiWithTimeout,",
            "  getAuthToken,",
            "  triggerBlobDownload,",
            "  workflowVersionHeaders,",
            "} from './client';",
            type_import,
            extra_import,
            "",
            f"export const {module}Api = {{",
        ]
        for name, body in entries:
            if body.startswith(f"async {name}"):
                parts.append(f"  {body},")
            else:
                parts.append(f"  {name}: {body},")
        parts.append("};\n")
        (OUT_DIR / f"{module}.ts").write_text("\n".join(parts))

    (OUT_DIR / "index.ts").write_text(
        """export * from './types';
export {
  API_URL,
  fetchApi,
  fetchApiWithTimeout,
  getAuthToken,
  triggerBlobDownload,
  workflowVersionHeaders,
} from './client';
import { triggerBlobDownload } from './client';
import { projectsApi } from './projects';
import { workspacesApi } from './workspaces';
import { evidenceApi } from './evidence';
import { chatApi } from './chat';
import { assessmentsApi } from './assessments';
import { sharingApi } from './sharing';
import { billingApi } from './billing';

export const api = {
  ...projectsApi,
  ...workspacesApi,
  ...evidenceApi,
  ...chatApi,
  ...assessmentsApi,
  ...sharingApi,
  ...billingApi,
  triggerBlobDownload,
};
"""
    )
    API_TS.write_text("export * from './api/index';\nexport { api } from './api/index';\n")
    print(f"Parsed {len(methods)} methods (+ triggerBlobDownload)")
    for module in module_names:
        print(f"  {module}: {len(grouped[module])} methods")


if __name__ == "__main__":
    main()
