"""Holdings extraction as a Vercel Python Function.

The parser is Python (pdfplumber / pymupdf / pandas), and a Node function has
no Python runtime, so the two halves talk over HTTP instead of the old
`execFile(python3)` subprocess. This is what lets the whole app run on Vercel
without a container host.

Contract — POST JSON:
    {"url": "<https URL of the stored workbook>",
     "filename": "...",              # optional, improves AMC/month detection
     "fund_name_hint": "...",        # optional
     "amc_hint": "..."}              # optional
Returns exactly what parser/extract.py emits: either
{"amc", "funds": [...]} or {"amc", "fund_name", "report_month", "holdings"}.
"""
import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "parser"))

import extract  # noqa: E402

# Only fetch from the blob host we write to. Without this the endpoint is an
# SSRF primitive: it would fetch any URL a caller names, from inside Vercel's
# network, and report back what it found.
ALLOWED_HOST_SUFFIXES = (
    ".public.blob.vercel-storage.com",
    ".blob.vercel-storage.com",
)

MAX_BYTES = 100 * 1024 * 1024


def _check_url(url):
    parts = urllib.parse.urlparse(url)
    if parts.scheme != "https":
        raise ValueError("url must be https")
    host = parts.hostname or ""
    if not any(host.endswith(s) for s in ALLOWED_HOST_SUFFIXES):
        raise ValueError("url host is not an allowed blob host")
    return url


def _download(url, filename):
    # Keep the original extension: extract.py branches on it to pick the PDF or
    # the spreadsheet reader.
    suffix = os.path.splitext(filename or urllib.parse.urlparse(url).path)[1] or ".bin"
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as out:
        with urllib.request.urlopen(url, timeout=60) as res:
            read = 0
            while True:
                chunk = res.read(1 << 20)
                if not chunk:
                    break
                read += len(chunk)
                if read > MAX_BYTES:
                    raise ValueError("file exceeds size limit")
                out.write(chunk)
    return path


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        secret = os.environ.get("PARSER_SECRET")
        if not secret:
            self._send(500, {"error": "PARSER_SECRET is not configured"})
            return
        if self.headers.get("x-parser-secret") != secret:
            self._send(401, {"error": "unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            url = _check_url(body["url"])
            filename = body.get("filename") or ""
        except Exception as e:  # noqa: BLE001 - bad request, not a parse failure
            self._send(400, {"error": str(e)})
            return

        path = None
        try:
            path = _download(url, filename)
            # extract.py sniffs the AMC and month from the filename, so hand it
            # the real one rather than the temp file's random name.
            named = os.path.join(os.path.dirname(path), filename or os.path.basename(path))
            if named != path:
                os.replace(path, named)
                path = named
            result = extract.parse_file(
                path,
                body.get("fund_name_hint") or None,
                body.get("amc_hint") or None,
            )
            self._send(200, result)
        except Exception as e:  # noqa: BLE001 - surface a clean error to the caller
            self._send(422, {"error": str(e)})
        finally:
            if path and os.path.exists(path):
                os.unlink(path)
