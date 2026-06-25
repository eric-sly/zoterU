# zoterU

[English](#english) | [简体中文](#简体中文)

---

## English

A Zotero 9+ plugin that integrates [MinerU](https://mineru.net) PDF parsing into your Zotero workflow, with a built-in MCP server for AI agent automation.

### What It Does

- **One-click PDF parsing** — Right-click any PDF in Zotero, parse it to Markdown with images via MinerU
- **Auto attachment** — Parsed Markdown + images are automatically attached back to the Zotero item
- **Knowledge base export** — Export parsed Markdown to a flat directory structure, with normalized filenames for RAG pipelines
- **MCP JSON-RPC server** — Exposes all functionality over `http://127.0.0.1:23122/mcp` so AI agents (Claude Code, etc.) can drive the workflow
- **Multi-token management** — Configure multiple MinerU API tokens with automatic rotation and usage tracking

### Install

1. Download `zoterU-1.4.1.xpi` from [Releases](https://github.com/eric-sly/zoterU/releases)
2. Zotero → Tools → Add-ons → ⚙️ → Install Add-on From File
3. Restart Zotero
4. Confirm `zoterU` appears in Zotero preferences

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
| Knowledge Base Path | — | Target directory for export |

### Usage

#### Human (Right-Click Menu)

1. Select one or more items with PDF attachments in Zotero
2. Right-click → **MinerU** → **Batch Parse with MinerU to Markdown Attachments**
3. Progress window shows current model version and status
4. Parsed Markdown appears as a child attachment tagged `#MinerU-Parse`

To replace existing parsed results:
- **MinerU** → **Re-parse and Replace Existing MinerU Markdown**

To export to knowledge base:
1. Configure Knowledge Base Path in settings
2. Select items with `.md` attachments
3. Right-click → **Export to Knowledge Base**

Output structure:
```
<kb-path>/
├── <itemKey>/
│   ├── <itemKey>.md
│   └── images/
│       ├── picture1.jpg
│       └── picture2.png
```

#### AI Agent (MCP)

The plugin starts an HTTP JSON-RPC 2.0 server on `http://127.0.0.1:23122`.

```bash
# Check if running
curl http://127.0.0.1:23122/ping
```

**Available tools:**

| Tool | Description |
|------|-------------|
| `ping_bridge` | Check if the plugin is running |
| `get_mineru_token_usage` | Get daily token usage stats (tokens masked) |
| `parse_items_with_mineru` | Parse PDFs by Zotero item keys |
| `attach_markdown_to_item` | Import a local `.md` file as a Zotero attachment |
| `export_to_knowledge_base` | Export Markdown attachments to knowledge base |

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

# Syntax check
node --check bridge.js
node --check bootstrap.js
node --check preferences.js

# Package XPI
powershell Compress-Archive -Path bootstrap.js,bridge.js,manifest.json,preferences.xhtml,preferences.js,preferences.css,prefs.js,icon.svg,locale -DestinationPath zoterU-1.4.1.xpi -Force
```

### License

MIT — see [LICENSE](LICENSE).

---

## 简体中文

一个 Zotero 9+ 插件，将 [MinerU](https://mineru.net) PDF 解析集成到 Zotero 工作流中，内置 MCP 服务器供 AI Agent 调用。

### 功能

- **一键 PDF 解析** — 右键 Zotero 中的 PDF，通过 MinerU 解析为带图片的 Markdown
- **自动挂载附件** — 解析产物（.md + images/）自动挂载到 Zotero 条目
- **导出到知识库** — 将 Markdown 附件导出为规范化目录结构，适配 RAG 知识库
- **MCP JSON-RPC 服务** — 监听 `http://127.0.0.1:23122/mcp`，供 Claude Code 等 AI Agent 调用
- **多 Token 管理** — 支持配置多个 MinerU API Token，自动轮换 + 用量追踪

### 安装

1. 从 [Releases](https://github.com/eric-sly/zoterU/releases) 下载 `zoterU-1.4.1.xpi`
2. Zotero → 工具 → 插件 → ⚙️ → 从文件安装
3. 重启 Zotero
4. 确认设置中显示 `zoterU`

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
| 知识库路径 | — | 导出目标目录 |

### 使用

#### 人工操作（右键菜单）

1. 选中一个或多个带 PDF 的 Zotero 条目
2. 右键 → **MinerU** → **使用 MinerU 批量解析为带图 Markdown 附件**
3. 进度窗口显示当前模型和状态
4. 解析完成后子条目出现，标签 `#MinerU-Parse`

替换已有结果：**MinerU** → **重新解析并替换已有 MinerU Markdown 附件**

导出到知识库：先配置知识库路径，选中含 .md 附件的条目，右键 → **导出到知识库**

#### AI Agent（MCP）

插件启动后在本机监听 `http://127.0.0.1:23122`，提供标准 JSON-RPC 2.0 接口。详细 API 文档见上方 English 部分的 [MCP API Reference](#mcp-api-reference)。

### 开发

源码文件同英文部分。打包命令：

```bash
powershell Compress-Archive -Path bootstrap.js,bridge.js,manifest.json,preferences.xhtml,preferences.js,preferences.css,prefs.js,icon.svg,locale -DestinationPath zoterU-1.4.1.xpi -Force
```

修改版本号：编辑 `manifest.json` 中的 `version` 字段。

### 许可

MIT — 详见 [LICENSE](LICENSE)。
