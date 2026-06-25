#!/usr/bin/env node

const http = require("http");
const readline = require("readline");

const SERVICE_NAME = "zoterU";
const PLUGIN_URL = process.env.ZOTERU_MCP_URL || process.env.ZOTERO_MCP_URL || "http://127.0.0.1:23122/mcp";
const rl = readline.createInterface({ input: process.stdin, terminal: false });

process.stderr.write(`[${SERVICE_NAME}-mcp] starting, forwarding to ${PLUGIN_URL}\n`);

function forwardToPlugin(message) {
	return new Promise((resolve, reject) => {
		const body = JSON.stringify(message);
		const req = http.request(
			PLUGIN_URL,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
				},
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					if (!data || data === "null") return resolve(null);
					try {
						resolve(JSON.parse(data));
					}
					catch (_e) {
						reject(new Error("Invalid JSON response: " + data.slice(0, 200)));
					}
				});
			},
		);
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

async function processLine(line) {
	let message;
	try {
		message = JSON.parse(line);
	}
	catch (e) {
		process.stderr.write(`[${SERVICE_NAME}-mcp] Invalid JSON input: ${e.message}\n`);
		return;
	}

	try {
		const response = await forwardToPlugin(message);
		if (response !== null && response !== undefined) {
			process.stdout.write(JSON.stringify(response) + "\n");
		}
	}
	catch (e) {
		if (message && message.id !== undefined) {
			const errorResponse = {
				jsonrpc: "2.0",
				id: message.id,
				error: { code: -32000, message: String(e.message || e) },
			};
			process.stdout.write(JSON.stringify(errorResponse) + "\n");
		}
		process.stderr.write(`[${SERVICE_NAME}-mcp] Error: ${e.message || e}\n`);
	}
}

let processing = Promise.resolve();
rl.on("line", (line) => {
	processing = processing.then(() => processLine(line));
});

rl.on("close", () => {
	processing.then(() => {
		process.stderr.write(`[${SERVICE_NAME}-mcp] stdin closed, exiting\n`);
		process.exit(0);
	});
});
