var chromeHandle;

// Zotero 9.0.5 on this machine rejects newly introduced local plugin IDs as
// "incompatible" unless manifest.json includes applications.zotero.update_url.
// Keep an independent update_url in the manifest, even if it only points to a
// placeholder endpoint, so the Add-on Manager registers the XPI successfully.

function install(data, reason) {}

async function startup({ id, version, rootURI }, reason) {
	var aomStartup = Components.classes[
		"@mozilla.org/addons/addon-manager-startup;1"
	].getService(Components.interfaces.amIAddonManagerStartup);
	var manifestURI = Services.io.newURI(rootURI + "manifest.json");
	chromeHandle = aomStartup.registerChrome(manifestURI, [
		["content", "codex-md-attach-bridge", rootURI],
	]);

	Services.scriptloader.loadSubScript(rootURI + "bridge.js");
	CodexMarkdownAttachBridge.init({ id, version, rootURI });
	CodexMarkdownAttachBridge.start();
	try {
		let prefPaneCandidates = [
			{
				pluginID: id,
				src: rootURI + "preferences.xhtml",
				scripts: [rootURI + "preferences.js"],
				stylesheets: [rootURI + "preferences.css"],
				label: "sly's zotero",
				image: rootURI + "icon.svg"
			},
			{
				pluginID: id,
				src: "preferences.xhtml",
				scripts: [rootURI + "preferences.js"],
				stylesheets: [rootURI + "preferences.css"],
				label: "sly's zotero",
				image: "icon.svg"
			},
			{
				pluginID: id,
				src: "preferences.xhtml",
				label: "sly's zotero",
				image: "icon.svg"
			}
		];
		let prefRegistered = false;
		for (let options of prefPaneCandidates) {
			try {
				Zotero.PreferencePanes.register(options);
				prefRegistered = true;
				break;
			}
			catch (e) {
				Zotero.debug("sly's zotero: preference pane registration attempt failed: " + e);
			}
		}
		if (!prefRegistered) {
			throw new Error("All preference pane registration attempts failed");
		}
	}
	catch (e) {
		Zotero.debug("sly's zotero: preference pane registration failed: " + e);
		Zotero.logError(e);
	}
	CodexMarkdownAttachBridge.addToAllWindows();
}

async function onMainWindowLoad({ window }, reason) {
	CodexMarkdownAttachBridge?.addToWindow?.(window);
}

async function onMainWindowUnload({ window }, reason) {
	CodexMarkdownAttachBridge?.removeFromWindow?.(window);
}

async function shutdown({ id, version, rootURI }, reason) {
	CodexMarkdownAttachBridge?.removeFromAllWindows?.();
	CodexMarkdownAttachBridge?.stop?.();
	CodexMarkdownAttachBridge = undefined;

	if (reason === APP_SHUTDOWN) {
		return;
	}

	if (chromeHandle) {
		chromeHandle.destruct();
		chromeHandle = null;
	}
}

function uninstall(data, reason) {}
