"""Static file server for local development.

No caching, correct MIME types, and the same security headers the production
config sends, so a CSP mistake shows up here rather than after a deploy.
"""
import http.server
import socketserver
import sys

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; "
    "manifest-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; "
    "form-action 'none'; frame-ancestors 'none'"
)

SECURITY = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Service-Worker-Allowed', '/')
        for key, value in SECURITY.items():
            self.send_header(key, value)
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s\n' % (fmt % args))


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', port), Handler) as httpd:
    print(f'serving on http://localhost:{port}')
    httpd.serve_forever()
