# Data isolation and collaboration model

Nitrogen uses **pooled multi-tenancy**: a workspace is an organizational shell (templates, guidance, knowledge banks, billing settings). **Project access is separate from workspace membership.**

## Who can see a project

A user can list or open a project only if they are:

1. The **project creator**, or
2. Explicitly invited via **ProjectShare** (editor or viewer role)

Workspace members do **not** automatically see every project in that workspace unless `SINGLE_ORG_MODE=true` (legacy self-hosted behavior).

## Workspaces

| Mode | Default workspace for new users | Project visibility |
|------|--------------------------------|--------------------|
| Hosted multi-tenant (`SINGLE_ORG_MODE=false`) | Personal workspace | Creator + shares only |
| Legacy single org (`SINGLE_ORG_MODE=true`) | Shared company workspace | All workspace members |

## External collaborators (POCs)

External users are invited with **ProjectShare**, not workspace membership. They:

- Can access shared projects only
- Do **not** receive workspace guidance or knowledge-bank RAG (retrieval checks workspace membership)
- Appear under **Shared with you** in the personal-workspace sidebar when the project lives in another workspace

## AI retrieval boundaries

- **Project evidence / materials**: scoped to projects the user can access
- **Workspace knowledge banks**: only for workspace **members**
- **Corpus**: removed (no longer a retrieval source)

## Authentication

- Firebase ID tokens on all API and MCP HTTP routes
- No dev HTTP auth bypass on MCP
- Google Drive OAuth tokens encrypted at rest (`API_KEY_ENCRYPTION_KEY`)

## Related configuration

```env
SINGLE_ORG_MODE=false   # default; set true for legacy shared-company behavior
API_KEY_ENCRYPTION_KEY= # Fernet key for OAuth token encryption
```
