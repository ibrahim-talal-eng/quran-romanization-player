"""Local CORS proxy for QUA GitHub release assets. Run: python proxy.py"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen

ALLOWED_HOSTS = {
    "github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
}


class Handler(BaseHTTPRequestHandler):
    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        target = query.get("url", [""])[0]
        parsed = urlparse(target)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            self.send_response(403)
            self.send_cors()
            self.end_headers()
            self.wfile.write(b"Upstream host is not allowed")
            return

        try:
            req = Request(target, headers={"User-Agent": "Quran-Romanization-Player/1.0"})
            with urlopen(req, timeout=120) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_cors()
                for name in ("Content-Type", "Content-Length", "ETag", "Last-Modified"):
                    value = response.headers.get(name)
                    if value:
                        self.send_header(name, value)
                self.end_headers()
                self.wfile.write(body)
        except HTTPError as exc:
            self.send_response(exc.code)
            self.send_cors()
            self.end_headers()
            self.wfile.write(exc.read())
        except (URLError, TimeoutError) as exc:
            self.send_response(502)
            self.send_cors()
            self.end_headers()
            self.wfile.write(str(exc).encode("utf-8"))

    def log_message(self, fmt, *args):
        print("[QUA proxy] " + fmt % args)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8787), Handler)
    print("QUA CORS proxy running at http://127.0.0.1:8787")
    server.serve_forever()
