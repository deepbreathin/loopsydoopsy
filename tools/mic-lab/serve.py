"""Serves the repo for the mic lab and saves POSTed results to tools/mic-lab/results/.

Run from anywhere:  python3 tools/mic-lab/serve.py [port]
Phone over USB/wireless ADB:  adb reverse tcp:8731 tcp:8731, then open
http://localhost:8731/tools/mic-lab/lab.html (localhost counts as secure, so the mic works).
"""
import http.server
import json
import os
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path.startswith('/audio'):
            return self.save_audio()
        if self.path != '/results':
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        os.makedirs(OUT, exist_ok=True)
        data = json.loads(body)
        name = time.strftime('%Y%m%d-%H%M%S') + ('-firefox' if 'Firefox' in data.get('ua', '') else '-chrome') + '.json'
        with open(os.path.join(OUT, name), 'w') as f:
            json.dump(data, f, indent=1)
        print('saved', name, flush=True)
        self.send_response(204)
        self.end_headers()


    def save_audio(self):
        # Raw float32 mono samples -> 16-bit WAV in results/.
        import array, urllib.parse, wave
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        name = ''.join(c for c in q.get('name', ['take'])[0] if c.isalnum() or c in '-_ ').replace(' ', '_')
        sr = int(q.get('sr', ['48000'])[0])
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        f = array.array('f'); f.frombytes(body)
        pcm = array.array('h', (max(-32768, min(32767, int(v * 32767))) for v in f))
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, time.strftime('%Y%m%d-%H%M%S-') + name + '.wav')
        with wave.open(path, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
        f.tofile(open(path[:-4] + '.f32', 'wb'))
        print('saved', path, flush=True)
        self.send_response(204)
        self.end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8222
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
