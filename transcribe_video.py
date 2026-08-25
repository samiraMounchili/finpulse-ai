import sys
import json
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp
from faster_whisper import WhisperModel

ALLOWED_HOSTS = {
    "youtube.com", "www.youtube.com", "youtu.be",
    "tiktok.com", "www.tiktok.com",
    "instagram.com", "www.instagram.com",
    "x.com", "www.x.com", "twitter.com", "www.twitter.com",
}

def fail(message):
    print(json.dumps({"success": False, "error": message}), flush=True)
    sys.exit(1)

if len(sys.argv) < 2:
    fail("No video link was provided.")

video_url = sys.argv[1].strip()

try:
    parsed = urlparse(video_url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        fail("Please use a public YouTube, TikTok, Instagram or X link.")

    with tempfile.TemporaryDirectory() as temp_dir:
        output_template = str(Path(temp_dir) / "video_audio.%(ext)s")
        ydl_options = {
            "format": "bestaudio/best",
            "outtmpl": output_template,
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "retries": 2,
            "socket_timeout": 20,
        }
        with yt_dlp.YoutubeDL(ydl_options) as ydl:
            info = ydl.extract_info(video_url, download=True)
            prepared = Path(ydl.prepare_filename(info))

        candidates = [prepared] if prepared.exists() else list(Path(temp_dir).glob("video_audio.*"))
        if not candidates:
            fail("FinPulse could not get audio from this public video.")

        # Use the already-cached tiny model for reliable laptop demos. The transcript stays editable in the UI.
        model = WhisperModel("tiny", device="cpu", compute_type="int8")
        segments, detected = model.transcribe(str(candidates[0]), vad_filter=True, beam_size=5)
        transcript = " ".join(s.text.strip() for s in segments if s.text.strip()).strip()
        if len(transcript) < 2:
            fail("FinPulse could not hear enough speech in this video.")

        print(json.dumps({
            "success": True,
            "transcript": transcript,
            "language": detected.language,
            "sourceTitle": (info or {}).get("title") or "",
            "sourceDescription": (info or {}).get("description") or ""
        }), flush=True)
except Exception as exc:
    # Keep technical detail out of the UI while still giving a useful fallback.
    fail("FinPulse could not read this video automatically. The platform may block access, the post may be private, or the audio may be unavailable. You can still paste the caption or words manually.")
