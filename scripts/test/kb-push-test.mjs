// zoterU KB push contract tests: loads the real bridge.js in a sandbox and
// exercises Z1/Z2 code paths against the Python mock service (mock-kb-server.py).
// Usage: node scripts/test/kb-push-test.mjs [port]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const PORT = parseInt(process.argv[2] || "18100", 10);
const BASE = `http://127.0.0.1:${PORT}`;

// ---------- sandbox stubs ----------
const fileStore = new Map(); // path -> { dir?: true, bytes?: Uint8Array }
const zoteroItems = new Map();
const prefStore = {};
const alerts = [];
const progressDescriptions = [];

const dirOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf("\\")));
const leafOf = (p) => p.split(/[\\/]/).pop();

const IOUtilsStub = {
	async exists(p) { return fileStore.has(p); },
	async stat(p) {
		const entry = fileStore.get(p);
		if (!entry) throw new Error(`stat: not found ${p}`);
		if (entry.dir) return { type: "directory", isDir: true, size: 0, lastModified: 0 };
		return { type: "file", isDir: false, size: entry.bytes.length, lastModified: 0 };
	},
	async read(p) {
		const entry = fileStore.get(p);
		if (!entry || entry.dir) throw new Error(`read: not found ${p}`);
		return entry.bytes;
	},
	async readUTF8(p) {
		const bytes = await IOUtilsStub.read(p);
		return new TextDecoder().decode(bytes);
	},
	async writeUTF8(p, text) { fileStore.set(p, { bytes: new TextEncoder().encode(text) }); },
	async makeDirectory(p) { fileStore.set(p, { dir: true }); },
	async copy(src, dst) {
		const bytes = await IOUtilsStub.read(src);
		fileStore.set(dst, { bytes });
	},
	async getChildren(p) {
		const out = [];
		for (const key of fileStore.keys()) {
			if (dirOf(key) === p) out.push(key);
		}
		return out;
	}
};

const PathUtilsStub = {
	join: (...parts) => parts.join("\\"),
	parent: (p) => dirOf(p),
	filename: (p) => leafOf(p)
};

const sandbox = {
	Zotero: {
		debug: () => {},
		logError: () => {},
		Prefs: {
			get: (key) => (key in prefStore ? prefStore[key] : ""),
			set: (key, value) => { prefStore[key] = value; }
		},
		Items: { get: (id) => zoteroItems.get(id) || null },
		Date: { strToDate: (s) => ({ year: (String(s).match(/\d{4}/) || [null])[0] }) },
		alert: (_win, title, msg) => alerts.push({ title, msg }),
		ProgressWindow: class {
			changeHeadline() {}
			show() {}
			addDescription(text) { progressDescriptions.push(text); }
			startCloseTimer() {}
		}
	},
	IOUtils: IOUtilsStub,
	PathUtils: PathUtilsStub,
	TextEncoder,
	TextDecoder,
	Headers,
	fetch,
	AbortController,
	setTimeout,
	clearTimeout,
	console
};
sandbox.Zotero.ProgressWindow.prototype.ItemProgress = class {
	setText() {}
	setProgress() {}
};
sandbox.crypto = globalThis.crypto;

const context = vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(repoRoot, "bridge.js"), "utf8"), context, { filename: "bridge.js" });
const Z = sandbox.ZoteroMinerU;

// ---------- tiny test runner ----------
let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
	if (condition) {
		passed++;
		console.log(`  PASS  ${name}`);
	} else {
		failed++;
		console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
	}
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function getCounts() {
	const res = await fetch(`${BASE}/counts`);
	return res.json();
}

// ---------- fixtures ----------
function makeFakeItem({ withPdf = true, itemType = "journalArticle" } = {}) {
	const item = {
		isRegularItem: () => true,
		isAttachment: () => false,
		itemType,
		getField: (name) => ({
			title: "Mechanical behaviour of 3D printed composites",
			publicationTitle: "Composites Part B: Engineering",
			DOI: "https://doi.org/10.1016/j.compositesb.2023.110xyz",
			date: "2023-05-12"
		}[name] ?? ""),
		getCreators: () => [
			{ firstName: "Lei", lastName: "Wang", fieldMode: 0 },
			{ firstName: "Yang", lastName: "Zhang", fieldMode: 0 }
		],
		getAttachments: () => (withPdf ? ["pdfatt-1"] : [])
	};
	return item;
}

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 fake pdf payload for zoteru kb push test");
const mdPath = "C:\\storage\\ATTACH01\\MinerU Parse - paper.md";
const imgA = "C:\\storage\\ATTACH01\\images\\raw_fig_a.jpg";
const imgB = "C:\\storage\\ATTACH01\\images\\raw_fig_b.png";
const clPath = "C:\\storage\\ATTACH01\\content_list.json";
const pdfPath = "C:\\storage\\paper.pdf";
fileStore.set(mdPath, { bytes: new TextEncoder().encode(
	"# Title\n\n![fig a](images/raw_fig_a.jpg)\n\n![fig b](images/raw_fig_b.png)\n"
) });
fileStore.set("C:\\storage\\ATTACH01\\images", { dir: true });
fileStore.set(imgA, { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) });
fileStore.set(imgB, { bytes: new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]) });
fileStore.set(clPath, { bytes: new TextEncoder().encode('[{"type":"text","page_idx":0}]') });
fileStore.set(pdfPath, { bytes: PDF_BYTES });
zoteroItems.set("pdfatt-1", {
	isPDFAttachment: () => true,
	isAttachment: () => true,
	getFilePath: () => pdfPath
});

function makeEntry(docKey, { withPdf = true } = {}) {
	return {
		title: "Mechanical behaviour of 3D printed composites",
		attachment: { key: "ATTACH01" },
		parentItem: Object.assign(makeFakeItem({ withPdf }), { key: docKey }),
		filePath: mdPath
	};
}

function makeScan() {
	return {
		mdSourcePath: mdPath,
		imageFiles: [
			{ originalPath: imgA, originalName: "raw_fig_a.jpg", ext: ".jpg" },
			{ originalPath: imgB, originalName: "raw_fig_b.png", ext: ".png" }
		],
		contentListPath: clPath
	};
}

function makeSettings(overrides = {}) {
	return {
		apiBaseURL: "https://mineru.net/api/v4",
		modelVersion: "pipeline",
		kbServiceURL: BASE,
		kbApiToken: "TESTTOKEN",
		kbPushIncludePdf: true,
		kbPushTimeoutMS: 15000,
		kbPushMaxRetries: 3,
		kbSyncTagEnabled: true,
		...overrides
	};
}

async function pushDoc(docID, settingsOverrides = {}, entryOverrides = {}) {
	const settings = makeSettings(settingsOverrides);
	const entry = makeEntry(docID, entryOverrides);
	const scan = makeScan();
	const mdContent = await IOUtilsStub.readUTF8(scan.mdSourcePath);
	const normalized = Z.normalizeKBImages(mdContent, scan.imageFiles);
	const statuses = [];
	const result = await Z.pushEntryToKBService({
		entry,
		normalized,
		scan,
		settings,
		includePdf: settings.kbPushIncludePdf,
		onStatus: (text) => statuses.push(text)
	});
	return { result, statuses };
}

// ---------- tests ----------
console.log("== pure helpers ==");
{
	const hex = await Z.sha256Hex(new TextEncoder().encode("abc"));
	check("sha256Hex known vector", hex === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex);
}
{
	const meta = Z.extractKBItemMeta(makeFakeItem());
	check("authors formatted as Last, I.", meta.authors === "Wang, L.; Zhang, Y.", meta.authors);
	check("year parsed as number", meta.year === 2023, String(meta.year));
	check("venue from publicationTitle", meta.venue === "Composites Part B: Engineering", meta.venue);
	check("doi prefix stripped", meta.doi === "10.1016/j.compositesb.2023.110xyz", meta.doi);
	check("itemType read", meta.itemType === "journalArticle", meta.itemType);
	check("collection defaults to paper", meta.collection === "paper", meta.collection);
}
{
	const std = Z.extractKBItemMeta(makeFakeItem({ itemType: "standard", withPdf: false }));
	check("standard itemType -> collection standard", std.collection === "standard", std.collection);
}
{
	const built = Z.buildKBMetaJSON({
		docID: "SV8Y3D4K",
		itemMeta: Z.extractKBItemMeta(makeFakeItem()),
		pdfSha256: "deadbeef",
		parsedBy: { provider: "cloud-mineru", backend: "pipeline", at: "2026-08-29T00:00:00Z" }
	});
	check("meta doc_id/zotero_item_key", built.doc_id === "SV8Y3D4K" && built.zotero_item_key === "SV8Y3D4K");
	check("meta pdf_sha256 present when given", built.pdf_sha256 === "deadbeef");
	check("meta quality shape", eq(built.quality, { reviewed_by: null, reviewed_at: null, flags: [] }));
	check("meta parsed_by passthrough", built.parsed_by.provider === "cloud-mineru" && built.parsed_by.backend === "pipeline");
	const bare = Z.buildKBMetaJSON({ docID: "X", itemMeta: { title: "t", authors: "", year: null, venue: "", doi: "", itemType: "", collection: "paper" } });
	check("meta pdf_sha256 omitted when empty", !("pdf_sha256" in bare));
	check("meta year omitted when unknown", !("year" in bare));
}
{
	const norm = Z.normalizeKBImages("# t\n![a](images/raw_fig_a.jpg)\n![b](images/raw_fig_b.png)", makeScan().imageFiles);
	check("images renamed to pictureN", norm.images[0].name === "picture1.jpg" && norm.images[1].name === "picture2.png",
		JSON.stringify(norm.images));
	check("md references rewritten", norm.mdContent.includes("images/picture1.jpg") && norm.mdContent.includes("images/picture2.png"),
		norm.mdContent);
}
{
	const boundary = "----zoteruKBFormTEST";
	const body = Z.buildKBMultipart({
		boundary,
		meta: { doc_id: "X" },
		md: { filename: "result.md", bytes: new TextEncoder().encode("# hello") },
		images: [{ filename: "picture1.jpg", bytes: new Uint8Array([1, 2, 3]) }],
		contentList: null,
		sourcePdf: { filename: "paper.pdf", bytes: new Uint8Array([4, 5]) }
	});
	const text = new TextDecoder().decode(body);
	check("multipart opens with boundary", text.startsWith(`--${boundary}\r\n`));
	check("multipart closes with final boundary", text.endsWith(`--${boundary}--\r\n`));
	for (const part of ['name="meta"', 'name="md"', 'name="images"', 'name="source_pdf"']) {
		check(`multipart has ${part}`, text.includes(part));
	}
	check("multipart image filename present", text.includes('filename="picture1.jpg"'));
	check("multipart md filename is result.md", text.includes('filename="result.md"'));
}
{
	check("ascii filename kept", Z.sanitizeAsciiFileName("paper v2.pdf") === "paper v2.pdf");
	check("non-ascii filename falls back to docID name", Z.sanitizeAsciiFileName("文献综述.pdf", "SV8Y3D4K.pdf") === "SV8Y3D4K.pdf",
		Z.sanitizeAsciiFileName("文献综述.pdf", "SV8Y3D4K.pdf"));
	check("mixed filename degraded to ascii", /^[\x20-\x7E]+$/.test(Z.sanitizeAsciiFileName("report 文献 v3.pdf"))
		&& Z.sanitizeAsciiFileName("report 文献 v3.pdf").endsWith(".pdf"),
		Z.sanitizeAsciiFileName("report 文献 v3.pdf"));
	check("quote stripped", !Z.sanitizeAsciiFileName('we"ird.pdf').includes('"'));
}

console.log("== end-to-end push against mock contract service ==");
{
	const { result } = await pushDoc("TESTCREATED");
	check("TESTCREATED ok", result.ok === true, JSON.stringify(result));
	check("TESTCREATED status created", result.serverStatus === "created", result.serverStatus);
	check("TESTCREATED pdf included", result.pdfIncluded === true);
	check("TESTCREATED chunks echoed", result.chunks === 57);
}
{
	const { result } = await pushDoc("TESTUNCHANGED");
	check("TESTUNCHANGED unchanged counts as success", result.ok && result.serverStatus === "unchanged", JSON.stringify(result));
}
{
	const { result } = await pushDoc("TESTFAILONCE");
	const counts = (await getCounts()).post.TESTFAILONCE;
	check("TESTFAILONCE retried once then succeeded", result.ok && counts === 2, `count=${counts} result=${JSON.stringify(result)}`);
}
{
	const { result } = await pushDoc("TESTFAILTWICE");
	const counts = (await getCounts()).post.TESTFAILTWICE;
	check("TESTFAILTWICE retried twice then succeeded", result.ok && counts === 3, `count=${counts} result=${JSON.stringify(result)}`);
}
{
	const { result } = await pushDoc("TEST413");
	check("TEST413 fell back without pdf", result.ok && result.pdfIncluded === false, JSON.stringify(result));
	check("TEST413 noPdfReason mentions 413", (result.noPdfReason || "").includes("413"), result.noPdfReason);
	const counts = (await getCounts()).post.TEST413;
	check("TEST413 made exactly 2 attempts", counts === 2, String(counts));
}
{
	const { result } = await pushDoc("TEST413ALWAYS", {}, { withPdf: false });
	check("TEST413ALWAYS fails fast without pdf", !result.ok && (result.error || "").includes("413"), JSON.stringify(result));
}
{
	const started = Date.now();
	const { result } = await pushDoc("TEST401");
	const elapsed = Date.now() - started;
	const counts = (await getCounts()).post.TEST401;
	check("TEST401 fails without retry", !result.ok && (result.error || "").includes("401") && counts === 1, JSON.stringify(result));
	check("TEST401 fast-failed (<2s)", elapsed < 2000, `${elapsed}ms`);
}
{
	const { result } = await pushDoc("TESTRETRYEXHAUST", { kbPushMaxRetries: 1 });
	const counts = (await getCounts()).post.TESTRETRYEXHAUST;
	check("TESTRETRYEXHAUST exhausts retries (1 retry -> 2 attempts)", !result.ok && counts === 2, `count=${counts} result=${JSON.stringify(result)}`);
}

console.log("== Z2 delete sync + health ==");
{
	const settings = makeSettings();
	const ok = await Z.deleteDocFromKB("DEL_OK", settings);
	check("DELETE 200 -> deleted", ok.ok && ok.deleted === true, JSON.stringify(ok));
	const gone = await Z.deleteDocFromKB("DEL_404", settings);
	check("DELETE 404 -> ok no-op", gone.ok && gone.deleted === false, JSON.stringify(gone));
	const flaky = await Z.deleteDocFromKB("DEL_FLAKY", settings);
	const counts = (await getCounts()).delete.DEL_FLAKY;
	check("DELETE flaky retried", flaky.ok && counts === 2, `count=${counts} result=${JSON.stringify(flaky)}`);
	const denied = await Z.deleteDocFromKB("DEL_401", settings);
	check("DELETE 401 -> error", !denied.ok && (denied.error || "").includes("401"), JSON.stringify(denied));
}
{
	const health = await Z.testKBServiceConnection(makeSettings());
	check("health check ok", health.ok === true && health.status === 200, JSON.stringify(health));
	check("health body has deps", !!health.body?.deps);
	const bad = await Z.testKBServiceConnection(makeSettings({ kbServiceURL: "http://127.0.0.1:1" }));
	check("health failure surfaces error", bad.ok === false && !!bad.error);
}

console.log("== local export + sync tag ==");
{
	const kbRoot = "C:\\kbfake-root";
	fileStore.set(kbRoot, { dir: true });
	const entry = makeEntry("TESTLOC");
	const scan = makeScan();
	const mdContent = await IOUtilsStub.readUTF8(scan.mdSourcePath);
	const normalized = Z.normalizeKBImages(mdContent, scan.imageFiles);
	const result = await Z.exportEntryToLocalKB({ entry, normalized, kbRootPath: kbRoot });
	check("local export success", result.success === true, JSON.stringify(result));
	const mdOut = `C:\\kbfake-root\\ATTACH01\\ATTACH01.md`;
	const written = await IOUtilsStub.readUTF8(mdOut);
	check("local md uses pictureN refs", written.includes("images/picture1.jpg"), written);
	const imgCopied = fileStore.get("C:\\kbfake-root\\ATTACH01\\images\\picture1.jpg");
	check("local images copied", !!imgCopied && imgCopied.bytes.length === 8);
}
{
	const item = {
		addTag: (t) => item._tags.push(t),
		removeTag: (t) => { item._tags = item._tags.filter((x) => x !== t); },
		getTags: () => item._tags.map((t) => ({ tag: t })),
		saveTx: async () => { item._saved++; },
		_tags: ["#MinerU-Parse", "#KB-Synced"],
		_saved: 0
	};
	await Z.markKBSyncTag(item, false, makeSettings());
	check("tag switched to no-pdf variant", item._tags.includes("#KB-Synced-无PDF留档") && !item._tags.includes("#KB-Synced"),
		JSON.stringify(item._tags));
	check("saveTx called once on change", item._saved === 1, String(item._saved));
	await Z.markKBSyncTag(item, false, makeSettings());
	check("no saveTx when tag unchanged", item._saved === 1, String(item._saved));
}

console.log("== pushToKnowledgeBase orchestration (review P1-1 regression) ==");
{
	const kbRoot = "C:\\kbfake-root";
	const mdAtt = {
		id: 901,
		key: "ATTACH01",
		isAttachment: () => true,
		isRegularItem: () => false,
		parentItemID: 0,
		getFilePath: () => mdPath,
		getField: (name) => (name === "title" ? "Orphan md" : ""),
		addTag: (t) => mdAtt._tags.push(t),
		removeTag: (t) => { mdAtt._tags = mdAtt._tags.filter((x) => x !== t); },
		getTags: () => mdAtt._tags.map((t) => ({ tag: t })),
		saveTx: async () => {},
		_tags: []
	};
	const KB = "extensions.zoteru.";
	const setPrefs = (overrides = {}) => {
		prefStore[KB + "kbExportLocal"] = true;
		prefStore[KB + "kbExportHTTP"] = true;
		prefStore[KB + "kbRootPath"] = kbRoot;
		prefStore[KB + "kbServiceURL"] = BASE;
		prefStore[KB + "kbApiToken"] = "TESTTOKEN";
		for (const [k, v] of Object.entries(overrides)) prefStore[KB + k] = v;
	};

	// T1: P1-1 回归——HTTP 未配 token 时本地导出仍完成（降级而非整体阻断）
	setPrefs({ kbApiToken: "" });
	alerts.length = 0;
	let res = await Z.pushToKnowledgeBase({ window: {}, selectedItems: [mdAtt] });
	check("P1-1: local export completes without token", res.success === true && res.successes === 1, JSON.stringify(res));
	check("P1-1: notice explains HTTP skip", (res.notices || []).some((n) => n.includes("API Token")), JSON.stringify(res.notices));
	check("P1-1: no hard alert raised", alerts.length === 0, JSON.stringify(alerts));
	check("P1-1: summary mentions skip in progress window", progressDescriptions.some((d) => d.includes("HTTP 推送已跳过")),
		JSON.stringify(progressDescriptions));

	// T2: 显式 target="http" 且无 token → 硬错误（调用方语义明确，不降级）
	setPrefs({ kbApiToken: "" });
	alerts.length = 0;
	res = await Z.pushToKnowledgeBase({ window: {}, selectedItems: [mdAtt], target: "http" });
	check("explicit http target without token hard-fails",
		res.success === false && (res.error || "").includes("Token") && alerts.length === 1, JSON.stringify(res));

	// T3: 双目标均未配置 → 明确报错
	setPrefs({ kbApiToken: "", kbServiceURL: "", kbRootPath: "" });
	res = await Z.pushToKnowledgeBase({ window: {}, selectedItems: [mdAtt] });
	check("no usable target -> explicit error",
		res.success === false && (res.error || "").includes("没有任何可用的推送目标"), JSON.stringify(res));

	// T4: 仅本地勾选 → 正常完成，无降级提示
	setPrefs({ kbExportHTTP: false });
	res = await Z.pushToKnowledgeBase({ window: {}, selectedItems: [mdAtt] });
	check("local-only push clean", res.success === true && (res.notices || []).length === 0, JSON.stringify(res));

	// T5: 本地路径不存在但 HTTP 可用 → 降级后真实推送（独立 md 附件，doc_id=附件 key）
	setPrefs({ kbExportHTTP: true, kbRootPath: "C:\\definitely-missing-path" });
	res = await Z.pushToKnowledgeBase({ window: {}, selectedItems: [mdAtt] });
	check("local missing -> degraded to http push", res.success === true && res.http?.[0]?.ok === true, JSON.stringify(res));
	check("local missing notice present", (res.notices || []).some((n) => n.includes("本地目录导出已跳过")), JSON.stringify(res.notices));
	check("standalone md pushed without pdf tag", mdAtt._tags.includes("#KB-Synced-无PDF留档"), JSON.stringify(mdAtt._tags));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
