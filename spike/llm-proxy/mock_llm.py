"""OpenAI 兼容的 SSE mock。model=fast 正常流式（7 字节一块，切断事件和 UTF-8）；slow 慢速流，用于取消；err429 返回 429。"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = "sk-test-123456"
FAST_TEXT = ["你好", "，世界！", " {\"ok\": true}"]


def chunk(delta=None, finish=None, usage=None):
    d = {"choices": [{"index": 0, "delta": {"content": delta} if delta else {}, "finish_reason": finish}]}
    if usage:
        d = {"choices": [], "usage": usage}
    return f"data: {json.dumps(d, ensure_ascii=False)}\n\n".encode()


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        auth_ok = self.headers.get("Authorization") == f"Bearer {KEY}"
        print(f"[REQ] {self.path} model={body.get('model')} stream={body.get('stream')} "
              f"auth_ok={auth_ok} keys={sorted(body)}", flush=True)
        if not auth_ok:
            return self._plain(401, '{"error":"bad key"}')
        if body["model"] == "err429":
            return self._plain(429, '{"error":"slow down"}')
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        try:
            if body["model"] == "slow":
                for i in range(50):
                    self.wfile.write(chunk(f"[{i}]"))
                    self.wfile.flush()
                    time.sleep(0.2)
                print("[SLOW] finished without cancel", flush=True)
            else:
                raw = b"".join([chunk(t) for t in FAST_TEXT] + [chunk(finish="stop"),
                               chunk(usage={"prompt_tokens": 11, "completion_tokens": 7}), b"data: [DONE]\n\n"])
                for i in range(0, len(raw), 7):
                    self.wfile.write(raw[i:i + 7])
                    self.wfile.flush()
                    time.sleep(0.005)
        except (BrokenPipeError, ConnectionResetError):
            print("[CLIENT GONE] connection closed by client", flush=True)

    def _plain(self, code, text):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(text.encode())

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print(f"mock llm on 127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
