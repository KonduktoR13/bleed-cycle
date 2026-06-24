#!/usr/bin/env python3
import http.server
import socket
import socketserver
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def lan_ip():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def main():
    with socketserver.TCPServer(("0.0.0.0", 0), Handler) as httpd:
        port = httpd.server_address[1]
        ip = lan_ip()
        print("")
        print("PWA server is running")
        print(f"Open on Android in the same Wi-Fi: http://{ip}:{port}/")
        print(f"Local URL: http://127.0.0.1:{port}/")
        print("Press Ctrl+C to stop after the app is installed.")
        print("")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
