"""ETO Stitch: Peer Registry — 简单 HTTP server"""
import io, json, sys, time, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
sys.stdout.reconfigure(encoding="utf-8")

PEERS: dict = {}
LOCK = threading.Lock()
PORT = 5100
TTL = 60  # seconds before a peer is considered stale

def _cleanup():
    now = time.time()
    stale = [k for k, v in PEERS.items() if now - v.get("_last_seen", 0) > TTL]
    for k in stale:
        del PEERS[k]

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass  # silent

    def _json(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_PUT(self):
        if self.path == "/register":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            with LOCK:
                _cleanup()
                body["_last_seen"] = time.time()
                PEERS[body.get("name", "?")] = body
            self._json(200, {"status": "registered", "name": body.get("name")})
        else:
            self._json(404, {"error": "not found"})

    def do_GET(self):
        if self.path == "/peers":
            with LOCK:
                _cleanup()
                alive = {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")}
                         for k, v in PEERS.items()}
            self._json(200, {"peers": alive, "count": len(alive)})
        elif self.path.startswith("/health/"):
            name = self.path.split("/")[-1]
            with LOCK:
                ok = name in PEERS
            self._json(200, {"name": name, "alive": ok})
        else:
            self._json(404, {"error": "not found"})

    def do_DELETE(self):
        if self.path.startswith("/unregister/"):
            name = self.path.split("/")[-1]
            with LOCK:
                PEERS.pop(name, None)
            self._json(200, {"status": "unregistered", "name": name})
        else:
            self._json(404, {"error": "not found"})

def start_server():
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server

def get_peers() -> list:
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/peers", timeout=3) as r:
            data = json.loads(r.read().decode("utf-8"))
            return list(data.get("peers", {}).values())
    except: return []

def get_available_agents() -> list[dict]:
    """返回所有可用 Agent，按能力分组（默认 3 个内置 + registry peers）"""
    agents = [
        {"id": "coder", "label": "编码员", "capabilities": ["code", "implement", "write"], "source": "builtin"},
        {"id": "researcher", "label": "研究员", "capabilities": ["research", "analysis", "report"], "source": "builtin"},
        {"id": "auditor", "label": "审计员", "capabilities": ["audit", "review", "security"], "source": "builtin"},
    ]
    for peer in get_peers():
        agents.append({
            "id": peer.get("name", peer.get("id", "peer")),
            "label": peer.get("label", peer.get("id", "peer")),
            "capabilities": peer.get("capabilities", []),
            "source": "registry",
        })
    return agents

if __name__ == "__main__":
    data = json.loads(sys.stdin.read())
    fn = data.get("fn")
    args = data.get("args", [])
    func = globals().get(fn)
    if func == start_server:
        srv = start_server()
        print(json.dumps({"status": "running", "port": PORT}))
        srv.serve_forever()
    elif func:
        result = func(*args)
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(json.dumps({"_error": True, "message": f"unknown fn: {fn}"}))
