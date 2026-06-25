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
		["content", "zotero-mineru", rootURI],
	]);

	Services.scriptloader.loadSubScript(rootURI + "bridge.js");
	ZoteroMinerU.init({ id, version, rootURI });
	ZoteroMinerU.start();
	try {
		Zotero.PreferencePanes.register({
			pluginID: id,
			src: rootURI + "preferences.xhtml",
			scripts: [rootURI + "preferences.js"],
			stylesheets: [rootURI + "preferences.css"],
			label: "Zotero MinerU",
			image: rootURI + "icon.svg"
		});
	}
	catch (e) {
		Zotero.debug("Zotero MinerU: preference pane registration failed: " + e);
		Zotero.logError(e);
	}
	ZoteroMinerU.addToAllWindows();
}

async function onMainWindowLoad({ window }, reason) {
	ZoteroMinerU?.addToWindow?.(window);
}

async function onMainWindowUnload({ window }, reason) {
	ZoteroMinerU?.removeFromWindow?.(window);
}

async function shutdown({ id, version, rootURI }, reason) {
	ZoteroMinerU?.removeFromAllWindows?.();
	ZoteroMinerU?.stop?.();
	ZoteroMinerU = undefined;

	if (reason === APP_SHUTDOWN) {
		return;
	}

	if (chromeHandle) {
		chromeHandle.destruct();
		chromeHandle = null;
	}
}

function uninstall(data, reason) {}
