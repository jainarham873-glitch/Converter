import os
import sys
import uuid
import time
import shutil
import logging
import threading
from urllib.parse import quote

# Ensure static_ffmpeg paths are loaded so ffmpeg binary is readily available
try:
    import static_ffmpeg
    static_ffmpeg.add_paths()
except Exception as e:
    print(f"[Warning] Failed to initialize static_ffmpeg: {e}")

import yt_dlp
from flask import Flask, request, jsonify, render_template, send_file, Response
from flask_cors import CORS

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(BASE_DIR, "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# In-memory store for active and completed conversion tasks
tasks = {}

def get_ffmpeg_path():
    """Locate ffmpeg binary on the system or inside static_ffmpeg."""
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        return ffmpeg_bin
    # Fallback to local python lib path if available
    for path in os.environ.get("PATH", "").split(os.pathsep):
        candidate = os.path.join(path, "ffmpeg.exe")
        if os.path.isfile(candidate):
            return candidate
    return None

def clean_old_files():
    """Periodically clean up downloaded files older than 3 hours."""
    now = time.time()
    try:
        for fname in os.listdir(DOWNLOAD_DIR):
            fpath = os.path.join(DOWNLOAD_DIR, fname)
            if os.path.isfile(fpath) and (now - os.path.getmtime(fpath)) > 10800:
                os.remove(fpath)
    except Exception as e:
        print(f"[Cleanup Error] {e}")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/info", methods=["POST"])
def get_media_info():
    """Extract metadata (title, thumbnail, duration, author) from the provided link without downloading."""
    data = request.get_json() or {}
    url = data.get("url", "").strip()

    if not url:
        return jsonify({"success": False, "error": "Please provide a valid media link"}), 400

    ffmpeg_bin = get_ffmpeg_path()
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": False,
    }
    if ffmpeg_bin:
        ydl_opts["ffmpeg_location"] = ffmpeg_bin

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return jsonify({"success": False, "error": "Could not extract media info."}), 400

            title = info.get("title", "Unknown Title")
            duration_secs = info.get("duration") or 0
            minutes = int(duration_secs // 60)
            seconds = int(duration_secs % 60)
            duration_str = f"{minutes}:{seconds:02d}" if duration_secs else "Live / Unknown"
            uploader = info.get("uploader") or info.get("channel") or info.get("extractor_key") or "Web Media"
            thumbnail = info.get("thumbnail") or ""

            return jsonify({
                "success": True,
                "info": {
                    "title": title,
                    "uploader": uploader,
                    "duration": duration_str,
                    "thumbnail": thumbnail,
                    "url": url
                }
            })
    except Exception as e:
        err_msg = str(e)
        if "Unsupported URL" in err_msg:
            err_msg = "This URL format is not supported or not recognized."
        return jsonify({"success": False, "error": err_msg}), 400

def run_conversion_task(task_id, url, format_type, quality):
    """Background worker that downloads the link and converts to high-quality MP3 or MP4."""
    ffmpeg_bin = get_ffmpeg_path()
    output_template = os.path.join(DOWNLOAD_DIR, f"{task_id}.%(ext)s")
    final_file_path = os.path.join(DOWNLOAD_DIR, f"{task_id}.{format_type}")

    def progress_hook(d):
        if task_id not in tasks:
            return
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            percent = (downloaded / total * 100) if total > 0 else 0
            
            # Format speed
            speed_raw = d.get("speed")
            speed_str = f"{speed_raw / (1024 * 1024):.1f} MB/s" if speed_raw else "--"

            # Format ETA
            eta_raw = d.get("eta")
            eta_str = f"{eta_raw}s" if eta_raw else "--"

            tasks[task_id].update({
                "status": "downloading",
                "percent": round(min(percent, 95), 1),
                "speed": speed_str,
                "eta": eta_str
            })
        elif status == "finished":
            processing_label = "Encoding MP3 audio..." if format_type == "mp3" else "Processing MP4 video..."
            tasks[task_id].update({
                "status": "converting",
                "percent": 96,
                "speed": "Processing...",
                "eta": processing_label
            })

    if format_type == "mp4":
        # Video format selector based on chosen resolution
        if quality == "best":
            format_selector = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best"
        else:
            res_num = "".join(filter(str.isdigit, quality)) or "1080"
            format_selector = (
                f"bestvideo[height<={res_num}][ext=mp4]+bestaudio[ext=m4a]/"
                f"bestvideo[height<={res_num}]+bestaudio/"
                f"best[height<={res_num}][ext=mp4]/best"
            )

        ydl_opts = {
            "format": format_selector,
            "outtmpl": output_template,
            "merge_output_format": "mp4",
            "progress_hooks": [progress_hook],
            "quiet": True,
            "no_warnings": True,
        }
    else:
        # Default MP3 extraction
        bitrate_str = "".join(filter(str.isdigit, str(quality))) or "320"
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": output_template,
            "progress_hooks": [progress_hook],
            "quiet": True,
            "no_warnings": True,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": bitrate_str,
            }],
        }

    if ffmpeg_bin:
        ydl_opts["ffmpeg_location"] = ffmpeg_bin

    try:
        tasks[task_id]["status"] = "downloading"
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            meta = ydl.extract_info(url, download=True)
            title = meta.get("title", f"media_{task_id[:8]}")
            tasks[task_id]["title"] = title

        # Verify output file
        if not os.path.exists(final_file_path):
            # Sometimes yt-dlp outputs directly or with slightly different container, check directory
            for f in os.listdir(DOWNLOAD_DIR):
                if f.startswith(task_id) and f.endswith(f".{format_type}"):
                    final_file_path = os.path.join(DOWNLOAD_DIR, f)
                    break

        if os.path.exists(final_file_path):
            file_size_bytes = os.path.getsize(final_file_path)
            file_size_mb = f"{file_size_bytes / (1024 * 1024):.2f} MB"
            tasks[task_id].update({
                "status": "completed",
                "percent": 100,
                "file_size": file_size_mb,
                "download_url": f"/api/download/{task_id}",
                "stream_url": f"/api/stream/{task_id}"
            })
        else:
            tasks[task_id].update({
                "status": "error",
                "error": f"Converted {format_type.upper()} file was not generated."
            })
    except Exception as e:
        tasks[task_id].update({
            "status": "error",
            "error": str(e)
        })

@app.route("/api/convert", methods=["POST"])
def start_conversion():
    clean_old_files()
    data = request.get_json() or {}
    url = data.get("url", "").strip()
    format_type = data.get("format", "mp3").strip().lower()
    if format_type not in ("mp3", "mp4"):
        format_type = "mp3"

    quality = data.get("quality") or data.get("bitrate") or ("320" if format_type == "mp3" else "1080")

    if not url:
        return jsonify({"success": False, "error": "No URL provided"}), 400

    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "task_id": task_id,
        "url": url,
        "format": format_type,
        "quality": quality,
        "title": "Fetching details...",
        "status": "queued",
        "percent": 0,
        "speed": "--",
        "eta": "--",
        "file_size": "--",
        "created_at": time.time()
    }

    thread = threading.Thread(target=run_conversion_task, args=(task_id, url, format_type, quality), daemon=True)
    thread.start()

    return jsonify({"success": True, "task_id": task_id})

@app.route("/api/progress/<task_id>")
def get_progress(task_id):
    task = tasks.get(task_id)
    if not task:
        return jsonify({"success": False, "error": "Task not found"}), 404
    return jsonify({"success": True, "task": task})

def find_task_file(task_id):
    """Find the resulting file for a task (either mp3 or mp4)."""
    task = tasks.get(task_id)
    format_type = task.get("format", "mp3") if task else "mp3"
    
    preferred_path = os.path.join(DOWNLOAD_DIR, f"{task_id}.{format_type}")
    if os.path.exists(preferred_path):
        return preferred_path, format_type

    # Search for matching file
    for ext in ("mp4", "mp3"):
        alt_path = os.path.join(DOWNLOAD_DIR, f"{task_id}.{ext}")
        if os.path.exists(alt_path):
            return alt_path, ext

    return None, None

@app.route("/api/download/<task_id>")
def download_media(task_id):
    file_path, ext = find_task_file(task_id)
    if not file_path:
        return "File not found or expired.", 404

    task = tasks.get(task_id)
    clean_title = "media"
    if task and task.get("title"):
        clean_title = "".join(c for c in task["title"] if c.isalnum() or c in (" ", "-", "_", ".")).rstrip()
    if not clean_title:
        clean_title = f"{ext}_{task_id[:8]}"

    download_filename = f"{clean_title}.{ext}"
    mimetype = "video/mp4" if ext == "mp4" else "audio/mpeg"

    return send_file(
        file_path,
        mimetype=mimetype,
        as_attachment=True,
        download_name=download_filename
    )

@app.route("/api/stream/<task_id>")
def stream_media(task_id):
    file_path, ext = find_task_file(task_id)
    if not file_path:
        return "Media file not found.", 404

    mimetype = "video/mp4" if ext == "mp4" else "audio/mpeg"
    return send_file(
        file_path,
        mimetype=mimetype,
        as_attachment=False
    )

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("=" * 60)
    print("  SOUNDFLUX MP3 & MP4 CONVERTER SERVER RUNNING")
    print(f"  Access the Web UI at: http://127.0.0.1:{port}")
    print("=" * 60)
    app.run(host="0.0.0.0", port=port, debug=False)
