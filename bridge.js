var CodexMarkdownAttachBridge = {
	id: null,
	version: null,
	rootURI: null,
	socket: null,
	port: 23122,
	mcpSessionId: "zotero-mineru-bridge",
	menuRegisteredID: null,
	ROOT_MENU_ID: "codex-mineru-bridge-menu",
	OPEN_FILE_MENU_ID: "slys-zotero-open-file-default",
	PREF_BRANCH: "extensions.codex-md-attach-bridge.",

	init({ id, version, rootURI }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
	},

	log(message) {
		Zotero.debug("sly's zotero: " + message);
	},

	start() {
		if (this.socket) return;
		try {
			this.cleanupPluginTempRoot().catch((e) => this.log(`Temp cleanup failed: ${e?.message || e}`));
			let socket = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
			socket.init(this.port, true, -1);
			socket.asyncListen({
				onSocketAccepted: (_socket, transport) => {
					this.handleConnection(transport).catch((e) => {
						this.log(`Request failed: ${e}`);
						Zotero.logError(e);
					});
				},
				onStopListening: () => {}
			});
			this.socket = socket;
			this.log(`Listening on http://127.0.0.1:${this.port}`);
		}
		catch (e) {
			this.log(`Failed to start: ${e}`);
			Zotero.logError(e);
		}
	},

	stop() {
		if (!this.socket) return;
		try {
			this.socket.close();
		}
		catch (e) {
			this.log(`Failed to stop: ${e}`);
		}
		this.socket = null;
	},

	async handleConnection(transport) {
		let input = null;
		let output = null;
		try {
			input = transport.openInputStream(0, 0, 0);
			output = transport.openOutputStream(0, 0, 0);
			let request = this.parseRequest(await this.readRequest(input));
			let response;

			if (request.method === "GET" && request.path === "/ping") {
				response = this.jsonResponse(200, {
					ok: true,
					service: "sly's zotero",
					version: this.version,
					port: this.port
				});
			}
			else if (request.method === "GET" && request.path === "/mcp") {
				response = this.jsonResponse(200, {
					endpoint: "/mcp",
					protocol: "MCP JSON-RPC 2.0 over HTTP",
					version: "2024-11-05",
					server: this.mcpSessionId,
					usage: {
						method: "POST",
						contentType: "application/json",
						methods: ["initialize", "tools/list", "tools/call"]
					}
				});
			}
			else if (request.method === "POST" && request.path === "/mcp") {
				try {
					response = this.jsonResponse(200, await this.handleMCP(JSON.parse(request.body || "{}")));
				}
				catch (e) {
					response = this.jsonResponse(400, this.mcpError(null, -32700, String(e?.message || e)));
				}
			}
			else if (request.method === "POST" && request.path === "/attach-md") {
				try {
					response = this.jsonResponse(200, await this.attachMarkdown(JSON.parse(request.body || "{}")));
				}
				catch (e) {
					response = this.jsonResponse(400, { success: false, error: String(e?.message || e) });
				}
			}
			else if (request.method === "POST" && request.path === "/parse-mineru") {
				try {
					response = this.jsonResponse(200, await this.parseMineruByKeys(JSON.parse(request.body || "{}")));
				}
				catch (e) {
					response = this.jsonResponse(400, { success: false, error: String(e?.message || e) });
				}
			}
			else {
				response = this.textResponse(404, "Not Found");
			}

			this.writeResponse(output, response);
		}
		finally {
			try { output?.close(); } catch (_e) {}
			try { input?.close(); } catch (_e) {}
		}
	},

	async readRequest(input) {
		let converter = Cc["@mozilla.org/intl/converter-input-stream;1"]
			.createInstance(Ci.nsIConverterInputStream);
		converter.init(input, "UTF-8", 0, 0);
		let requestText = "";
		let startTime = Date.now();
		let deadlineMS = 6000;
		while (Date.now() - startTime < deadlineMS) {
			let available = input.available();
			if (!available) {
				await new Promise((resolve) => setTimeout(resolve, 10));
				continue;
			}
			let out = {};
			converter.readString(available, out);
			requestText += out.value || "";
			let headerEnd = requestText.indexOf("\r\n\r\n");
			if (headerEnd === -1) continue;
			let headers = requestText.slice(0, headerEnd);
			let match = headers.match(/Content-Length:\s*(\d+)/i);
			let contentLength = match ? parseInt(match[1], 10) : 0;
			let bodyText = requestText.slice(headerEnd + 4);
			let bodyByteLength = new TextEncoder().encode(bodyText).length;
			if (bodyByteLength >= contentLength) break;
		}
		return requestText;
	},

	parseRequest(requestText) {
		let headerEnd = requestText.indexOf("\r\n\r\n");
		let head = headerEnd >= 0 ? requestText.slice(0, headerEnd) : requestText;
		let body = headerEnd >= 0 ? requestText.slice(headerEnd + 4) : "";
		let firstLine = (head.split(/\r\n/)[0] || "").split(" ");
		let rawPath = firstLine[1] || "/";
		let path = rawPath.split("?")[0];
		return { method: firstLine[0] || "GET", path, body };
	},

	getMCPTools() {
		return [
			{
				name: "ping_bridge",
				description: "Check whether sly's zotero is running.",
				inputSchema: { type: "object", properties: {}, additionalProperties: false }
			},
			{
				name: "get_mineru_token_usage",
				description: "Return configured MinerU token daily usage counters without exposing full token values.",
				inputSchema: { type: "object", properties: {}, additionalProperties: false }
			},
			{
				name: "parse_items_with_mineru",
				description: "Parse PDFs attached to Zotero regular items or PDF attachment items, then save Markdown plus image folder attachments.",
				inputSchema: {
					type: "object",
					properties: {
						itemKeys: {
							type: "array",
							items: { type: "string" },
							description: "Zotero regular item keys and/or PDF attachment keys."
						},
						replaceExisting: { type: "boolean", default: false },
						allowQueuedToken: {
							type: "boolean",
							default: true,
							description: "Allow tokens that have used their priority page allowance but still have daily file quota."
						}
					},
					required: ["itemKeys"],
					additionalProperties: false
				}
			},
			{
				name: "parse_selected_pdfs_with_mineru",
				description: "Parse PDFs from the currently selected Zotero items.",
				inputSchema: {
					type: "object",
					properties: {
						replaceExisting: { type: "boolean", default: false },
						allowQueuedToken: { type: "boolean", default: true }
					},
					additionalProperties: false
				}
			},
			{
				name: "attach_markdown_to_item",
				description: "Attach a local Markdown file to a Zotero regular item by parent item key.",
				inputSchema: {
					type: "object",
					properties: {
						itemKey: { type: "string", description: "Zotero parent regular item key." },
						mdPath: { type: "string", description: "Absolute local path to the .md or .markdown file." },
						mode: { type: "string", enum: ["import", "link"], default: "import" },
						title: { type: "string", description: "Optional Zotero attachment title." },
						assetMode: { type: "string", enum: ["none", "folder"], default: "folder" },
						assetRoot: { type: "string", description: "Optional asset root folder. Defaults to the Markdown file's parent folder." },
						replaceExisting: { type: "boolean", default: false }
					},
					required: ["itemKey", "mdPath"],
					additionalProperties: false
				}
			},
			{
				name: "attach_markdown_for_pdf",
				description: "Attach a Markdown file to the parent item of a Zotero PDF attachment.",
				inputSchema: {
					type: "object",
					properties: {
						pdfAttachmentKey: { type: "string", description: "Zotero PDF attachment item key." },
						mdPath: { type: "string", description: "Optional absolute local path to the .md or .markdown file." },
						mode: { type: "string", enum: ["import", "link"], default: "import" },
						title: { type: "string", description: "Optional Zotero attachment title." },
						assetMode: { type: "string", enum: ["none", "folder"], default: "folder" },
						assetRoot: { type: "string", description: "Optional asset root folder. Defaults to the Markdown file's parent folder." },
						replaceExisting: { type: "boolean", default: false }
					},
					required: ["pdfAttachmentKey"],
					additionalProperties: false
				}
			}
		];
	},

	mcpResult(id, result) {
		return { jsonrpc: "2.0", id, result };
	},

	mcpError(id, code, message, data = undefined) {
		let error = { code, message };
		if (data !== undefined) error.data = data;
		return { jsonrpc: "2.0", id, error };
	},

	mcpToolText(data, isError = false) {
		let text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
		return { content: [{ type: "text", text }], isError };
	},

	async handleMCP(message) {
		if (Array.isArray(message)) {
			let responses = [];
			for (let entry of message) {
				let response = await this.handleSingleMCP(entry);
				if (response) responses.push(response);
			}
			return responses;
		}
		return await this.handleSingleMCP(message);
	},

	async handleSingleMCP(message = {}) {
		let id = message.id ?? null;
		let method = message.method;
		let params = message.params || {};

		try {
			if (method === "initialize") {
				return this.mcpResult(id, {
					protocolVersion: params.protocolVersion || "2024-11-05",
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: this.mcpSessionId, version: this.version }
				});
			}
			if (method === "notifications/initialized") return null;
			if (method === "tools/list") return this.mcpResult(id, { tools: this.getMCPTools() });
			if (method === "tools/call") return this.mcpResult(id, await this.callMCPTool(params.name, params.arguments || {}));
			return this.mcpError(id, -32601, `Method not found: ${method}`);
		}
		catch (e) {
			return this.mcpError(id, -32000, String(e?.message || e));
		}
	},

	async callMCPTool(name, args = {}) {
		if (name === "ping_bridge") {
			return this.mcpToolText({ ok: true, service: "sly's zotero", version: this.version, port: this.port });
		}
		if (name === "get_mineru_token_usage") {
			return this.mcpToolText(this.getTokenUsageSummary());
		}
		if (name === "parse_items_with_mineru") {
			return this.mcpToolText(await this.parseMineruByKeys(args));
		}
		if (name === "parse_selected_pdfs_with_mineru") {
			let window = Zotero.getMainWindows?.()?.[0] || null;
			let selectedItems = window?.ZoteroPane?.getSelectedItems?.() || [];
			return this.mcpToolText(await this.parseMineruTasks({
				tasks: this.collectPDFTasks(selectedItems, { replaceExisting: !!args.replaceExisting }),
				replaceExisting: !!args.replaceExisting,
				allowQueuedToken: args.allowQueuedToken !== false
			}));
		}
		if (name === "attach_markdown_to_item") {
			return this.mcpToolText(await this.attachMarkdown({
				itemKey: args.itemKey,
				mdPath: args.mdPath,
				mode: args.mode || "import",
				title: args.title,
				assetMode: args.assetMode || "folder",
				assetRoot: args.assetRoot,
				replaceExisting: !!args.replaceExisting
			}));
		}
		if (name === "attach_markdown_for_pdf") {
			return this.mcpToolText(await this.attachMarkdown({
				pdfAttachmentKey: args.pdfAttachmentKey,
				mdPath: args.mdPath,
				mode: args.mode || "import",
				title: args.title,
				assetMode: args.assetMode || "folder",
				assetRoot: args.assetRoot,
				replaceExisting: !!args.replaceExisting
			}));
		}
		throw new Error(`Unknown tool: ${name}`);
	},

	jsonResponse(status, body) {
		return {
			status,
			statusText: status === 200 ? "OK" : "Bad Request",
			contentType: "application/json; charset=utf-8",
			body: JSON.stringify(body)
		};
	},

	textResponse(status, body) {
		return {
			status,
			statusText: status === 404 ? "Not Found" : "OK",
			contentType: "text/plain; charset=utf-8",
			body
		};
	},

	writeResponse(output, response) {
		let bodyBytes = new TextEncoder().encode(response.body);
		let raw = [
			`HTTP/1.1 ${response.status} ${response.statusText}`,
			`Content-Type: ${response.contentType}`,
			"Access-Control-Allow-Origin: http://127.0.0.1",
			"Connection: close",
			`Content-Length: ${bodyBytes.length}`,
			"",
			response.body
		].join("\r\n");
		let converter = Cc["@mozilla.org/intl/converter-output-stream;1"]
			.createInstance(Ci.nsIConverterOutputStream);
		converter.init(output, "UTF-8", 0, 0);
		converter.writeString(raw);
		converter.flush();
	},

	getMenuIconURL() {
		return this.rootURI ? this.rootURI + "icon.svg" : "";
	},

	getContextMenuDefinitions() {
		return [
			{
				id: "codex-mineru-parse-selected",
				l10nID: "slys-zotero-parse-selected",
				label: "使用 MinerU 批量解析为带图 Markdown 附件",
				getTasks: (items) => this.collectPDFTasks(items),
				run: ({ window, selectedItems }) => this.handleParseCommand({ window, selectedItems, replaceExisting: false })
			},
			{
				id: "codex-mineru-reparse-selected",
				l10nID: "slys-zotero-reparse-selected",
				label: "重新解析并替换已有 MinerU Markdown 附件",
				getTasks: (items) => this.collectPDFTasks(items, { replaceExisting: true }),
				run: ({ window, selectedItems }) => this.handleParseCommand({ window, selectedItems, replaceExisting: true })
			}
		];
	},

	getRegularItemTypeName(item) {
		if (!item?.isRegularItem?.()) return "";
		if (typeof item.itemType === "string") return item.itemType;
		try {
			if (item.itemTypeID) return Zotero.ItemTypes.getName(item.itemTypeID) || "";
		}
		catch (_e) {}
		return "";
	},

	canOpenPDFFromItems(items) {
		if (!Array.isArray(items) || items.length !== 1) return false;
		let item = items[0];
		if (item?.isAttachment?.()) return !!item.isPDFAttachment?.() && !!item.getFilePath?.();
		if (item?.isRegularItem?.()) {
			let itemType = this.getRegularItemTypeName(item);
			if (!["journalArticle", "thesis"].includes(itemType)) return false;
			for (let attachmentID of item.getAttachments()) {
				let candidate = Zotero.Items.get(attachmentID);
				if (candidate?.isPDFAttachment?.() && candidate.getFilePath?.()) return true;
			}
		}
		return false;
	},

	async openPDFFromItems(items, window) {
		if (!Array.isArray(items) || items.length !== 1) return;
		let item = items[0];
		let filePath = null;
		if (item?.isPDFAttachment?.()) {
			filePath = item.getFilePath?.();
		}
		else if (item?.isRegularItem?.()) {
			let itemType = this.getRegularItemTypeName(item);
			if (!["journalArticle", "thesis"].includes(itemType)) return;
			for (let attachmentID of item.getAttachments()) {
				let candidate = Zotero.Items.get(attachmentID);
				if (candidate?.isPDFAttachment?.()) {
					filePath = candidate.getFilePath?.();
					if (filePath) break;
				}
			}
		}
		if (!filePath) {
			this.showAlert(window, "sly's zotero", "当前选中条目没有可打开的本地 PDF 文件。");
			return;
		}
		try { Zotero.launchFile(filePath); }
		catch (e) {
			this.log(`Open file failed: ${e?.message || e}`);
			this.showAlert(window, "sly's zotero", `打开文件失败: ${e?.message || e}`);
		}
	},

	registerMenuForZotero8() {
		if (this.menuRegisteredID !== null) return true;
		try {
			let iconURL = this.getMenuIconURL();
			let menuDefinitions = this.getContextMenuDefinitions();
			this.menuRegisteredID = Zotero.MenuManager.registerMenu({
				menuID: this.ROOT_MENU_ID,
				pluginID: this.id,
				target: "main/library/item",
				menus: [
					{
						menuType: "menuitem",
						l10nID: "slys-zotero-open-file",
						label: "用系统默认软件打开文件",
						icon: iconURL,
						onShowing: (_event, context) => {
							try {
								let items = Array.isArray(context?.items) ? context.items : [];
								let canOpen = this.canOpenPDFFromItems(items);
								if (typeof context?.setVisible === "function") context.setVisible(canOpen);
								if (typeof context?.setEnabled === "function") context.setEnabled(canOpen);
							}
							catch (e) {
								this.log(`onShowing open-file failed: ${e?.message || e}`);
							}
						},
						onCommand: (_event, context) => {
							let window = context?.menuElem?.ownerGlobal || Zotero.getMainWindows?.()?.[0] || null;
							let items = Array.isArray(context?.items) ? context.items : [];
							this.openPDFFromItems(items, window).catch((e) => {
								this.log(`Open file command failed: ${e?.message || e}`);
							});
						}
					},
					{
						menuType: "submenu",
						l10nID: "slys-zotero-mineru",
						label: "MinerU",
						icon: iconURL,
						menus: menuDefinitions.map((definition) => ({
							menuType: "menuitem",
							l10nID: definition.l10nID,
							label: definition.label,
							icon: iconURL,
							onShowing: (_event, context) => {
								try {
									if (typeof context?.setEnabled === "function") {
										let selectedItems = Array.isArray(context?.items) ? context.items : [];
										context.setEnabled(definition.getTasks(selectedItems).length > 0);
									}
								}
								catch (e) {
									this.log(`onShowing ${definition.id} failed: ${e?.message || e}`);
								}
							},
							onCommand: (_event, context) => {
								let window = context?.menuElem?.ownerGlobal || Zotero.getMainWindows?.()?.[0] || null;
								let selectedItems = Array.isArray(context?.items) ? context.items : null;
								definition.run({ window, selectedItems });
							}
						}))
					},
					{
						menuType: "menuitem",
						l10nID: "slys-zotero-export-kb",
						label: "导出到知识库",
						icon: iconURL,
						onShowing: (_event, context) => {
							try {
								let items = Array.isArray(context?.items) ? context.items : [];
								let canExport = this.canExportToKB(items);
								if (typeof context?.setVisible === "function") context.setVisible(canExport);
								if (typeof context?.setEnabled === "function") context.setEnabled(canExport);
							}
							catch (e) {
								this.log(`onShowing export-kb failed: ${e?.message || e}`);
							}
						},
						onCommand: (_event, context) => {
							let window = context?.menuElem?.ownerGlobal || Zotero.getMainWindows?.()?.[0] || null;
							let items = Array.isArray(context?.items) ? context.items : [];
							this.exportToKnowledgeBase({ window, selectedItems: items }).catch((e) => {
								this.log(`Export to KB failed: ${e?.message || e}`);
							});
						}
					}
				]
			});
			return this.menuRegisteredID !== null;
		}
		catch (e) {
			this.log(`MenuManager registration failed: ${e}`);
			Zotero.logError(e);
			return false;
		}
	},

	addToWindow(window) {
		window.CodexMarkdownAttachBridge = this;
		try {
			window.MozXULElement?.insertFTLIfNeeded?.("slys-zotero.ftl");
		}
		catch (e) {
			this.log(`Failed to load Fluent file: ${e?.message || e}`);
		}
	},

	addToAllWindows() {
		this.registerMenuForZotero8();
		for (let win of Zotero.getMainWindows?.() || []) {
			if (win.ZoteroPane) this.addToWindow(win);
		}
	},

	removeFromWindow(window) {
		if (window.CodexMarkdownAttachBridge === this) {
			try { delete window.CodexMarkdownAttachBridge; } catch (_e) {}
		}
	},

	removeFromAllWindows() {
		if (this.menuRegisteredID !== null) {
			try { Zotero.MenuManager.unregisterMenu(this.menuRegisteredID); } catch (e) { this.log(`Menu unregister failed: ${e}`); }
			this.menuRegisteredID = null;
		}
		for (let win of Zotero.getMainWindows?.() || []) {
			if (win.ZoteroPane) this.removeFromWindow(win);
		}
	},

	getSettings() {
		let apiBaseURL = String(Zotero.Prefs.get(this.PREF_BRANCH + "mineruApiBaseURL", true) || "").trim().replace(/\/+$/, "");
		if (!apiBaseURL) apiBaseURL = "https://mineru.net/api/v4";
		let modelVersion = String(Zotero.Prefs.get(this.PREF_BRANCH + "mineruModelVersion", true) || "pipeline").trim();
		if (!["pipeline", "vlm"].includes(modelVersion)) modelVersion = "pipeline";
		let pollIntervalSec = parseInt(Zotero.Prefs.get(this.PREF_BRANCH + "mineruPollIntervalSec", true), 10);
		if (!Number.isFinite(pollIntervalSec) || pollIntervalSec <= 0) pollIntervalSec = 3;
		let timeoutSec = parseInt(Zotero.Prefs.get(this.PREF_BRANCH + "mineruTimeoutSec", true), 10);
		if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) timeoutSec = 120;
		let dailyFileLimit = parseInt(Zotero.Prefs.get(this.PREF_BRANCH + "mineruDailyFileLimit", true), 10);
		if (!Number.isFinite(dailyFileLimit) || dailyFileLimit <= 0) dailyFileLimit = 5000;
		let priorityPageLimit = parseInt(Zotero.Prefs.get(this.PREF_BRANCH + "mineruPriorityPageLimit", true), 10);
		if (!Number.isFinite(priorityPageLimit) || priorityPageLimit <= 0) {
			priorityPageLimit = parseInt(Zotero.Prefs.get(this.PREF_BRANCH + "mineruPriorityFileLimit", true), 10);
		}
		if (!Number.isFinite(priorityPageLimit) || priorityPageLimit <= 0) priorityPageLimit = 1000;
		let titlePrefix = String(Zotero.Prefs.get(this.PREF_BRANCH + "mineruTitlePrefix", true) || "MinerU Parse").trim() || "MinerU Parse";
		let kbRootPath = String(Zotero.Prefs.get(this.PREF_BRANCH + "kbRootPath", true) || "").trim();
		let tokens = this.getConfiguredTokens();
		return {
			apiBaseURL,
			modelVersion,
			pollIntervalMS: pollIntervalSec * 1000,
			timeoutMS: timeoutSec * 1000,
			dailyFileLimit,
			priorityPageLimit,
			titlePrefix,
			kbRootPath,
			tokens
		};
	},

	getConfiguredTokens() {
		let raw = String(Zotero.Prefs.get(this.PREF_BRANCH + "mineruTokens", true) || "").trim();
		if (!raw) {
			let legacy = String(Zotero.Prefs.get(this.PREF_BRANCH + "apiToken", true) || "").trim();
			raw = legacy;
		}
		let tokens = [];
		if (!raw) return tokens;
		try {
			let parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				for (let [index, entry] of parsed.entries()) {
					if (typeof entry === "string") {
						let token = entry.replace(/^Bearer\s+/i, "").trim();
						if (token) tokens.push({ id: `token-${index + 1}`, token, label: `Token ${index + 1}` });
					}
					else if (entry && typeof entry === "object") {
						let token = String(entry.token || entry.apiToken || "").replace(/^Bearer\s+/i, "").trim();
						if (token) tokens.push({ id: String(entry.id || `token-${index + 1}`), token, label: String(entry.label || entry.name || `Token ${index + 1}`) });
					}
				}
				return tokens;
			}
		}
		catch (_e) {}
		raw.split(/\r?\n|[,;]/)
			.map((line) => line.replace(/^Bearer\s+/i, "").trim())
			.filter(Boolean)
			.forEach((token, index) => tokens.push({ id: `token-${index + 1}`, token, label: `Token ${index + 1}` }));
		return tokens;
	},

	getUsageDateKey() {
		let date = new Date();
		let year = date.getFullYear();
		let month = String(date.getMonth() + 1).padStart(2, "0");
		let day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	},

	getUsageStore() {
		let raw = String(Zotero.Prefs.get(this.PREF_BRANCH + "mineruUsageJSON", true) || "").trim();
		if (!raw) return {};
		try {
			let parsed = JSON.parse(raw);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
		}
		catch (_e) {
			return {};
		}
	},

	saveUsageStore(store) {
		Zotero.Prefs.set(this.PREF_BRANCH + "mineruUsageJSON", JSON.stringify(store), true);
	},

	maskToken(token) {
		let value = String(token || "");
		if (value.length <= 10) return "*".repeat(Math.max(value.length, 4));
		return `${value.slice(0, 4)}...${value.slice(-4)}`;
	},

	getTokenUsageSummary() {
		let settings = this.getSettings();
		let dateKey = this.getUsageDateKey();
		let store = this.getUsageStore();
		let dayStore = store[dateKey] || {};
		return {
			date: dateKey,
			dailyFileLimit: settings.dailyFileLimit,
			priorityPageLimit: settings.priorityPageLimit,
			tokens: settings.tokens.map((entry) => {
				let usage = dayStore[entry.id] || {};
				let files = parseInt(usage.files || 0, 10) || 0;
				let pages = parseInt(usage.pages || 0, 10) || 0;
				let priorityPages = parseInt(usage.priorityPages ?? usage.priorityFiles ?? 0, 10) || 0;
				return {
					id: entry.id,
					label: entry.label,
					token: this.maskToken(entry.token),
					files,
					pages,
					priorityPages,
					priorityRemainingPages: Math.max(0, settings.priorityPageLimit - priorityPages),
					dailyRemaining: Math.max(0, settings.dailyFileLimit - files)
				};
			})
		};
	},

	selectToken(settings, { allowQueuedToken = true, pageCount = 1 } = {}) {
		if (!settings.tokens.length) throw new Error("请先在设置中填写至少一个 MinerU API Token");
		let requestedPages = Math.max(1, parseInt(pageCount || 1, 10) || 1);
		let dateKey = this.getUsageDateKey();
		let store = this.getUsageStore();
		let dayStore = store[dateKey] || {};
		let candidates = settings.tokens.map((entry, index) => {
			let usage = dayStore[entry.id] || {};
			let files = parseInt(usage.files || 0, 10) || 0;
			let priorityPages = parseInt(usage.priorityPages ?? usage.priorityFiles ?? 0, 10) || 0;
			let priorityRemainingPages = Math.max(0, settings.priorityPageLimit - priorityPages);
			return {
				...entry,
				index,
				files,
				priorityPages,
				priorityRemainingPages,
				hasDailyQuota: files < settings.dailyFileLimit,
				hasPriorityQuota: priorityRemainingPages > 0,
				hasEnoughPriorityPages: priorityRemainingPages >= requestedPages
			};
		}).filter((entry) => entry.hasDailyQuota);
		if (!candidates.length) throw new Error("所有 MinerU Token 今日文件额度都已用完");
		let priority = candidates.filter((entry) => entry.hasPriorityQuota)
			.sort((a, b) => Number(b.hasEnoughPriorityPages) - Number(a.hasEnoughPriorityPages)
				|| (b.priorityRemainingPages - a.priorityRemainingPages)
				|| (a.files - b.files)
				|| (a.index - b.index));
		if (priority.length) return { tokenInfo: priority[0], queued: false };
		if (!allowQueuedToken) throw new Error("所有 MinerU Token 今日优先解析页数额度都已用完，且当前禁止使用排队额度");
		let queued = candidates.sort((a, b) => (a.files - b.files) || (a.index - b.index));
		return { tokenInfo: queued[0], queued: true };
	},

	recordTokenUse(tokenInfo, settings, queued, pageCount = 1) {
		let dateKey = this.getUsageDateKey();
		let store = this.getUsageStore();
		if (!store[dateKey]) store[dateKey] = {};
		let pages = Math.max(1, parseInt(pageCount || 1, 10) || 1);
		let usage = store[dateKey][tokenInfo.id] || { files: 0, pages: 0, priorityPages: 0 };
		usage.files = (parseInt(usage.files || 0, 10) || 0) + 1;
		usage.pages = (parseInt(usage.pages || 0, 10) || 0) + pages;
		let oldPriorityPages = parseInt(usage.priorityPages ?? usage.priorityFiles ?? 0, 10) || 0;
		if (!queued && oldPriorityPages < settings.priorityPageLimit) {
			usage.priorityPages = Math.min(settings.priorityPageLimit, oldPriorityPages + pages);
		}
		usage.lastUsedAt = new Date().toISOString();
		store[dateKey][tokenInfo.id] = usage;
		this.saveUsageStore(store);
	},

	hasMineruMarkdownAttachment(parentItem) {
		if (!parentItem?.isRegularItem?.()) return false;
		for (let attachmentID of parentItem.getAttachments()) {
			let attachment = Zotero.Items.get(attachmentID);
			if (!attachment?.isAttachment?.()) continue;
			let tags = attachment.getTags?.() || [];
			if (tags.some((t) => t.tag === "#MinerU-Parse")) return true;
		}
		return false;
	},

	collectMarkdownAttachments(selectedItems) {
		let results = [];
		let seenIDs = new Set();
		let addMD = (attachment, parentItem) => {
			if (!attachment || seenIDs.has(attachment.id)) return;
			if (!attachment.isAttachment?.()) return;
			let tags = attachment.getTags?.() || [];
			if (!tags.some((t) => t.tag === "#MinerU-Parse")) return;
			let filePath = "";
			try { filePath = attachment.getFilePath?.() || ""; } catch (_e) {}
			if (!filePath) return;
			seenIDs.add(attachment.id);
			let title = parentItem?.getField?.("title") || attachment.getField("title") || this.fileNameFromPath(filePath);
			results.push({ attachment, parentItem, filePath, title });
		};
		for (let item of selectedItems || []) {
			if (item?.isAttachment?.()) {
				let parentItem = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null;
				addMD(item, parentItem);
				continue;
			}
			if (!item?.isRegularItem?.()) continue;
			for (let attachmentID of item.getAttachments()) {
				addMD(Zotero.Items.get(attachmentID), item);
			}
		}
		return results;
	},

	canExportToKB(items) {
		if (!Array.isArray(items) || !items.length) return false;
		return this.collectMarkdownAttachments(items).length > 0;
	},

	sanitizeKBFolderName(name) {
		return String(name || "untitled").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 160) || "untitled";
	},

	async exportToKnowledgeBase({ window = null, selectedItems = null } = {}) {
		let settings = this.getSettings();
		let kbRootPath = settings.kbRootPath;
		if (!kbRootPath) {
			this.showAlert(window, "sly's zotero", "请先在设置中配置知识库路径。");
			return { success: false, error: "kbRootPath not configured" };
		}
		if (!await IOUtils.exists(kbRootPath)) {
			this.showAlert(window, "sly's zotero", `知识库路径不存在: ${kbRootPath}`);
			return { success: false, error: "kbRootPath does not exist" };
		}
		let items = selectedItems || window?.ZoteroPane?.getSelectedItems?.() || [];
		let mdAttachments = this.collectMarkdownAttachments(items);
		if (!mdAttachments.length) {
			this.showAlert(window, "sly's zotero", "当前选中条目没有 MinerU Markdown 附件。");
			return { success: false, error: "no markdown attachments" };
		}
		let progress = new Zotero.ProgressWindow({ closeOnClick: true });
		progress.changeHeadline("导出到知识库");
		progress.show();
		let successes = 0;
		let failures = [];
		for (let entry of mdAttachments) {
			let title = entry.title;
			let itemProgress = new progress.ItemProgress("chrome://zotero/skin/treeitem-attachment-file.png", title);
			let update = ({ text = "", percent = null } = {}) => {
				if (typeof itemProgress.setText === "function") itemProgress.setText(text ? `${title} (${text})` : title);
				if (Number.isFinite(percent)) itemProgress.setProgress(percent);
			};
			try {
				let sourceDir = PathUtils.parent(entry.filePath);
				let folderName = this.sanitizeKBFolderName(title);
				let targetDir = PathUtils.join(kbRootPath, folderName);
				let counter = 1;
				while (await IOUtils.exists(targetDir)) {
					targetDir = PathUtils.join(kbRootPath, `${folderName} (${counter})`);
					counter++;
				}
				await IOUtils.makeDirectory(targetDir, { createAncestors: true });
				update({ text: "复制文件", percent: 30 });
				let copied = 0;
				let children = await IOUtils.getChildren(sourceDir);
				for (let childPath of children) {
					let leafName = PathUtils.filename(childPath);
					let stat = await IOUtils.stat(childPath);
					if (stat.type === "directory" || stat.isDir === true) {
						if (leafName !== "images") continue;
						await IOUtils.copy(childPath, PathUtils.join(targetDir, leafName), { recursive: true });
						copied++;
					}
					else {
						if (!/\.m(?:ark)?d$/i.test(leafName)) continue;
						await IOUtils.copy(childPath, PathUtils.join(targetDir, leafName));
						copied++;
					}
				}
				successes++;
				update({ text: `完成 (${copied} 文件)`, percent: 100 });
			}
			catch (e) {
				failures.push({ title, error: String(e?.message || e) });
				update({ text: "失败", percent: 100 });
			}
		}
		progress.addDescription(`完成 ${successes}/${mdAttachments.length}`);
		progress.startCloseTimer(5000);
		if (failures.length) this.showAlert(window, "导出部分失败", failures.slice(0, 10).map((f) => `${f.title}: ${f.error}`).join("\n"));
		return { success: failures.length === 0, total: mdAttachments.length, successes, failures };
	},

	collectPDFTasks(selectedItems, { replaceExisting = false } = {}) {
		let tasks = [];
		let seenAttachmentIDs = new Set();
		let addTask = (attachment, parentItem) => {
			if (!attachment || seenAttachmentIDs.has(attachment.id)) return;
			if (!attachment.isPDFAttachment?.()) return;
			if (!replaceExisting && parentItem && this.hasMineruMarkdownAttachment(parentItem)) return;
			seenAttachmentIDs.add(attachment.id);
			tasks.push({ attachment, parentItem });
		};
		for (let item of selectedItems || []) {
			if (item?.isPDFAttachment?.()) {
				let parentItem = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null;
				addTask(item, parentItem);
				continue;
			}
			if (!item?.isRegularItem?.()) continue;
			for (let attachmentID of item.getAttachments()) {
				addTask(Zotero.Items.get(attachmentID), item);
			}
		}
		return tasks;
	},

	resolveItemsByKeys(itemKeys = []) {
		let items = [];
		for (let key of itemKeys) {
			let item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, String(key || "").trim());
			if (!item) throw new Error(`Zotero item not found: ${key}`);
			items.push(item);
		}
		return items;
	},

	async parseMineruByKeys(args = {}) {
		let itemKeys = Array.isArray(args.itemKeys) ? args.itemKeys : [];
		if (!itemKeys.length) throw new Error("itemKeys is required");
		return await this.parseMineruTasks({
			tasks: this.collectPDFTasks(this.resolveItemsByKeys(itemKeys), { replaceExisting: !!args.replaceExisting }),
			replaceExisting: !!args.replaceExisting,
			allowQueuedToken: args.allowQueuedToken !== false
		});
	},

	showAlert(window, title, message) {
		if (window) Zotero.alert(window, title, message);
		else this.log(`${title}: ${message}`);
	},

	async handleParseCommand({ window = null, selectedItems = null, replaceExisting = false } = {}) {
		let items = selectedItems || window?.ZoteroPane?.getSelectedItems?.() || [];
		let tasks = this.collectPDFTasks(items, { replaceExisting });
		if (!tasks.length) {
			this.showAlert(window, "MinerU", replaceExisting ? "当前选择里没有可解析的 PDF 附件。" : "当前选择里没有未解析的 PDF 附件。");
			return;
		}
		let progress = new Zotero.ProgressWindow({ closeOnClick: true });
		let settings = this.getSettings();
		progress.changeHeadline(`MinerU PDF 解析 [${settings.modelVersion}]`);
		progress.show();
		let successes = 0;
		let failures = [];
		let results = [];
		for (let task of tasks) {
			let title = task.attachment.getField("title") || this.fileNameFromPath(task.attachment.getFilePath?.() || "");
			let itemProgress = new progress.ItemProgress("chrome://zotero/skin/treeitem-attachment-pdf.png", title);
			let update = ({ text = "", percent = null } = {}) => {
				if (typeof itemProgress.setText === "function") itemProgress.setText(text ? `${title} [${settings.modelVersion}] (${text})` : `${title} [${settings.modelVersion}]`);
				if (Number.isFinite(percent)) itemProgress.setProgress(percent);
			};
			try {
				let result = await this.parseSinglePDFTask(task, {
					replaceExisting,
					onStatus: update,
					allowQueuedToken: true
				});
				successes++;
				results.push(result);
				update({ text: "完成", percent: 100 });
			}
			catch (e) {
				failures.push({ title, error: String(e?.message || e) });
				update({ text: "失败", percent: 100 });
			}
		}
		progress.addDescription(`完成 ${successes}/${tasks.length}`);
		progress.startCloseTimer(5000);
		if (failures.length) this.showAlert(window, "MinerU 部分失败", failures.slice(0, 10).map((f) => `${f.title}: ${f.error}`).join("\n"));
		return { success: !failures.length, total: tasks.length, successes, failures, results };
	},

	async parseMineruTasks({ tasks, replaceExisting = false, allowQueuedToken = true } = {}) {
		if (!tasks?.length) {
			return { success: true, total: 0, successes: 0, failures: [], results: [] };
		}
		let successes = 0;
		let failures = [];
		let results = [];
		for (let task of tasks) {
			try {
				let result = await this.parseSinglePDFTask(task, { replaceExisting, allowQueuedToken });
				successes++;
				results.push(result);
			}
			catch (e) {
				let title = task.attachment?.getField?.("title") || task.attachment?.key || "PDF";
				failures.push({ title, error: String(e?.message || e) });
			}
		}
		return { success: failures.length === 0, total: tasks.length, successes, failures, results };
	},

	reportStatus(onStatus, phase, percent) {
		if (typeof onStatus === "function") onStatus({ text: phase, percent });
	},

	getPluginTempRoot() {
		let baseDir = "";
		try {
			baseDir = Zotero.DataDirectory?.dir || "";
		}
		catch (_e) {}
		if (!baseDir) {
			try {
				baseDir = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
			}
			catch (_e) {}
		}
		if (!baseDir) {
			baseDir = PathUtils.tempDir;
		}
		return PathUtils.join(baseDir, "slys-zotero-tmp");
	},

	async cleanupPluginTempRoot() {
		let tempRoot = this.getPluginTempRoot();
		if (!await IOUtils.exists(tempRoot)) return;
		let children = await IOUtils.getChildren(tempRoot);
		let now = Date.now();
		let maxAgeMS = 24 * 60 * 60 * 1000;
		for (let child of children) {
			let leafName = PathUtils.filename(child);
			if (!leafName.startsWith("mineru-")) continue;
			try {
				let stat = await IOUtils.stat(child);
				let lastModified = stat.lastModified || 0;
				if (!lastModified || now - lastModified > maxAgeMS) {
					await IOUtils.remove(child, { recursive: true });
				}
			}
			catch (e) {
				this.log(`Failed to remove stale temp path ${child}: ${e?.message || e}`);
			}
		}
	},

	async clearPluginTempCache() {
		let tempRoot = this.getPluginTempRoot();
		let result = {
			tempRoot,
			removed: 0,
			failed: 0,
			failures: []
		};
		if (!await IOUtils.exists(tempRoot)) {
			return result;
		}
		let children = await IOUtils.getChildren(tempRoot);
		for (let child of children) {
			let leafName = PathUtils.filename(child);
			if (!leafName.startsWith("mineru-")) continue;
			try {
				await IOUtils.remove(child, { recursive: true });
				result.removed++;
			}
			catch (e) {
				result.failed++;
				result.failures.push({
					path: child,
					error: String(e?.message || e)
				});
				this.log(`Failed to clear temp path ${child}: ${e?.message || e}`);
			}
		}
		return result;
	},

	async estimatePDFPageCount(attachment) {
		let filePath = attachment.getFilePath?.();
		if (!filePath || !await IOUtils.exists(filePath)) return 1;
		try {
			let stat = await IOUtils.stat(filePath);
			let fileSize = stat.size || 0;
			let tailBytes = 65536;
			let bytes;
			if (fileSize > tailBytes) {
				bytes = await IOUtils.read(filePath, { offset: fileSize - tailBytes, maxBytes: tailBytes });
			}
			else {
				bytes = await IOUtils.read(filePath);
			}
			let text = new TextDecoder("latin1").decode(bytes);
			let matches = text.match(/\/Type\s*\/Page\b/g);
			if (matches?.length) return matches.length;
			let countMatches = Array.from(text.matchAll(/\/Count\s+(\d+)/g))
				.map((match) => parseInt(match[1], 10))
				.filter((value) => Number.isFinite(value) && value > 0);
			if (countMatches.length) return Math.max(...countMatches);
		}
		catch (e) {
			this.log(`Failed to estimate PDF pages: ${e?.message || e}`);
		}
		return 1;
	},

	async parseSinglePDFTask(task, { replaceExisting = false, allowQueuedToken = true, onStatus = null } = {}) {
		let settings = this.getSettings();
		let pageCount = await this.estimatePDFPageCount(task.attachment);
		let selected = this.selectToken(settings, { allowQueuedToken, pageCount });
		this.reportStatus(onStatus, `${settings.modelVersion} 模型 | ${selected.queued ? "排队额度" : "优先额度"} ${selected.tokenInfo.label} (${pageCount}页)`, 5);
		let parsed = await this.parseAttachmentWithMineru(task.attachment, {
			...settings,
			apiToken: selected.tokenInfo.token
		}, {
			onStatus,
			onUploadAccepted: () => this.recordTokenUse(selected.tokenInfo, settings, selected.queued, pageCount)
		});
		try {
			this.reportStatus(onStatus, "保存 Markdown 附件", 92);
			let attached = await this.attachMarkdown({
				itemKey: task.parentItem?.key,
				pdfAttachmentKey: task.parentItem ? null : task.attachment.key,
				mdPath: parsed.mdPath,
				mode: "import",
				title: `${settings.titlePrefix} - ${this.getItemFileStem(task.attachment, "PDF")}.md`,
				assetMode: "folder",
				assetRoot: parsed.assetRoot,
				replaceExisting
			});
			try {
				if (task.parentItem) {
					task.parentItem.addTag("#MinerU-Parsed", 0);
					await task.parentItem.saveTx();
				}
			}
			catch (_e) {}
			return {
				parentKey: task.parentItem?.key || null,
				pdfAttachmentKey: task.attachment.key,
				markdownAttachmentKey: attached.attachmentKey,
				token: { id: selected.tokenInfo.id, label: selected.tokenInfo.label, queued: selected.queued },
				pageCount,
				markdownEntry: parsed.markdownEntryName,
				imageCount: parsed.assetCount,
				path: attached.path
			};
		}
		finally {
			if (parsed?.tempDir) await IOUtils.remove(parsed.tempDir, { recursive: true }).catch(() => {});
		}
	},

	async parseAttachmentWithMineru(attachment, settings, options = {}) {
		let filePath = attachment.getFilePath?.();
		if (!filePath || !await IOUtils.exists(filePath)) throw new Error("PDF 附件文件不存在或尚未下载到本地");
		let fileBytes = await IOUtils.read(filePath);
		let fileName = this.fileNameFromPath(filePath);
		let dataID = `zotero-${attachment.id}-${Math.random().toString(36).slice(2, 10)}`;
		this.reportStatus(options.onStatus, "申请上传地址", 15);
		let applyUploadResult = await this.requestMineruJSON({
			url: `${settings.apiBaseURL}/file-urls/batch`,
			token: settings.apiToken,
			method: "POST",
			body: {
				model_version: settings.modelVersion,
				files: [{ name: fileName, data_id: dataID }]
			}
		});
		if (applyUploadResult.code !== 0) throw new Error(`申请上传地址失败: ${applyUploadResult.msg || "unknown error"}`);
		let batchID = applyUploadResult?.data?.batch_id;
		let uploadURL = applyUploadResult?.data?.file_urls?.[0];
		if (!batchID || !uploadURL) throw new Error("MinerU API 未返回 batch_id 或 upload_url");

		this.reportStatus(options.onStatus, "上传 PDF", 30);
		let uploadResponse = await fetch(uploadURL, { method: "PUT", body: fileBytes });
		if (!uploadResponse.ok) {
			let errText = await uploadResponse.text();
			throw new Error(`上传 PDF 失败 ${uploadResponse.status}: ${errText.slice(0, 300)}`);
		}
		options.onUploadAccepted?.();

		this.reportStatus(options.onStatus, "等待解析", 50);
		let result = await this.pollMineruExtractResult({
			apiBaseURL: settings.apiBaseURL,
			token: settings.apiToken,
			batchID,
			dataID,
			timeoutMS: settings.timeoutMS,
			pollIntervalMS: settings.pollIntervalMS,
			onStatus: options.onStatus
		});
		if (!result?.full_zip_url) throw new Error("解析完成但未返回 full_zip_url");

		this.reportStatus(options.onStatus, "下载结果 ZIP", 75);
		let zipBytes = await this.downloadParseResultZip({
			zipURL: result.full_zip_url,
			apiBaseURL: settings.apiBaseURL,
			token: settings.apiToken
		});
		this.reportStatus(options.onStatus, "提取 Markdown 和图片", 85);
		return await this.extractMarkdownFolderFromZip(zipBytes, fileName, settings.titlePrefix);
	},

	async requestMineruJSON({ url, token, method = "GET", body = null }) {
		let headers = new Headers({ "Accept": "application/json", "Authorization": `Bearer ${token}` });
		let requestOptions = { method, headers };
		if (body !== null) {
			headers.set("Content-Type", "application/json");
			requestOptions.body = JSON.stringify(body);
		}
		let response = await fetch(url, requestOptions);
		let responseText = await response.text();
		if (!response.ok) throw new Error(`MinerU API 请求失败 ${response.status}: ${responseText.slice(0, 500)}`);
		try {
			return JSON.parse(responseText);
		}
		catch (_e) {
			throw new Error(`MinerU API 返回的 JSON 无法解析: ${responseText.slice(0, 500)}`);
		}
	},

	async pollMineruExtractResult({ apiBaseURL, token, batchID, dataID, timeoutMS, pollIntervalMS, onStatus = null }) {
		let startTime = Date.now();
		let lastState = "";
		while (Date.now() - startTime < timeoutMS) {
			let statusResult = await this.requestMineruJSON({
				url: `${apiBaseURL}/extract-results/batch/${encodeURIComponent(batchID)}`,
				token
			});
			if (statusResult.code !== 0) throw new Error(`查询解析状态失败: ${statusResult.msg || "unknown error"}`);
			let extractResults = statusResult?.data?.extract_result || [];
			let result = extractResults.find((x) => x?.data_id === dataID) || extractResults[0];
			if (result?.state) {
				lastState = result.state;
				this.reportStatus(onStatus, `MinerU 状态: ${lastState}`, 55);
			}
			if (result?.state === "done") return result;
			if (result?.state === "failed") throw new Error(result.err_msg || "MinerU 解析失败");
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMS));
		}
		throw new Error(`MinerU 解析超时，最后状态: ${lastState || "unknown"}`);
	},

	normalizeDownloadURL(downloadURL, apiBaseURL) {
		let raw = String(downloadURL || "").trim();
		if (!raw) throw new Error("下载链接为空");
		if (raw.startsWith("//")) raw = `https:${raw}`;
		let normalized;
		try {
			normalized = new URL(raw, `${apiBaseURL}/`);
		}
		catch (_e) {
			throw new Error(`下载链接格式非法: ${raw.slice(0, 200)}`);
		}
		if (!["http:", "https:"].includes(normalized.protocol)) throw new Error(`下载链接协议不支持: ${normalized.protocol}`);
		return normalized.toString();
	},

	async downloadParseResultZip({ zipURL, apiBaseURL, token }) {
		let normalizedURL = this.normalizeDownloadURL(zipURL, apiBaseURL);
		let candidates = [
			{ url: normalizedURL, withAuth: false },
			{ url: normalizedURL, withAuth: true }
		];
		if (normalizedURL.startsWith("http://")) {
			let httpsURL = `https://${normalizedURL.slice("http://".length)}`;
			candidates.push({ url: httpsURL, withAuth: false }, { url: httpsURL, withAuth: true });
		}
		let lastError = "";
		for (let candidate of candidates) {
			let headers = new Headers();
			if (candidate.withAuth) headers.set("Authorization", `Bearer ${token}`);
			try {
				let response = await fetch(candidate.url, { method: "GET", headers });
				if (!response.ok) {
					lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
					continue;
				}
				return new Uint8Array(await response.arrayBuffer());
			}
			catch (e) {
				lastError = String(e?.message || e);
			}
		}
		throw new Error(`下载解析结果失败: ${lastError || normalizedURL}`);
	},

	async extractMarkdownFolderFromZip(zipBytes, originalFileName, titlePrefix) {
		let tempRoot = this.getPluginTempRoot();
		await IOUtils.makeDirectory(tempRoot, { createAncestors: true });
		let tempDir = PathUtils.join(tempRoot, `mineru-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		let zipPath = PathUtils.join(tempDir, "result.zip");
		let outputRoot = PathUtils.join(tempDir, "output");
		await IOUtils.makeDirectory(outputRoot, { createAncestors: true });
		await IOUtils.write(zipPath, zipBytes);
		let zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"].createInstance(Components.interfaces.nsIZipReader);
		try {
			zipReader.open(this.pathToNSIFile(zipPath));
			let markdownEntryName = this.pickMarkdownEntry(zipReader, originalFileName);
			if (!markdownEntryName) throw new Error("结果 ZIP 中没有找到 Markdown 文件");
			let entries = [];
			let enumerator = zipReader.findEntries(null);
			while (enumerator.hasMore()) {
				let entryName = enumerator.getNext();
				if (!entryName || entryName.endsWith("/")) continue;
				let safeRelative = this.normalizeArchivePath(entryName);
				if (!safeRelative) continue;
				entries.push({ entryName, safeRelative });
			}
			for (let entry of entries) {
				let targetPath = PathUtils.join(outputRoot, ...entry.safeRelative.split("/"));
				await IOUtils.makeDirectory(PathUtils.parent(targetPath), { createAncestors: true });
				zipReader.extract(entry.entryName, this.pathToNSIFile(targetPath, true));
			}
			let mdRelative = this.normalizeArchivePath(markdownEntryName);
			let mdPath = PathUtils.join(outputRoot, ...mdRelative.split("/"));
			let mdParent = PathUtils.parent(mdPath);
			let desiredName = this.sanitizeFileName(`${titlePrefix} - ${this.fileStemFromName(originalFileName)}`) + ".md";
			let desiredPath = PathUtils.join(mdParent, desiredName);
			if (mdPath !== desiredPath) {
				await IOUtils.move(mdPath, desiredPath);
				mdPath = desiredPath;
			}
			let assetCount = entries.filter((entry) => !/\.m(?:ark)?d$/i.test(entry.entryName)).length;
			return { tempDir, assetRoot: mdParent, mdPath, markdownEntryName, assetCount };
		}
		finally {
			try { zipReader.close(); } catch (_e) {}
		}
	},

	pathToNSIFile(path, createIfMissing = false) {
		let file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
		file.initWithPath(path);
		if (createIfMissing && !file.exists()) file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0o644);
		return file;
	},

	pickMarkdownEntry(zipReader, originalFileName) {
		let entries = [];
		let enumerator = zipReader.findEntries(null);
		while (enumerator.hasMore()) {
			let entryName = enumerator.getNext();
			if (entryName && /\.m(?:ark)?d$/i.test(entryName) && !entryName.endsWith("/")) entries.push(entryName);
		}
		if (!entries.length) return "";
		let originalStem = this.fileStemFromName(originalFileName).toLowerCase();
		let scored = entries.map((entry) => {
			let leaf = this.fileNameFromPath(entry).toLowerCase();
			let score = 0;
			if (leaf === "full.md") score += 20;
			if (leaf.includes(originalStem)) score += 10;
			if (!entry.includes("/")) score += 3;
			return { entry, score };
		}).sort((a, b) => b.score - a.score || a.entry.length - b.entry.length);
		return scored[0].entry;
	},

	normalizeArchivePath(pathValue) {
		let parts = String(pathValue || "").replace(/\\/g, "/").split("/");
		let normalizedParts = [];
		for (let part of parts) {
			if (!part || part === ".") continue;
			if (part === "..") {
				if (normalizedParts.length) normalizedParts.pop();
				continue;
			}
			normalizedParts.push(part);
		}
		return normalizedParts.join("/");
	},

	getParentAndOptionalPDF({ itemKey, pdfAttachmentKey }) {
		if (itemKey) {
			let item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, itemKey);
			if (!item) throw new Error(`Item not found: ${itemKey}`);
			if (!item.isRegularItem?.()) throw new Error(`Item is not a regular Zotero item: ${itemKey}`);
			return { parentItem: item, pdfAttachment: null };
		}
		if (pdfAttachmentKey) {
			let attachment = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, pdfAttachmentKey);
			if (!attachment) throw new Error(`PDF attachment not found: ${pdfAttachmentKey}`);
			if (!attachment.isAttachment?.()) throw new Error(`Item is not an attachment: ${pdfAttachmentKey}`);
			let parentItem = attachment.parentItemID ? Zotero.Items.get(attachment.parentItemID) : null;
			if (!parentItem?.isRegularItem?.()) throw new Error(`PDF attachment has no regular parent: ${pdfAttachmentKey}`);
			return { parentItem, pdfAttachment: attachment };
		}
		throw new Error("Either itemKey or pdfAttachmentKey is required");
	},

	async attachMarkdown(args = {}) {
		let { parentItem, pdfAttachment } = this.getParentAndOptionalPDF(args);
		let mdPath = String(args.mdPath || "").trim();
		let mode = String(args.mode || "import").trim().toLowerCase();
		let assetMode = String(args.assetMode || "folder").trim().toLowerCase();
		let assetRoot = String(args.assetRoot || "").trim();
		let replaceExisting = !!args.replaceExisting;

		if (!mdPath && pdfAttachment) {
			let pdfPath = pdfAttachment.getFilePath();
			if (!pdfPath) throw new Error(`PDF attachment has no local file path: ${pdfAttachment.key}`);
			mdPath = pdfPath.replace(/\.pdf$/i, ".md");
		}
		if (!mdPath) throw new Error("mdPath is required when pdfAttachmentKey is not used");
		if (!/\.md$/i.test(mdPath) && !/\.markdown$/i.test(mdPath)) throw new Error(`Markdown path must end with .md or .markdown: ${mdPath}`);
		if (!await IOUtils.exists(mdPath)) throw new Error(`Markdown file does not exist: ${mdPath}`);
		if (!["import", "link"].includes(mode)) throw new Error(`Unsupported mode: ${mode}`);
		if (!["none", "folder"].includes(assetMode)) throw new Error(`Unsupported assetMode: ${assetMode}`);

		let fileName = PathUtils.filename(mdPath);
		let title = String(args.title || fileName).trim();
		let existing = [];
		for (let attachmentID of parentItem.getAttachments()) {
			let attachment = Zotero.Items.get(attachmentID);
			if (!attachment?.isAttachment?.()) continue;
			let tags = attachment.getTags?.() || [];
			let existingPath = "";
			try { existingPath = attachment.getFilePath?.() || ""; } catch (_e) {}
			if (attachment.attachmentFilename === fileName || existingPath === mdPath || (replaceExisting && tags.some((t) => t.tag === "#MinerU-Parse"))) {
				existing.push(attachment);
			}
		}

		if (existing.length && !replaceExisting) {
			return {
				success: true,
				skipped: true,
				reason: "matching markdown attachment already exists",
				parentKey: parentItem.key,
				existingAttachmentKeys: existing.map((item) => item.key)
			};
		}

		for (let attachment of existing) await attachment.eraseTx();

		let options = {
			file: mdPath,
			libraryID: parentItem.libraryID,
			parentItemID: parentItem.id,
			contentType: "text/markdown",
			charset: "utf-8"
		};
		let mdAttachment = mode === "link" ? await Zotero.Attachments.linkFromFile(options) : await Zotero.Attachments.importFromFile(options);
		if (title) mdAttachment.setField("title", title);
		mdAttachment.addTag("#Codex-MD", 0);
		mdAttachment.addTag("#MinerU-Parse", 0);
		await mdAttachment.saveTx();

		let copiedAssets = [];
		if (mode === "import" && assetMode === "folder") {
			copiedAssets = await this.copyMarkdownAssetFolder({ mdPath, mdAttachment, assetRoot });
		}

		return {
			success: true,
			mode,
			assetMode,
			parentKey: parentItem.key,
			attachmentKey: mdAttachment.key,
			title: mdAttachment.getField("title"),
			filename: mdAttachment.attachmentFilename,
			path: mdAttachment.getFilePath?.() || "",
			copiedAssets
		};
	},

	async copyMarkdownAssetFolder({ mdPath, mdAttachment, assetRoot }) {
		let sourceRoot = assetRoot || PathUtils.parent(mdPath);
		if (!await IOUtils.exists(sourceRoot)) throw new Error(`Asset root does not exist: ${sourceRoot}`);
		let storagePath = PathUtils.parent(mdAttachment.getFilePath());
		let mdLeafName = PathUtils.filename(mdPath);
		let copied = [];
		await this.copyDirectoryContents({
			sourceRoot,
			sourceDir: sourceRoot,
			targetRoot: storagePath,
			skipLeafNames: new Set([mdLeafName]),
			copied
		});
		return copied;
	},

	async copyDirectoryContents({ sourceRoot, sourceDir, targetRoot, skipLeafNames, copied }) {
		let entries = await IOUtils.getChildren(sourceDir);
		for (let sourcePath of entries) {
			let leafName = PathUtils.filename(sourcePath);
			if (skipLeafNames.has(leafName)) continue;
			let relativePath = this.getRelativePath(sourceRoot, sourcePath);
			if (!relativePath || relativePath.startsWith("..")) continue;
			let targetPath = this.joinLocalPath(targetRoot, relativePath);
			let stat = await IOUtils.stat(sourcePath);
			if (stat.type === "directory" || stat.isDir === true) {
				await IOUtils.makeDirectory(targetPath, { createAncestors: true });
				await this.copyDirectoryContents({ sourceRoot, sourceDir: sourcePath, targetRoot, skipLeafNames, copied });
			}
			else {
				await IOUtils.makeDirectory(PathUtils.parent(targetPath), { createAncestors: true });
				await IOUtils.copy(sourcePath, targetPath);
				copied.push(relativePath);
			}
		}
	},

	getRelativePath(rootPath, childPath) {
		let rootParts = PathUtils.split(rootPath);
		let childParts = PathUtils.split(childPath);
		if (childParts.length < rootParts.length) return "";
		for (let i = 0; i < rootParts.length; i++) {
			if (childParts[i] !== rootParts[i]) return "";
		}
		return childParts.slice(rootParts.length).join("/");
	},

	joinLocalPath(rootPath, relativePath) {
		let separator = rootPath.includes("\\") ? "\\" : "/";
		let cleanRoot = rootPath.replace(/[\\\/]+$/, "");
		let cleanRelative = relativePath.replace(/[\\\/]+/g, separator).replace(/^[\\\/]+/, "");
		return cleanRoot + separator + cleanRelative;
	},

	fileNameFromPath(path) {
		return String(path || "").split(/[\\\/]/).pop() || "";
	},

	fileStemFromName(name) {
		return this.fileNameFromPath(name).replace(/\.[^.]+$/, "") || "document";
	},

	getItemFileStem(item, fallback = "file") {
		let title = item?.getField?.("title") || this.fileNameFromPath(item?.getFilePath?.() || "") || fallback;
		return this.fileStemFromName(title);
	},

	sanitizeFileName(name) {
		return String(name || "document").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 160) || "document";
	}
};
