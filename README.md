# sly's zotero

`sly's zotero` 是一个 Zotero 9+ 插件，把四类工作放在同一个本地插件里：

- 在 Zotero 右键菜单中批量调用 MinerU 解析 PDF，并把带图片资源的 Markdown 保存回原条目。
- 给期刊论文、学位论文和 PDF 附件提供"用系统默认软件打开文件"的右键入口。
- 把 Markdown 附件导出到知识库目录，自动规范化文件名和图片引用，方便构建 RAG 知识库。
- 在本机暴露 MCP-compatible HTTP JSON-RPC 接口，供 agent 调用同一套 Zotero/MinerU 能力。

当前稳定包：

```text
F:\LLM\opencode workspace\slys-zotero-1.3.0.xpi
```

## 安装

1. Zotero -> 工具 -> 插件。
2. 从文件安装 `slys-zotero-1.3.0.xpi`。
3. 完全退出并重启 Zotero。
4. 确认 Zotero 设置里出现 `sly's zotero`。

插件 ID 保持为：

```text
codex-md-attach-bridge@example.com
```

## 人类使用

### MinerU 解析

在 Zotero 中选中一篇或多篇带 PDF 的条目，右键：

```text
MinerU -> 使用 MinerU 批量解析为带图 Markdown 附件
```

如果条目已经有 `#MinerU-Parse` Markdown 附件，可用：

```text
MinerU -> 重新解析并替换已有 MinerU Markdown 附件
```

解析过程中进度窗口会显示当前使用的模型版本（`pipeline` 或 `vlm`），格式为：

```text
MinerU PDF 解析 [pipeline]
论文标题 [pipeline] (上传 PDF)
论文标题 [pipeline] (等待解析)
论文标题 [pipeline] (完成)
```

解析完成后，插件会把结果导入 Zotero storage：

```text
Zotero Data\storage\<attachmentKey>\MinerU Parse - <title>.md
Zotero Data\storage\<attachmentKey>\images\...
```

ZIP 中 MinerU 输出的其他文件（`layout.json`、`content_list.json`、`model.json`、`origin.pdf` 等）也会一并解压到同一目录。

Markdown 附件会打标签：

```text
#MinerU-Parse
#Codex-MD
```

父条目会打标签：

```text
#MinerU-Parsed
```

### 默认软件打开 PDF

右键菜单中会出现：

```text
用系统默认软件打开文件
MinerU
```

"用系统默认软件打开文件"只对以下单选对象显示：

- `journalArticle` 期刊论文，且有本地 PDF 附件
- `thesis` 学位论文，且有本地 PDF 附件
- PDF 附件条目本身

网页条目、快照、书籍等不会显示该菜单项。

### 导出到知识库

在设置中配置"知识库路径"后，选中含 Markdown 附件的条目，右键：

```text
导出到知识库
```

功能：

- 支持任意 `.md` / `.markdown` 附件（不限于 MinerU 解析结果）。
- 在知识库路径下以附件 `itemKey` 命名创建文件夹。
- 只复制 `.md` 文件和 `images/` 目录，跳过 JSON、PDF 等。
- 图片按自然排序重命名为 `picture1.jpg`、`picture2.png`…，同步更新 md 中的图片引用。
- md 文件重命名为 `<itemKey>.md`。
- 无图片时只导出 md 文件，不创建 `images/` 目录。

输出结构：

```text
<知识库路径>/
├── 8NDNIGXI/
│   ├── 8NDNIGXI.md
│   └── images/
│       ├── picture1.jpg
│       ├── picture2.png
│       └── picture3.jpg
├── WAET6SDD/
│   ├── WAET6SDD.md
│   └── images/
│       ├── picture1.jpg
│       └── picture2.png
```

## 设置

Zotero 设置 -> `sly's zotero`。

主要设置：

- `MinerU API Base URL`：默认 `https://mineru.net/api/v4`
- `模型版本`：`pipeline` 或 `vlm`
- `Markdown 附件标题前缀`：默认 `MinerU Parse`
- `轮询间隔(秒)`：默认 `3`
- `单文件超时(秒)`：默认 `120`
- `每 token 每日文件上限`：默认 `5000`
- `每 token 优先解析页数上限`：默认 `1000`
- `MinerU Tokens`：一个输入框一个 token，可添加/删除
- `知识库路径`：导出 Markdown 附件的目标目录

Token 会保存为 JSON 数组到 Zotero prefs：

```text
extensions.codex-md-attach-bridge.mineruTokens
```

用量统计保存到：

```text
extensions.codex-md-attach-bridge.mineruUsageJSON
```

用量口径：

- `files`：今日解析文件数
- `pages`：今日估算解析页数
- `priorityPages`：今日已使用优先解析页数
- `priorityRemainingPages`：今日剩余优先解析页数
- `dailyRemaining`：今日剩余文件数

## 暂存缓存

MinerU zip 和解压结果会暂存到 Zotero 数据目录下：

```text
<Zotero data directory>\slys-zotero-tmp\mineru-<timestamp>-<random>\
```

正常解析完成后插件会尝试删除本次暂存目录。设置页也提供：

```text
清理暂存缓存
```

该按钮只清理：

```text
<Zotero data directory>\slys-zotero-tmp\mineru-*
```

不会碰 Zotero storage、PDF 附件或 Markdown 附件。

## Agent 使用

插件启动后会在本机监听：

```text
http://127.0.0.1:23122
```

可用端点：

```text
GET  /ping
GET  /mcp
POST /mcp
POST /attach-md
POST /parse-mineru
```

推荐 agent 使用 `/mcp`。

### Ping

```powershell
Invoke-RestMethod http://127.0.0.1:23122/ping
```

预期：

```json
{
  "ok": true,
  "service": "sly's zotero",
  "version": "1.1.1",
  "port": 23122
}
```

### MCP 初始化

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "agent",
      "version": "1.0"
    }
  }
}
```

### MCP 工具

支持工具：

- `ping_bridge`
- `get_mineru_token_usage`
- `parse_items_with_mineru`
- `parse_selected_pdfs_with_mineru`
- `attach_markdown_to_item`
- `attach_markdown_for_pdf`

#### `get_mineru_token_usage`

读取 token 用量，不暴露完整 token。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_mineru_token_usage",
    "arguments": {}
  }
}
```

#### `parse_items_with_mineru`

按 Zotero item key 解析指定条目或 PDF 附件。

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "parse_items_with_mineru",
    "arguments": {
      "itemKeys": ["SV8Y3D4K", "T2SGRFVE"],
      "replaceExisting": true,
      "allowQueuedToken": true
    }
  }
}
```

注意：

- 会真实调用 MinerU API。
- 会上传 PDF。
- 会消耗 token 文件数和页数额度。
- `replaceExisting: true` 会删除匹配的旧 `#MinerU-Parse` Markdown 附件。
- Token 额度在上传成功后才扣减（1.1 版修复）。

#### `parse_selected_pdfs_with_mineru`

解析 Zotero 当前选中条目。

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "parse_selected_pdfs_with_mineru",
    "arguments": {
      "replaceExisting": true,
      "allowQueuedToken": true
    }
  }
}
```

#### `attach_markdown_to_item`

把本地 Markdown 附件导入指定 Zotero 父条目。

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "attach_markdown_to_item",
    "arguments": {
      "itemKey": "SV8Y3D4K",
      "mdPath": "F:\\\\path\\\\to\\\\full.md",
      "mode": "import",
      "assetMode": "folder",
      "replaceExisting": false
    }
  }
}
```

`assetMode: "folder"` 会复制 Markdown 同级目录下的图片和资源文件夹到 Zotero storage。

#### `attach_markdown_for_pdf`

通过 PDF attachment key 找父条目，再导入 Markdown。

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "attach_markdown_for_pdf",
    "arguments": {
      "pdfAttachmentKey": "Q7FGNQAI",
      "mdPath": "F:\\\\path\\\\to\\\\full.md",
      "mode": "import",
      "assetMode": "folder",
      "replaceExisting": false
    }
  }
}
```

## 已验证功能

1. Zotero 设置页显示正常。
2. 多 token 输入框添加/删除正常。
3. 模型选择 `pipeline` / `vlm` 正常保存并用于 API payload `model_version`。
4. 清理暂存缓存按钮可用。
5. 右键批量解析成功，进度窗口全程显示模型版本。
6. 图片资源复制到 Zotero storage 后可用。
7. 页数计数和 token 用量统计正确。
8. MCP 工具实测通过：
   - `ping_bridge`
   - `get_mineru_token_usage`
   - `attach_markdown_to_item`
   - `attach_markdown_for_pdf`
   - `parse_items_with_mineru`
   - `parse_selected_pdfs_with_mineru`
9. 默认软件打开菜单只对期刊论文、学位论文和 PDF 附件显示。
10. 右键菜单使用官方 `Zotero.MenuManager` API，文字和图标正常显示。
11. MCP 错误处理正常（无效 key、空参数、未知工具）。

## 开发

源码目录：

```text
F:\LLM\codex workspace\codex-md-attach-bridge-official
```

主要文件：

- `manifest.json`：Zotero 插件 manifest（`strict_min_version: 9.0`）
- `bootstrap.js`：插件启动、偏好页注册、窗口加载/卸载
- `bridge.js`：HTTP/MCP 服务、右键菜单、MinerU API、附件导入、缓存清理
- `preferences.xhtml`：设置页结构
- `preferences.js`：设置页逻辑
- `preferences.css`：设置页样式
- `prefs.js`：默认偏好值
- `icon.svg`：插件图标
- `locale/zh-CN/slys-zotero.ftl`：中文 Fluent 本地化
- `locale/en-US/slys-zotero.ftl`：英文 Fluent 本地化

### 语法检查

```powershell
cd "F:\LLM\codex workspace\codex-md-attach-bridge-official"
node --check bridge.js
node --check bootstrap.js
node --check preferences.js
```

### 打包

```powershell
cd "F:\LLM\codex workspace\codex-md-attach-bridge-official"
Compress-Archive -Path * -DestinationPath "F:\LLM\codex workspace\slys-zotero-1.1.1.xpi" -Force
```

### 修改版本号

改 `manifest.json`：

```json
{
  "name": "sly's zotero",
  "version": "1.1.1"
}
```

打包后安装 XPI，并完全重启 Zotero。

## 故障排查

### MCP 不通

检查 Zotero 是否已启动并启用插件：

```powershell
Invoke-RestMethod http://127.0.0.1:23122/ping
```

如果失败：

- 重启 Zotero。
- 确认插件启用。
- 确认没有其他进程占用 `23122`。

### 设置页空白

完全卸载旧版插件，重启 Zotero，再安装当前 XPI。

### 右键菜单文字不显示

确认 `locale/` 目录在 XPI 内，重启 Zotero。菜单文字通过 Fluent 本地化系统加载。

### MinerU 解析失败

检查：

- token 是否有效
- API Base URL 是否为 `https://mineru.net/api/v4`
- PDF 是否已经下载到本地
- 是否达到每日文件数或优先页数限制
- Zotero 错误控制台中 `sly's zotero` 相关日志

### 图片不显示

确认 Markdown 附件 storage 下是否有图片目录，例如：

```text
Zotero Data\storage\<attachmentKey>\images\...
```

如果 Markdown 是通过 `attach_markdown_*` 导入，确认 `assetMode` 使用的是 `folder`。

## 1.1 版变更日志

- 只支持 Zotero 9+（`strict_min_version: 9.0`）。
- 右键菜单改用官方 `Zotero.MenuManager` API，消除手动 DOM 注入导致的监听器泄漏和菜单重复。
- 菜单文字通过 Fluent 本地化系统加载（`locale/zh-CN/` 和 `locale/en-US/`）。
- Token 额度在上传成功后才扣减（修复上传失败仍扣额度的问题）。
- PDF 页数估算改为只读尾部 64KB，避免大文件 OOM。
- HTTP 请求读取超时从 1 秒提升到 6 秒。
- `Zotero.Promise.delay` 替换为标准 `setTimeout`（兼容 Zotero 8+ 移除 Bluebird）。
- 设置页输入保存加 debounce，减少频繁写 prefs。
- 解析进度窗口全程显示模型版本。
- `unregisterMenu` 使用返回的注册 ID 而非 menuID 字符串。
- 统一 `failures` 返回结构为 `{title, error}` 对象数组。
- `getRelativePath` 改用 `PathUtils.split` 提高跨平台兼容性。
