"""
Public URL generator for local HTTP server.
Uses ngrok (recommended) or falls back to manual setup.
Usage: python tunnel.py [port]
"""
import sys
import subprocess
import os
import time
import json
import urllib.request
import re

def get_public_ip():
    try:
        return urllib.request.urlopen("https://api.ipify.org", timeout=5).read().decode()
    except Exception:
        return "unknown"

def find_ngrok():
    """Find ngrok executable."""
    candidates = [
        "ngrok",
        r".\ngrok.exe",
        r"..\ngrok.exe",
        os.path.join(os.environ.get('USERPROFILE', ''), 'ngrok.exe'),
    ]
    for path in candidates:
        try:
            r = subprocess.run([path, "--version"], capture_output=True, timeout=3)
            if r.returncode == 0:
                return path
        except Exception:
            continue
    return None

def run_ngrok_tunnel(port):
    """Start ngrok tunnel and return the public URL."""
    ngrok = find_ngrok()
    if not ngrok:
        return None, "ngrok not found. Download from https://ngrok.com/download"

    cmd = [ngrok, "http", str(port), "--log", "stdout"]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True
    )

    # Wait for URL in output
    start = time.time()
    url = None
    while time.time() - start < 15:
        if proc.poll() is not None:
            break
        line = proc.stdout.readline()
        if not line:
            continue
        sys.stdout.write(line)
        sys.stdout.flush()
        # Parse ngrok URL from output
        match = re.search(r'https?://[\w\-]+\.ngrok[-\w]*\.com', line)
        if match:
            url = match.group(0)

    proc.terminate()
    return url, None


def run_manual_ngrok(port):
    """Run ngrok interactively so user can see the URL."""
    ngrok = find_ngrok()
    if not ngrok:
        print("\n[ERROR] ngrok not found.")
        print("\nTo get ngrok:")
        print("  1. Sign up: https://ngrok.com/signup")
        print("  2. Get token: https://dashboard.ngrok.com/get-started/your-authtoken")
        print("  3. Download: https://ngrok.com/download")
        print(f"  4. Extract and place ngrok.exe in this folder")
        print(f"  5. Run: ngrok authtoken YOUR_TOKEN")
        print(f"  6. Run: ngrok http {port}")
        return

    print(f"\nStarting ngrok tunnel for port {port}...")
    print("Your public URL will appear above.\n")
    print("="*50)

    proc = subprocess.Popen([ngrok, "http", str(port)], cwd=os.path.dirname(os.path.abspath(__file__)))
    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\nStopping...")
        proc.terminate()
        proc.wait(timeout=3)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

    print(f"Local server: http://localhost:{port}")
    print(f"Public IP:    {get_public_ip()}")
    print()

    # Check if HTTP server is running
    try:
        urllib.request.urlopen(f"http://localhost:{port}", timeout=2)
        print(f"[OK] HTTP server is running on port {port}")
    except Exception as e:
        print(f"[WARN] Cannot connect to localhost:{port} - is the server running?")
        print(f"       Start it with: python -m http.server {port} --bind 0.0.0.0")
        print()

    # Try non-interactive ngrok first (for scripting)
    print("\nAttempting to start tunnel...")
    url, err = run_ngrok_tunnel(port)

    if url:
        print(f"\n{'='*50}")
        print(f"PUBLIC URL: {url}")
        print(f"{'='*50}")
        print(f"\nShare this URL with devices on any network.")
        print(f"The tunnel will close when you close this window.")
        return
    elif err:
        print(f"\n[INFO] {err}")

    # Fall back to interactive mode
    run_manual_ngrok(port)


if __name__ == "__main__":
    main()
