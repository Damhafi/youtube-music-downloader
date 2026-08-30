"""
YouTube Music Downloader — Servidor Local
Recebe URLs do YouTube via extensão Chrome e baixa como MP3 320kbps com capa.
"""

import json
import os
import sys
import threading
import uuid
import subprocess
import tkinter as tk
from tkinter import filedialog
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# ─── Config ────────────────────────────────────────────────────────────────────

CONFIG_FILE = Path(__file__).parent / "config.json"
DEFAULT_DOWNLOAD_DIR = str(Path.home() / "Music" / "YouTube Downloads")

def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"download_dir": DEFAULT_DOWNLOAD_DIR}

def save_config(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

# ─── App Setup ─────────────────────────────────────────────────────────────────

app = Flask(__name__, static_folder="static")
CORS(app)

# In-memory download state
downloads = {}  # id -> {status, progress, title, error, ...}

# ─── FFmpeg locator ────────────────────────────────────────────────────────────

def find_ffmpeg():
    """Try to locate ffmpeg in common locations."""
    # Check if it's on PATH
    import shutil
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return os.path.dirname(ffmpeg)

    # Common Windows locations
    common_paths = [
        Path(__file__).parent / "ffmpeg",
        Path(__file__).parent / "ffmpeg" / "bin",
        Path.home() / "ffmpeg" / "bin",
        Path("C:/ffmpeg/bin"),
        Path("C:/Program Files/ffmpeg/bin"),
    ]
    for p in common_paths:
        if (p / "ffmpeg.exe").exists():
            return str(p)

    return None

FFMPEG_DIR = find_ffmpeg()

# ─── yt-dlp Download Logic ────────────────────────────────────────────────────

def run_download(download_id, url, download_dir, playlist_mode=False):
    """Run yt-dlp in a subprocess to download audio as MP3 320kbps with cover art."""
    try:
        downloads[download_id]["status"] = "downloading"

        # Ensure output directory exists
        os.makedirs(download_dir, exist_ok=True)

        # Build yt-dlp command
        output_template = os.path.join(download_dir, "%(title)s.%(ext)s")

        cmd = [
            sys.executable, "-m", "yt_dlp",
            "-f", "bestaudio/best",
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",  # Highest possible MP3 quality (320kbps target)
            "--embed-thumbnail",     # Embed HD cover art
            "--add-metadata",        # Add full ID3 metadata tags
            "--parse-metadata", "%(title)s:%(meta_title)s",
            "--output", output_template,
            "--no-overwrites",
            "--progress",
            "--newline",             # Progress on new lines for parsing
        ]

        if playlist_mode:
            cmd.append("--yes-playlist")
        else:
            cmd.append("--no-playlist")

        # If ffmpeg found in custom location
        if FFMPEG_DIR:
            cmd.extend(["--ffmpeg-location", FFMPEG_DIR])

        cmd.append(url)

        # Run the process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )

        downloads[download_id]["pid"] = process.pid

        total_items = 1
        current_item = 0

        for line in process.stdout:
            line = line.strip()
            if not line:
                continue

            # Parse download progress
            if "[download]" in line:
                if "Downloading item" in line:
                    # Playlist progress: "Downloading item X of Y"
                    try:
                        parts = line.split("Downloading item")[1].strip().split(" of ")
                        current_item = int(parts[0])
                        total_items = int(parts[1])
                        downloads[download_id]["playlist_progress"] = f"{current_item}/{total_items}"
                    except (IndexError, ValueError):
                        pass
                elif "%" in line and "ETA" in line:
                    # Individual file progress
                    try:
                        pct = line.split("%")[0].split()[-1]
                        downloads[download_id]["progress"] = float(pct)
                    except (IndexError, ValueError):
                        pass
                elif "Destination:" in line:
                    filename = line.split("Destination:")[-1].strip()
                    downloads[download_id]["current_file"] = os.path.basename(filename)

            # Parse title
            if "[info]" in line and "Extracting URL" not in line:
                downloads[download_id]["info"] = line

            # Detect title from metadata
            if "title" in line.lower() and ":" in line:
                pass  # yt-dlp handles this

        process.wait()

        if process.returncode == 0:
            downloads[download_id]["status"] = "completed"
            downloads[download_id]["progress"] = 100
        else:
            downloads[download_id]["status"] = "error"
            downloads[download_id]["error"] = f"yt-dlp exited with code {process.returncode}"

    except Exception as e:
        downloads[download_id]["status"] = "error"
        downloads[download_id]["error"] = str(e)


def get_video_info(url):
    """Get video/playlist info without downloading."""
    try:
        cmd = [
            sys.executable, "-m", "yt_dlp",
            "--dump-json",
            "--no-download",
            "--flat-playlist",
            url,
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )

        if result.returncode != 0:
            return None

        # For playlists, yt-dlp outputs one JSON per line
        lines = [l for l in result.stdout.strip().split("\n") if l.strip()]
        if not lines:
            return None

        entries = []
        for line in lines:
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue

        if len(entries) == 1:
            info = entries[0]
            return {
                "type": "video",
                "title": info.get("title", "Unknown"),
                "thumbnail": info.get("thumbnail", ""),
                "duration": info.get("duration", 0),
                "channel": info.get("channel", info.get("uploader", "")),
                "url": url,
            }
        else:
            return {
                "type": "playlist",
                "title": entries[0].get("playlist_title", entries[0].get("title", "Playlist")),
                "count": len(entries),
                "entries": [
                    {
                        "title": e.get("title", "Unknown"),
                        "duration": e.get("duration", 0),
                        "url": e.get("url", e.get("webpage_url", "")),
                    }
                    for e in entries[:50]  # Limit preview to 50
                ],
                "url": url,
            }
    except subprocess.TimeoutExpired:
        return None
    except Exception:
        return None


# ─── API Routes ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/ping", methods=["GET"])
def ping():
    """Health check — extension uses this to verify server is running."""
    return jsonify({"status": "ok", "version": "1.0.0"})


@app.route("/api/info", methods=["POST"])
def video_info():
    """Get info about a URL without downloading."""
    data = request.json
    url = data.get("url", "")
    if not url:
        return jsonify({"error": "URL is required"}), 400

    info = get_video_info(url)
    if info:
        return jsonify(info)
    return jsonify({"error": "Could not fetch info"}), 400


@app.route("/api/download", methods=["POST"])
def start_download():
    """Start a download. Body: {url, playlist: bool, download_dir?: string}"""
    data = request.json
    url = data.get("url", "")
    playlist_mode = data.get("playlist", False)
    download_dir = data.get("download_dir", "")

    if not url:
        return jsonify({"error": "URL is required"}), 400

    # If single track mode, clean URL to isolate current video only
    if not playlist_mode:
        url = url.split("&list=")[0].split("&index=")[0]

    # Use provided dir, or saved config, or default
    if not download_dir:
        cfg = load_config()
        download_dir = cfg.get("download_dir", DEFAULT_DOWNLOAD_DIR)

    download_id = str(uuid.uuid4())[:8]
    downloads[download_id] = {
        "id": download_id,
        "url": url,
        "status": "queued",
        "progress": 0,
        "playlist_progress": "",
        "current_file": "",
        "error": "",
        "info": "",
        "download_dir": download_dir,
        "playlist": playlist_mode,
    }

    # Run download in background thread
    thread = threading.Thread(
        target=run_download,
        args=(download_id, url, download_dir, playlist_mode),
        daemon=True,
    )
    thread.start()

    return jsonify({"id": download_id, "status": "queued"})


@app.route("/api/download-batch", methods=["POST"])
def start_batch_download():
    """Start batch downloads from DOM-scraped playlist songs.
    Body: {songs: [{url, title, artist}, ...]}
    """
    data = request.json
    songs = data.get("songs", [])

    if not songs or not isinstance(songs, list):
        return jsonify({"error": "songs array is required"}), 400

    cfg = load_config()
    download_dir = cfg.get("download_dir", DEFAULT_DOWNLOAD_DIR)

    queued_ids = []
    for song in songs:
        url = song.get("url", "")
        if not url:
            continue

        # Clean URL: strip playlist params so yt-dlp only downloads this video
        clean_url = url.split("&list=")[0].split("&index=")[0]

        download_id = str(uuid.uuid4())[:8]
        title_hint = song.get("title", "")
        artist_hint = song.get("artist", "")
        label = f"{artist_hint} - {title_hint}" if artist_hint else title_hint

        downloads[download_id] = {
            "id": download_id,
            "url": clean_url,
            "status": "queued",
            "progress": 0,
            "playlist_progress": "",
            "current_file": label or clean_url,
            "error": "",
            "info": f"Da playlist: {label}" if label else "",
            "download_dir": download_dir,
            "playlist": False,
        }

        # Stagger downloads slightly to avoid hammering
        thread = threading.Thread(
            target=run_download,
            args=(download_id, clean_url, download_dir, False),
            daemon=True,
        )
        thread.start()
        queued_ids.append(download_id)

    return jsonify({
        "queued": len(queued_ids),
        "ids": queued_ids,
        "status": "batch_queued",
    })


@app.route("/api/progress/<download_id>", methods=["GET"])
def get_progress(download_id):
    """Get progress of a download."""
    if download_id not in downloads:
        return jsonify({"error": "Download not found"}), 404
    return jsonify(downloads[download_id])


@app.route("/api/downloads", methods=["GET"])
def list_downloads():
    """List all downloads."""
    return jsonify(list(downloads.values()))


@app.route("/api/cancel/<download_id>", methods=["POST"])
def cancel_download(download_id):
    """Cancel a running download."""
    if download_id not in downloads:
        return jsonify({"error": "Download not found"}), 404

    dl = downloads[download_id]
    if dl.get("pid"):
        try:
            import signal
            os.kill(dl["pid"], signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass

    dl["status"] = "cancelled"
    return jsonify({"status": "cancelled"})


@app.route("/api/settings", methods=["GET"])
def get_settings():
    cfg = load_config()
    return jsonify(cfg)


@app.route("/api/settings", methods=["POST"])
def update_settings():
    data = request.json
    cfg = load_config()
    cfg.update(data)
    save_config(cfg)
    return jsonify(cfg)


@app.route("/api/browse-folder", methods=["POST"])
def browse_folder():
    """Open native Windows folder picker dialog."""
    def pick_folder():
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(
            title="Escolha a pasta para salvar as músicas"
        )
        root.destroy()
        return folder

    # tkinter must run on main thread workaround
    result = {"folder": ""}
    def _pick():
        result["folder"] = pick_folder()

    t = threading.Thread(target=_pick)
    t.start()
    t.join(timeout=60)

    if result["folder"]:
        # Save to config
        cfg = load_config()
        cfg["download_dir"] = result["folder"]
        save_config(cfg)
        return jsonify({"folder": result["folder"]})

    return jsonify({"folder": ""})


# ─── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Ensure default download dir exists
    cfg = load_config()
    download_dir = cfg.get("download_dir", DEFAULT_DOWNLOAD_DIR)
    os.makedirs(download_dir, exist_ok=True)

    if not CONFIG_FILE.exists():
        save_config({"download_dir": download_dir})

    print("=" * 60)
    print("  [*] YouTube Music Downloader - Servidor Local")
    print(f"  [>] Pasta padrao: {download_dir}")
    print(f"  [>] Dashboard: http://localhost:5000")
    print(f"  [>] FFmpeg: {'Encontrado' if FFMPEG_DIR else 'Nao encontrado (necessario para MP3)'}")
    print("=" * 60)

    app.run(host="127.0.0.1", port=5000, debug=False)
