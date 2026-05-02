#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "public");
const PORT = Number(process.env.PORT ?? 5173);

const LUMA_BASE = "https://webapp.engineeringlumalabs.com/api/v2";
const API_KEY = process.env.LUMA_API_KEY;
if (!API_KEY) {
	console.error("LUMA_API_KEY is not set. Copy .env.example to .env and fill it in,");
	console.error("then run with:  node --env-file=.env server.mjs");
	process.exit(1);
}
const LUMA_HEADERS = { Authorization: `luma-api-key=${API_KEY}` };

const json = (res, status, body) => {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
};

const readBody = (req) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
};

async function serveStatic(req, res) {
	const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
	const file = join(PUBLIC_DIR, path);
	if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "forbidden" });
	try {
		const data = await readFile(file);
		const ext = path.slice(path.lastIndexOf("."));
		res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
		res.end(data);
	} catch {
		json(res, 404, { error: "not found" });
	}
}

async function lumaCreateCapture(title, camModel) {
	const body = new URLSearchParams({ title, camModel }).toString();
	const r = await fetch(`${LUMA_BASE}/capture`, {
		method: "POST",
		headers: { ...LUMA_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	const text = await r.text();
	if (!r.ok) throw new Error(`create capture failed ${r.status}: ${text}`);
	return JSON.parse(text);
}

async function lumaTrigger(slug) {
	const r = await fetch(`${LUMA_BASE}/capture/${encodeURIComponent(slug)}`, {
		method: "POST",
		headers: LUMA_HEADERS,
	});
	const text = await r.text();
	if (!r.ok) throw new Error(`trigger failed ${r.status}: ${text}`);
	return text ? JSON.parse(text) : {};
}

async function lumaStatus(slug) {
	const r = await fetch(`${LUMA_BASE}/capture/${encodeURIComponent(slug)}`, {
		headers: LUMA_HEADERS,
	});
	const text = await r.text();
	if (!r.ok) throw new Error(`status failed ${r.status}: ${text}`);
	return JSON.parse(text);
}

const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url, `http://${req.headers.host}`);

		if (req.method === "POST" && url.pathname === "/api/start") {
			const { title = "untitled", camModel = "normal" } = JSON.parse((await readBody(req)).toString() || "{}");
			const data = await lumaCreateCapture(title, camModel);
			return json(res, 200, {
				slug: data.capture?.slug,
				uploadUrl: data.signedUrls?.source,
				raw: data,
			});
		}

		if (req.method === "POST" && url.pathname === "/api/trigger") {
			const slug = url.searchParams.get("slug");
			if (!slug) return json(res, 400, { error: "missing slug" });
			return json(res, 200, await lumaTrigger(slug));
		}

		if (req.method === "GET" && url.pathname === "/api/status") {
			const slug = url.searchParams.get("slug");
			if (!slug) return json(res, 400, { error: "missing slug" });
			return json(res, 200, await lumaStatus(slug));
		}

		if (req.method === "GET" && url.pathname === "/api/credits") {
			const r = await fetch(`${LUMA_BASE}/capture/credits`, { headers: LUMA_HEADERS });
			return json(res, r.status, await r.json().catch(() => ({})));
		}

		if (req.method === "GET") return serveStatic(req, res);
		json(res, 405, { error: "method not allowed" });
	} catch (err) {
		console.error(err);
		json(res, 500, { error: String(err.message ?? err) });
	}
});

server.listen(PORT, () => {
	console.log(`luma video-to-3d running on  http://localhost:${PORT}`);
});
