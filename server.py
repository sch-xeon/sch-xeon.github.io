from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import time
import uuid

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UPLOADS = DATA / "uploads"
EVENTS = DATA / "events.json"
SESSIONS = DATA / "sessions.json"
FRQ_IMAGES = DATA / "frq_images.json"


def read_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def write_json(path, payload):
    DATA.mkdir(exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


class PracticeHandler(SimpleHTTPRequestHandler):
    server_version = "APPractice/1.0"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/events"):
            self.send_json(read_json(EVENTS, []))
            return
        if self.path.startswith("/api/sessions"):
            self.send_json(read_json(SESSIONS, {}))
            return
        if self.path.startswith("/api/frq-images"):
            self.send_json(read_json(FRQ_IMAGES, {}))
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/event":
            payload = self.read_body()
            event = {
                "id": str(uuid.uuid4()),
                "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "type": payload.get("type", "event"),
                "sessionId": payload.get("sessionId"),
                "payload": payload.get("payload", {}),
            }
            events = read_json(EVENTS, [])
            events.append(event)
            write_json(EVENTS, events[-500:])
            self.update_session(event)
            self.send_json({"ok": True, "event": event})
            return
        if self.path == "/api/frq-image":
            self.handle_frq_image_upload()
            return
        if self.path == "/api/frq-image-delete":
            self.handle_frq_image_delete()
            return
        self.send_error(404)

    def read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    def handle_frq_image_upload(self):
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type or "boundary=" not in content_type:
            self.send_error(400, "Expected multipart/form-data")
            return
        length = int(self.headers.get("Content-Length", 0))
        if length > 15 * 1024 * 1024:
            self.send_error(413, "Image is too large")
            return
        raw = self.rfile.read(length)
        boundary = content_type.split("boundary=", 1)[1].strip().strip('"').encode()
        fields = parse_multipart(raw, boundary)
        question = fields.get("question", {}).get("value", "1")
        file_part = fields.get("image")
        try:
            qnum = int(question)
        except ValueError:
            qnum = 1
        if qnum not in range(1, 5) or not file_part or not file_part.get("content"):
            self.send_error(400, "Missing FRQ question or image")
            return
        filename = file_part.get("filename", "upload.png").lower()
        ext = Path(filename).suffix
        allowed = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
        if ext not in allowed:
            ext = ".png"
        UPLOADS.mkdir(parents=True, exist_ok=True)
        target = UPLOADS / f"frq-{qnum}-{int(time.time())}{ext}"
        target.write_bytes(file_part["content"])
        images = read_json(FRQ_IMAGES, {})
        images[str(qnum)] = {
            "question": qnum,
            "url": f"/data/uploads/{target.name}",
            "filename": target.name,
            "uploadedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        write_json(FRQ_IMAGES, images)
        self.send_json({"ok": True, "image": images[str(qnum)]})

    def handle_frq_image_delete(self):
        payload = self.read_body()
        try:
            qnum = int(payload.get("question", 0))
        except (TypeError, ValueError):
            qnum = 0
        if qnum not in range(1, 5):
            self.send_error(400, "Invalid FRQ question")
            return
        images = read_json(FRQ_IMAGES, {})
        image = images.pop(str(qnum), None)
        if image and image.get("filename"):
            target = (UPLOADS / image["filename"]).resolve()
            uploads_root = UPLOADS.resolve()
            if uploads_root in target.parents and target.exists():
                target.unlink()
        write_json(FRQ_IMAGES, images)
        self.send_json({"ok": True, "question": qnum})

    def update_session(self, event):
        sid = event.get("sessionId") or "unknown"
        sessions = read_json(SESSIONS, {})
        session = sessions.setdefault(sid, {"sessionId": sid, "events": 0})
        session["events"] = session.get("events", 0) + 1
        session["lastSeen"] = event["time"]
        session["lastType"] = event["type"]
        payload = event.get("payload", {})
        for key in ["studentName", "roomCode", "startCode", "section", "question", "answer"]:
            if key in payload:
                session[key] = payload[key]
        if event["type"] == "answer":
            answers = session.setdefault("answers", {})
            q = str(payload.get("question"))
            answers[q] = payload.get("answer")
        if event["type"] == "frq-response":
            frq = session.setdefault("frqResponses", {})
            q = str(payload.get("question"))
            frq[q] = payload.get("response", "")
        sessions[sid] = session
        write_json(SESSIONS, sessions)

    def send_json(self, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def parse_multipart(raw, boundary):
    fields = {}
    marker = b"--" + boundary
    for part in raw.split(marker):
        part = part.strip(b"\r\n")
        if not part or part == b"--" or b"\r\n\r\n" not in part:
            continue
        header_blob, content = part.split(b"\r\n\r\n", 1)
        content = content.rstrip(b"\r\n")
        headers = header_blob.decode("utf-8", errors="ignore").split("\r\n")
        disposition = next((h for h in headers if h.lower().startswith("content-disposition:")), "")
        attrs = {}
        for item in disposition.split(";")[1:]:
            if "=" in item:
                key, value = item.strip().split("=", 1)
                attrs[key] = value.strip('"')
        name = attrs.get("name")
        if not name:
            continue
        if "filename" in attrs:
            fields[name] = {"filename": attrs.get("filename"), "content": content}
        else:
            fields[name] = {"value": content.decode("utf-8", errors="ignore")}
    return fields


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    UPLOADS.mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get("PORT", "8765"))
    host = os.environ.get("HOST", "0.0.0.0")
    httpd = ThreadingHTTPServer((host, port), PracticeHandler)
    print(f"Serving AP Physics C practice app at http://127.0.0.1:{port}")
    print(f"Admin dashboard: http://127.0.0.1:{port}/admin.html")
    httpd.serve_forever()
