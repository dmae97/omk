# Source contract

- Repository: https://github.com/TencentCloud/TencentDB-Agent-Memory
- Inspected default-branch revision: `badbd2179d06f4e0e1f2133bd3482880beab8a02` (`feat: release v2.0.3-beta.1`). The older `main` branch's OpenClaw plugin is not the integration target.
- Contract: [MemoryCore v3 API](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/badbd2179d06f4e0e1f2133bd3482880beab8a02/MemoryCore/v3-api-memorycore-doc.md).
- Implementation cross-check: [v3 client](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/badbd2179d06f4e0e1f2133bd3482880beab8a02/sdk/memory-core/typescript/src/v3/client.ts) and [v3 HTTP transport](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/badbd2179d06f4e0e1f2133bd3482880beab8a02/sdk/memory-core/typescript/src/v3/http.ts).
- License: MIT, Tencent, 2026. See [LICENSE](LICENSE).

OMK implements a small native client against the documented contract; no upstream runtime code, SDK dependency, model proxy, server image or extraction pipeline is vendored here. Upstream's legacy v2 HTTP transport defaults to disabled TLS validation; the inspected v3 transport does not. OMK always keeps TLS verification and refuses redirects.

Supported requests: `POST /v3/atomic/search`, `/v3/conversation/search`, `/v3/core/read`, `/v3/scenario/read`, `/v3/conversation/add`. Authentication is `Authorization: Bearer ...` plus `x-tdai-service-id`. Data requests contain operator-configured `team_id`, `agent_id`, `user_id`. The API success envelope requires numeric `code: 0` and `data`. L0 add accepts explicit messages with `role`, `content`, and a non-empty `session_id`; subsequent extraction is asynchronous.

MemoryCore's gateway credential is powerful. Client-side identity confinement does not replace server authorization. Use a dedicated instance/token for the intended trust boundary and do not expose its gateway credential to untrusted tenants. Wiki/CodeGraph, admin APIs and automatic session ingestion are deliberately outside this adapter.
