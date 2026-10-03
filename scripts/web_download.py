"""Download one public web video and report progress as JSON lines."""

import ipaddress
import json
import os
import socket
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import yt_dlp


def emit(**event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def public_address(host):
    try:
        addresses = [ipaddress.ip_address(host.strip("[]"))]
    except ValueError:
        addresses = [ipaddress.ip_address(item[4][0]) for item in original_getaddrinfo(host, None)]
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("Sono consentiti solo indirizzi web pubblici, non indirizzi locali o privati.")


def validate_url(value):
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Inserisci un URL pubblico HTTP o HTTPS valido, senza credenziali incorporate.")
    public_address(parsed.hostname)


# yt-dlp follows redirects and fetches player/media URLs. Check every socket
# destination as well as the initially submitted URL to prevent LAN access.
original_getaddrinfo = socket.getaddrinfo
original_connect = socket.socket.connect
original_connect_ex = socket.socket.connect_ex


def guarded_connect(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        public_address(address[0])
    return original_connect(self, address)


def guarded_connect_ex(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        public_address(address[0])
    return original_connect_ex(self, address)


socket.socket.connect = guarded_connect
socket.socket.connect_ex = guarded_connect_ex


def main():
    request = json.load(sys.stdin)
    url = request["url"]
    directory = Path(request["directory"]).resolve()
    max_bytes = int(request["maxBytes"])
    validate_url(url)
    directory.mkdir(parents=True, exist_ok=True)
    last_report = 0.0

    def progress(item):
        nonlocal last_report
        downloaded = int(item.get("downloaded_bytes") or 0)
        total = int(item.get("total_bytes") or item.get("total_bytes_estimate") or 0)
        if downloaded > max_bytes or total > max_bytes:
            raise ValueError("Il video supera il limite massimo configurato per gli upload.")
        now = time.monotonic()
        if item.get("status") == "finished" or now - last_report >= 0.5:
            emit(type="progress", downloadedBytes=downloaded, totalBytes=total,
                 speedBps=int(item.get("speed") or 0), etaSeconds=item.get("eta"))
            last_report = now

    options = {
        "outtmpl": str(directory / "video.%(ext)s"),
        "format": "bv*+ba/b",
        "noplaylist": True,
        "continuedl": True,
        "overwrites": False,
        "max_filesize": max_bytes,
        "progress_hooks": [progress],
        "quiet": True,
        "noprogress": True,
        "no_warnings": True,
        "restrictfilenames": True,
        "hls_prefer_native": True,
        "external_downloader": None,
        "proxies": {},
        "socket_timeout": 20,
        "retries": 3,
        "fragment_retries": 3,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=True)
    if not info:
        raise ValueError("Nessun video individuato nella pagina.")
    allowed = {".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".mpeg", ".mpg"}
    files = [item for item in directory.iterdir() if item.is_file() and item.suffix.lower() in allowed]
    if len(files) != 1:
        raise ValueError("La pagina non ha prodotto un singolo file video supportato da Frameo.")
    video = files[0]
    if video.stat().st_size > max_bytes:
        raise ValueError("Il video supera il limite massimo configurato per gli upload.")
    title = str(info.get("title") or "video").strip()
    safe_title = "".join(char if char.isalnum() or char in " -_.()" else "_" for char in title).strip(" ._")[:150] or "video"
    emit(type="complete", filePath=str(video), fileName=safe_title + video.suffix, bytes=video.stat().st_size)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit(type="error", message=str(error)[:1200])
        sys.exit(1)
