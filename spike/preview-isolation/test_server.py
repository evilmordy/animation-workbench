"""本机测试服务器：记录收到的每个请求。T0.1 通过的条件是探针运行期间这里一条请求都没有。"""
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def _hit(self):
        print(f"[HIT] {self.command} {self.path} origin={self.headers.get('Origin')} "
              f"upgrade={self.headers.get('Upgrade')}", flush=True)
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    do_GET = do_POST = do_OPTIONS = _hit

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"listening on 127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
