# zoterU

[English](#english) | [简体中文](#简体中文)

---

## English

A Zotero 9/10 plugin that integrates [MinerU](https://mineru.net) PDF parsing into your Zotero workflow, with a built-in MCP server for AI agent automation. Compatible with both Zotero 9 and Zotero 10.

### What It Does

- **One-click PDF parsing** — Right-click any PDF in Zotero, parse it to Markdown with images via MinerU
- **Auto attachment** — Parsed Markdown + images are automatically attached back to the Zotero item
- **Knowledge base push** — Export parsed Markdown to a local directory and/or push it to the composites knowledge base HTTP service (`POST /documents`, multipart per API contract v1), with automatic `DELETE /docs/{doc_id}` soft-delete sync
- **MCP JSON-RPC server** — Exposes all functionality over `http://127.0.0.1:23122/mcp` so AI agents (Claude Code, etc.) can drive the workflow
- **Multi-token management** — Configure multiple MinerU API tokens with automatic rotation and usage tracking

### Install

1. Download `zoterU-2.0.1.xpi` from [Releases](https://github.com/eric-sly/zoterU/releases)
2. Zotero → Tools → Add-ons → ⚙️ → Install Add-on From File
3. Restart Zotero
4. Confirm `zoterU` appears in Zotero preferences

### Version History

| Version | Highlights |
|---------|-----------|
| v2.0.1 | Zotero 10 WebIDL globals fix (`fetch`/`AbortController`/`Headers`/`TextEncoder` resolved via main-window realm fallback; MinerU upload/download/request hardened) |
| v2.0.0 | Knowledge base push (Z1) + soft-delete sync (Z2), per API contract v1 |
| v1.5.0 | Zotero 10 compatibility |
| v1.4.2 | MCP stdio bridge |

The HTTP push targets the [composites knowledge base service](https://github.com/eric-sly/composites-kb); the wire format is frozen as API contract v1 (see that repo's `docs/api-contract-v1.md`).

### Setup

Zotero -> Edit -> Settings -> `zoterU`:

| Setting | Default | Notes |
|---------|---------|-------|
| MinerU API Base URL | `https://mineru.net/api/v4` | |
| Model Version | `pipeline` | `pipeline` or `vlm` |
| Markdown Title Prefix | `MinerU Parse` | Prefix for attached Markdown filenames |
| Poll Interval (s) | `3` | Status check frequency |
| Timeout (s) | `120` | Per-file timeout |
| Daily File Limit | `5000` | Per-token daily cap |
| Priority Page Limit | `1000` | Per-token priority page cap |
| MinerU Tokens | — | Add one or more API tokens |
| Knowledge Base Path | — | Target directory for the local export |
| Knowledge Base Service URL | `http://192.168.1.105:8100` | composites-kb FastAPI service base URL |
| Knowledge Base API Token | — | Sent as `X-API-Token` on push/delete/health requests (ask the service admin) |
| Push Targets | local ✓ / HTTP ✓ | Local directory export and/or HTTP service push |
| Include Source PDF | ✓ | Attach the original PDF as `source_pdf`; requests over 200 MB automatically retry without it |
| Delete Sync | ✓ | Trash/permanent delete of an item calls `DELETE /docs/{doc_id}` on the service |
| `#KB-Synced` Tag on Success | ✓ | Tags pushed items (`#KB-Synced-无PDF留档` when pushed without PDF) |
| Push Timeout (s) | `120` | Per-request timeout for pushes |
| Push Retries | `3` | Retries for network errors / 5xx / 503 (idempotent by md hash, safe to retry) |

### Usage

#### Human (Right-Click Menu)

1. Select one or more items with PDF attachments in Zotero
2. Right-click → **MinerU** → **Batch Parse with MinerU to Markdown Attachments**
3. Progress window shows current model version and status
4. Parsed Markdown appears as a child attachment tagged `#MinerU-Parse`

To replace existing parsed results:
- **MinerU** → **Re-parse and Replace Existing MinerU Markdown**

To push to the knowledge base:
1. Configure Knowledge Base Path (local export) and/or Knowledge Base Service URL + API Token (HTTP push) in settings
2. Select items with `.md` attachments
3. Right-click → **Push to Knowledge Base**
4. Use **Test Connection** in settings to verify `GET /health` against the service

Local output structure:
```
<kb-path>/
├── <itemKey>/
│   ├── <itemKey>.md
│   └── images/
│       ├── picture1.jpg
│       └── picture2.png
```

HTTP push behavior (API contract v1):
- One `POST /documents` (multipart) per item; `meta.json` is generated from the Zotero item metadata with `doc_id` = parent item key
- Markdown image references (`images/pictureN.ext`) are uploaded with matching filenames
- Responses `created|updated|unchanged|restored` all count as success
- Failure retries (3 by default) are safe: the service is idempotent by md content hash
- Requests over 200 MB fall back to a push without `source_pdf` (tagged `#KB-Synced-无PDF留档`)
- Deleting an item (trash / permanent) calls `DELETE /docs/{doc_id}` (server-side soft delete; re-pushing a restored item returns `restored`)

#### AI Agent (MCP)

The plugin starts an HTTP JSON-RPC 2.0 server on `http://127.0.0.1:23122`.

```bash
# Check if running
curl http://127.0.0.1:23122/ping
```

#### Stdio MCP Wrapper

For MCP clients that launch local stdio servers, use `mcp-bridge.js`. It forwards JSON-RPC messages from stdin/stdout to the plugin HTTP endpoint at `http://127.0.0.1:23122/mcp`.

```json
{
  "command": "node",
  "args": ["/path/to/zoterU/mcp-bridge.js"]
}
```

Add this to `claude_desktop_config.json` or an equivalent Claude MCP config:

```json
{
  "mcpServers": {
    "zoteru": {
      "command": "node",
      "args": ["/path/to/zoterU/mcp-bridge.js"]
    }
  }
}
```

**Available tools:**

| Tool | Description |
|------|-------------|
| `ping_bridge` | Check if the plugin is running |
| `get_mineru_token_usage` | Get daily token usage stats (tokens masked) |
| `parse_items_with_mineru` | Parse PDFs by Zotero item keys |
| `attach_markdown_to_item` | Import a local `.md` file as a Zotero attachment |
| `export_to_knowledge_base` | Push Markdown attachments to the knowledge base (local directory and/or HTTP service; optional `target` = `local`\|`http`\|`both`, `includePdf`, `kbRootPath`) |

**Example: Parse items via MCP**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "parse_items_with_mineru",
    "arguments": {
      "itemKeys": ["SV8Y3D4K", "T2SGRFVE"],
      "replaceExisting": false,
      "allowQueuedToken": true
    }
  }
}
```

See the MCP section below for full API documentation.

### MCP API Reference

**Initialize:**
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"agent","version":"1.0"}}}
```

**List tools:**
```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

**Call a tool:**
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}
```

All responses follow JSON-RPC 2.0 with `{jsonrpc, id, result}` or `{jsonrpc, id, error}`.

### Development

```bash
# Source files
bootstrap.js    — Plugin lifecycle (startup/shutdown/window hooks)
bridge.js       — Core logic (HTTP/MCP server, MinerU API, menus, KB export)
preferences.*   — Settings UI (XUL + JS + CSS)
prefs.js        — Default preference values
locale/         — Fluent localization (zh-CN, en-US)
manifest.json   — Zotero plugin manifest
mcp-bridge.js   — stdio-to-HTTP MCP wrapper for AI agent clients
scripts/        — Local development and packaging scripts

# Syntax check
node --check bridge.js
node --check bootstrap.js
node --check preferences.js

# Package XPI
powershell -ExecutionPolicy Bypass -File scripts/build-xpi.ps1

# Contract tests (65 checks, mock KB server)
python scripts/test/mock-kb-server.py 18100 &
node scripts/test/kb-push-test.mjs 18100
```

### License

MIT — see [LICENSE](LICENSE).

---

## 简体中文

一个 Zotero 9/10 插件，将 [MinerU](https://mineru.net) PDF 解析集成到 Zotero 工作流中，内置 MCP 服务器供 AI Agent 调用。同时兼容 Zotero 9 与 Zotero 10。

### 功能

- **一键 PDF 解析** — 右键 Zotero 中的 PDF，通过 MinerU 解析为带图片的 Markdown
- **自动挂载附件** — 解析产物（.md + images/）自动挂载到 Zotero 条目
- **推送到知识库** — 将 Markdown 附件导出到本地目录，和/或按 API 契约 v1 推送到复合材料知识库 HTTP 服务（`POST /documents`），条目删除时自动调用 `DELETE /docs/{doc_id}` 同步软删
- **MCP JSON-RPC 服务** — 监听 `http://127.0.0.1:23122/mcp`，供 Claude Code 等 AI Agent 调用
- **多 Token 管理** — 支持配置多个 MinerU API Token，自动轮换 + 用量追踪

### 安装

1. 从 [Releases](https://github.com/eric-sly/zoterU/releases) 下载 `zoterU-2.0.1.xpi`
2. Zotero → 工具 → 插件 → ⚙️ → 从文件安装
3. 重启 Zotero
4. 确认设置中显示 `zoterU`

### 版本历史

| 版本 | 要点 |
|------|------|
| v2.0.1 | Zotero 10 WebIDL 全局修复（`fetch`/`AbortController`/`Headers`/`TextEncoder` 经主窗口 realm 兜底；MinerU 上传/下载/请求一并加固） |
| v2.0.0 | 知识库推送（Z1）+ 删除软删同步（Z2），按 API 契约 v1 |
| v1.5.0 | Zotero 10 兼容 |
| v1.4.2 | MCP stdio 桥 |

HTTP 推送的对接目标是 [复合材料知识库服务](https://github.com/eric-sly/composites-kb)；报文格式冻结为 API 契约 v1（见该仓 `docs/api-contract-v1.md`）。

### 设置

Zotero -> 编辑 -> 设置 -> `zoterU`：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| MinerU API Base URL | `https://mineru.net/api/v4` | |
| 模型版本 | `pipeline` | `pipeline` 或 `vlm` |
| Markdown 附件标题前缀 | `MinerU Parse` | |
| 轮询间隔(秒) | `3` | |
| 单文件超时(秒) | `120` | |
| 每 Token 每日文件上限 | `5000` | |
| 每 Token 优先解析页数上限 | `1000` | |
| MinerU Tokens | — | 可添加/删除多个 |
| 知识库路径 | — | 本地导出目标目录 |
| 知识库服务 URL | `http://192.168.1.105:8100` | 复合材料知识库 FastAPI 服务地址 |
| 知识库 API Token | — | 推送/删除/健康检查请求的 `X-API-Token`（向服务管理员获取） |
| 推送目标 | 本地 ✓ / HTTP ✓ | 本地目录导出和/或 HTTP 服务推送 |
| 携带原始 PDF | ✓ | 作为 `source_pdf` 上传；请求超 200MB 自动回退不带 PDF 重推 |
| 删除同步 | ✓ | 条目进回收站/真删时调用 `DELETE /docs/{doc_id}` |
| 成功写 `#KB-Synced` 标签 | ✓ | 推送成功回写标签（不带 PDF 推送时为 `#KB-Synced-无PDF留档`） |
| 推送超时(秒) | `120` | 单次推送请求超时 |
| 推送重试次数 | `3` | 网络/5xx/503 失败重试（服务端按 md 哈希幂等，重试安全） |

### 使用

#### 人工操作（右键菜单）

1. 选中一个或多个带 PDF 的 Zotero 条目
2. 右键 → **MinerU** → **使用 MinerU 批量解析为带图 Markdown 附件**
3. 进度窗口显示当前模型和状态
4. 解析完成后子条目出现，标签 `#MinerU-Parse`

替换已有结果：**MinerU** → **重新解析并替换已有 MinerU Markdown 附件**

推送到知识库：先在设置中配置知识库路径（本地导出）和/或知识库服务 URL + API Token（HTTP 推送），选中含 .md 附件的条目，右键 → **推送到知识库**；设置中的「测试连接」可验证服务端 `GET /health`。

HTTP 推送行为（API 契约 v1）：
- 逐条目 `POST /documents`（multipart），`meta.json` 从 Zotero 题录生成，`doc_id` = 父条目 itemKey
- md 中 `images/pictureN.ext` 相对引用与上传的图片文件名一一对应
- 响应 `created|updated|unchanged|restored` 均视为推送成功
- 失败自动重试（默认 3 次），服务端按 md 内容哈希幂等，重试无副作用
- 请求超 200MB 自动回退不带 `source_pdf` 重推（标签注明 `#KB-Synced-无PDF留档`）
- 条目删除（回收站/真删）自动调用 `DELETE /docs/{doc_id}`（服务端软删；恢复条目后重推即 `restored`）

#### AI Agent（MCP）

插件启动后在本机监听 `http://127.0.0.1:23122`，提供标准 JSON-RPC 2.0 接口。详细 API 文档见上方 English 部分的 [MCP API Reference](#mcp-api-reference)。

#### Stdio MCP 壳

如果 MCP 客户端需要启动本地 stdio server，使用 `mcp-bridge.js`。它会把 stdin/stdout 的 JSON-RPC 消息转发到插件 HTTP endpoint：`http://127.0.0.1:23122/mcp`。

```json
{
  "command": "node",
  "args": ["/path/to/zoterU/mcp-bridge.js"]
}
```

添加到 `claude_desktop_config.json` 或等价的 Claude MCP 配置中：

```json
{
  "mcpServers": {
    "zoteru": {
      "command": "node",
      "args": ["/path/to/zoterU/mcp-bridge.js"]
    }
  }
}
```

### 开发

源码文件同英文部分。打包命令：

```bash
powershell -ExecutionPolicy Bypass -File scripts/build-xpi.ps1

# 契约测试（65 项，mock 知识库服务）
python scripts/test/mock-kb-server.py 18100 &
node scripts/test/kb-push-test.mjs 18100
```

修改版本号：编辑 `manifest.json` 中的 `version` 字段。

### 许可

MIT — 详见 [LICENSE](LICENSE)。
