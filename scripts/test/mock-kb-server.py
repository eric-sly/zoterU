"""Mock composites-kb service for zoterU push tests (stdlib only).

Implements API contract v1 subset:
  GET    /health
  POST   /documents   (multipart/form-data)
  DELETE /docs/{doc_id}

Scenario is driven by doc_id (parsed from the meta part):
  TESTCREATED      -> 200 created
  TESTUNCHANGED    -> 200 unchanged
  TESTFAILONCE     -> 1st POST 500, then 200 created
  TESTFAILTWICE    -> 2x 500, then 200 created
  TEST413          -> 413 when source_pdf part present, 200 created otherwise
  TEST413ALWAYS    -> always 413 (tests no-fallback failure path)
  TEST401          -> always 401
  TESTRETRYEXHAUST -> always 503
  anything else    -> 200 created

DELETE:  DEL_OK -> 200, DEL_404 -> 404, DEL_FLAKY -> 1st 500 then 200, DEL_401 -> 401

Contract validation on every POST:
  - required parts: meta, md
  - meta.json parses; doc_id/title present; collection in {paper, standard}
  - every `images/<name>` reference in md must have a matching uploaded image filename
  - TESTCREATED requires source_pdf part to be present
Auth: X-API-Token must equal TESTTOKEN for POST/DELETE (401 otherwise).
"""

import json
import re
import sys
from email.parser import BytesParser
from email.policy import HTTP as HTTP_POLICY
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "TESTTOKEN"
post_counts = {}
delete_counts = {}


def parse_multipart(content_type, body):
    parser = BytesParser(policy=HTTP_POLICY)
    msg = parser.parsebytes(b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + body)
    parts = []  # list of (name, {filename, content_type, bytes}) — name repeats allowed (images)
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        payload = part.get_payload(decode=True)
        parts.append((name, {
            "filename": part.get_filename(),
            "content_type": part.get_content_type(),
            "bytes": payload or b"",
        }))
    return parts


def validate_contract(parts):
    errors = []
    by_name = {}
    for name, part in parts:
        by_name.setdefault(name, []).append(part)
    if "meta" not in by_name:
        errors.append("missing required part: meta")
    if "md" not in by_name:
        errors.append("missing required part: md")
    if errors:
        return None, errors
    try:
        meta = json.loads(by_name["meta"][0]["bytes"].decode("utf-8"))
    except Exception as exc:
        return None, [f"meta.json not valid JSON: {exc}"]
    if not meta.get("doc_id"):
        errors.append("meta.doc_id missing")
    if not meta.get("title"):
        errors.append("meta.title missing")
    if meta.get("collection") not in ("paper", "standard"):
        errors.append(f"meta.collection invalid: {meta.get('collection')!r}")
    md_text = by_name["md"][0]["bytes"].decode("utf-8", errors="replace")
    refs = set(re.findall(r"!\[[^\]]*\]\([^)]*?images/([A-Za-z0-9._\-]+)\)", md_text))
    uploaded = {part["filename"] for part in by_name.get("images", []) if part["filename"]}
    missing = refs - uploaded
    if missing:
        errors.append(f"md references images not uploaded: {sorted(missing)}")
    return meta, errors


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet
        pass

    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok", "deps": {"embed": {"ok": True}, "generate": {"ok": True}}})
        elif self.path == "/counts":
            self._send(200, {"post": post_counts, "delete": delete_counts})
        else:
            self._send(404, {"detail": "not found"})

    def do_POST(self):
        if self.path != "/documents":
            self._send(404, {"detail": "not found"})
            return
        if self.headers.get("X-API-Token") != TOKEN:
            self._send(401, {"detail": "invalid or missing token"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        content_type = self.headers.get("Content-Type", "")
        try:
            parts = parse_multipart(content_type, body)
        except Exception as exc:
            self._send(400, {"detail": f"multipart parse error: {exc}"})
            return
        meta, errors = validate_contract(parts)
        if errors:
            self._send(400, {"detail": "; ".join(errors)})
            return
        part_names = {name for name, _part in parts}
        doc_id = meta["doc_id"]
        post_counts[doc_id] = post_counts.get(doc_id, 0) + 1
        count = post_counts[doc_id]

        if doc_id == "TESTFAILONCE" and count == 1:
            self._send(500, {"detail": "boom (transient)"})
            return
        if doc_id == "TESTFAILTWICE" and count <= 2:
            self._send(500, {"detail": "boom (transient)"})
            return
        if doc_id == "TEST413":
            if "source_pdf" in part_names:
                self._send(413, {"detail": "payload too large"})
            else:
                self._send(200, {"doc_id": doc_id, "status": "created", "chunks": 12})
            return
        if doc_id == "TEST413ALWAYS":
            self._send(413, {"detail": "payload too large"})
            return
        if doc_id == "TEST401":
            self._send(401, {"detail": "invalid or missing token"})
            return
        if doc_id == "TESTRETRYEXHAUST":
            self._send(503, {"detail": "embedding dependency unavailable"})
            return
        if doc_id == "TESTCREATED" and "source_pdf" not in part_names:
            self._send(400, {"detail": "TESTCREATED expects source_pdf part"})
            return
        if doc_id == "TESTUNCHANGED":
            self._send(200, {"doc_id": doc_id, "status": "unchanged", "chunks": 42})
            return
        self._send(200, {"doc_id": doc_id, "status": "created", "chunks": 57})

    def do_DELETE(self):
        match = re.match(r"^/docs/([^/]+)$", self.path)
        if not match:
            self._send(404, {"detail": "not found"})
            return
        if self.headers.get("X-API-Token") != TOKEN:
            self._send(401, {"detail": "invalid or missing token"})
            return
        doc_id = match.group(1)
        delete_counts[doc_id] = delete_counts.get(doc_id, 0) + 1
        if doc_id == "DEL_404":
            self._send(404, {"detail": "doc not found"})
            return
        if doc_id == "DEL_FLAKY" and delete_counts[doc_id] == 1:
            self._send(500, {"detail": "boom (transient)"})
            return
        if doc_id == "DEL_401":
            self._send(401, {"detail": "invalid or missing token"})
            return
        self._send(200, {"ok": True, "doc_id": doc_id, "status": "removed"})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18100
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"mock-kb-server listening on 127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
