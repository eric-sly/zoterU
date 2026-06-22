var CodexMineruPreferences = {
	PREF_BRANCH: "extensions.codex-md-attach-bridge.",
	initialized: false,

	FIELDS: [
		{ id: "mineru-api-base-url", pref: "mineruApiBaseURL", type: "string", fallback: "https://mineru.net/api/v4" },
		{ id: "mineru-title-prefix", pref: "mineruTitlePrefix", type: "string", fallback: "MinerU Parse" },
		{ id: "mineru-poll-interval-sec", pref: "mineruPollIntervalSec", type: "int", fallback: 3 },
		{ id: "mineru-timeout-sec", pref: "mineruTimeoutSec", type: "int", fallback: 120 },
		{ id: "mineru-daily-file-limit", pref: "mineruDailyFileLimit", type: "int", fallback: 5000 },
		{ id: "mineru-priority-page-limit", pref: "mineruPriorityPageLimit", type: "int", fallback: 1000, legacyPref: "mineruPriorityFileLimit" }
	],

	$(id) {
		return document.getElementById(id);
	},

	setStatus(message, isError = false) {
		let status = this.$("mineru-status");
		if (!status) return;
		status.textContent = message || "";
		status.style.color = isError ? "#b03232" : "#1d6e36";
	},

	getModelInputs() {
		return Array.from(document.querySelectorAll('input[name="mineru-model-version"]'));
	},

	getModelVersion() {
		let checked = this.getModelInputs().find((input) => input.checked);
		let value = checked?.value || "pipeline";
		return ["pipeline", "vlm"].includes(value) ? value : "pipeline";
	},

	setModelVersion(value) {
		let normalized = ["pipeline", "vlm"].includes(value) ? value : "pipeline";
		for (let input of this.getModelInputs()) {
			input.checked = input.value === normalized;
		}
	},

	getStoredTokens() {
		let raw = String(Zotero.Prefs.get(this.PREF_BRANCH + "mineruTokens", true) || "").trim();
		if (!raw) return [];
		try {
			let parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				return parsed.map((entry, index) => {
					if (typeof entry === "string") {
						return { id: `token-${index + 1}`, label: `Token ${index + 1}`, token: entry };
					}
					if (entry && typeof entry === "object") {
						return {
							id: String(entry.id || `token-${index + 1}`),
							label: String(entry.label || `Token ${index + 1}`),
							token: String(entry.token || entry.apiToken || "")
						};
					}
					return null;
				}).filter((entry) => entry && entry.token.trim());
			}
		}
		catch (_e) {}
		return raw.split(/\r?\n|[,;]/)
			.map((token, index) => ({ id: `token-${index + 1}`, label: `Token ${index + 1}`, token: token.trim() }))
			.filter((entry) => entry.token);
	},

	loadSettings() {
		for (let field of this.FIELDS) {
			let input = this.$(field.id);
			if (!input) continue;
			let value = Zotero.Prefs.get(this.PREF_BRANCH + field.pref, true);
			if ((value === undefined || value === null || value === "") && field.legacyPref) {
				value = Zotero.Prefs.get(this.PREF_BRANCH + field.legacyPref, true);
			}
			if (value === undefined || value === null || value === "") value = field.fallback;
			input.value = String(value);
		}
		this.setModelVersion(String(Zotero.Prefs.get(this.PREF_BRANCH + "mineruModelVersion", true) || "pipeline"));
		this.renderTokenRows(this.getStoredTokens());
		this.renderUsage();
		this.setStatus("");
	},

	saveSettings({ silent = false } = {}) {
		try {
			for (let field of this.FIELDS) {
				let input = this.$(field.id);
				if (!input) continue;
				let value = input.value;
				if (field.type === "int") {
					let intValue = parseInt(value, 10);
					if (!Number.isFinite(intValue) || intValue <= 0) {
						throw new Error("数值字段必须是正整数");
					}
					Zotero.Prefs.set(this.PREF_BRANCH + field.pref, intValue, true);
					continue;
				}
				Zotero.Prefs.set(this.PREF_BRANCH + field.pref, String(value || field.fallback || "").trim(), true);
			}
			Zotero.Prefs.set(this.PREF_BRANCH + "mineruModelVersion", this.getModelVersion(), true);
			Zotero.Prefs.set(this.PREF_BRANCH + "mineruTokens", JSON.stringify(this.collectTokenRows()), true);
			if (!silent) this.setStatus("已保存");
			this.renderUsage();
			return true;
		}
		catch (e) {
			if (!silent) this.setStatus(`保存失败: ${e.message || e}`, true);
			return false;
		}
	},

	renderTokenRows(tokens) {
		let list = this.$("mineru-token-list");
		if (!list) return;
		list.textContent = "";
		let entries = tokens.length ? tokens : [{ id: this.makeTokenID(), label: "Token 1", token: "" }];
		for (let entry of entries) {
			this.addTokenRow(entry);
		}
	},

	makeTokenID() {
		return `token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	},

	createHTMLElement(tagName) {
		return document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
	},

	addTokenRow(entry = null) {
		let list = this.$("mineru-token-list");
		if (!list) return;
		let row = this.createHTMLElement("div");
		row.className = "mineru-token-row";
		row.dataset.tokenId = entry?.id || this.makeTokenID();

		let input = this.createHTMLElement("input");
		input.type = "password";
		input.placeholder = "MinerU token";
		input.value = entry?.token || "";
		input.addEventListener("input", () => this.saveSettings({ silent: true }));
		input.addEventListener("change", () => this.saveSettings({ silent: true }));

		let removeButton = this.createHTMLElement("button");
		removeButton.type = "button";
		removeButton.className = "mineru-small-button";
		removeButton.textContent = "删除";
		removeButton.addEventListener("click", () => {
			row.remove();
			if (!list.querySelector(".mineru-token-row")) {
				this.addTokenRow();
			}
			this.saveSettings({ silent: true });
			this.renderUsage();
		});

		row.appendChild(input);
		row.appendChild(removeButton);
		list.appendChild(row);
	},

	collectTokenRows() {
		let rows = Array.from(document.querySelectorAll(".mineru-token-row"));
		let tokens = [];
		let index = 1;
		for (let row of rows) {
			let token = String(row.querySelector("input")?.value || "").replace(/^Bearer\s+/i, "").trim();
			if (!token) continue;
			let id = row.dataset.tokenId || `token-${index}`;
			tokens.push({ id, label: `Token ${index}`, token });
			index++;
		}
		return tokens;
	},

	renderUsage() {
		let output = this.$("mineru-usage-output");
		if (!output) return;
		let bridge = Zotero.getMainWindows?.()?.[0]?.CodexMarkdownAttachBridge;
		if (bridge?.getTokenUsageSummary) {
			output.textContent = JSON.stringify(bridge.getTokenUsageSummary(), null, 2);
			return;
		}
		output.textContent = Zotero.Prefs.get(this.PREF_BRANCH + "mineruUsageJSON", true) || "{}";
	},

	async clearCache() {
		let bridge = Zotero.getMainWindows?.()?.[0]?.CodexMarkdownAttachBridge;
		if (!bridge?.clearPluginTempCache) {
			this.setStatus("清理失败：插件主窗口对象不可用", true);
			return;
		}
		this.setStatus("正在清理暂存缓存...");
		try {
			let result = await bridge.clearPluginTempCache();
			this.setStatus(`已清理 ${result.removed} 个暂存目录，失败 ${result.failed}`);
			let output = this.$("mineru-usage-output");
			if (output) {
				output.textContent = JSON.stringify(result, null, 2);
			}
		}
		catch (e) {
			this.setStatus(`清理失败: ${e.message || e}`, true);
		}
	},

	init() {
		if (this.initialized) return;
		try {
			this.loadSettings();
			this.$("mineru-save-button")?.addEventListener("click", () => this.saveSettings());
			this.$("mineru-refresh-usage-button")?.addEventListener("click", () => this.renderUsage());
			this.$("mineru-clear-cache-button")?.addEventListener("click", () => {
				this.clearCache().catch((e) => {
					Zotero.logError(e);
					this.setStatus(`清理失败: ${e.message || e}`, true);
				});
			});
			this.$("mineru-add-token-button")?.addEventListener("click", () => {
				this.addTokenRow();
				this.saveSettings({ silent: true });
			});
			for (let field of this.FIELDS) {
				let input = this.$(field.id);
				if (!input) continue;
				input.addEventListener("change", () => this.saveSettings({ silent: true }));
				input.addEventListener("input", () => this.saveSettings({ silent: true }));
			}
			for (let input of this.getModelInputs()) {
				input.addEventListener("change", () => this.saveSettings({ silent: true }));
			}
			this.initialized = true;
		}
		catch (e) {
			Zotero.logError(e);
			this.setStatus(`设置页初始化失败: ${e.message || e}`, true);
		}
	}
};

if (typeof window !== "undefined") {
	window.CodexMineruPreferences = CodexMineruPreferences;
	window.addEventListener("DOMContentLoaded", () => {
		if (document.getElementById("codex-mineru-prefpane")) {
			CodexMineruPreferences.init();
		}
	}, { once: true });
}
