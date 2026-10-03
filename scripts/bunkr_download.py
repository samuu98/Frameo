"""Discover public Bunkr album videos or download one through its player URL."""

import html
import json
import os
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from web_download import public_address


VIDEO_EXTENSIONS = (".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".mpeg", ".mpg")
ALLOWED_HOSTS = {"bunkr.pk", "www.bunkr.pk", "glb-apisign.cdn.cr"}


def emit(**event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def checked_url(url, allow_cdn=False):
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password or not host:
        raise ValueError("Il link Bunkr deve usare HTTPS senza credenziali incorporate.")
    if host not in ALLOWED_HOSTS and not (allow_cdn and host.endswith(".cdn.cr")):
        raise ValueError("La pagina Bunkr ha indicato un server video non previsto.")
    public_address(host)
    return parsed


class SafeRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        checked_url(newurl, allow_cdn=True)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


opener = build_opener(ProxyHandler({}), SafeRedirects())


def fetch(url, limit=2_000_000):
    checked_url(url, allow_cdn=True)
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 Frameo/1.0"})
    with opener.open(request, timeout=25) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("La pagina Bunkr è troppo grande.")
        return data


class AlbumParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current = None
        self.videos = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if self.current is not None and tag == "div":
            self.current["depth"] += 1
        elif tag == "div" and "theItem" in attrs.get("class", "").split():
            self.current = {"title": html.unescape(attrs.get("title", "")), "depth": 1, "href": None}
        if self.current is not None and tag == "a":
            href = attrs.get("href", "")
            if re.fullmatch(r"/f/[A-Za-z0-9_-]+", href):
                self.current["href"] = href

    def handle_endtag(self, tag):
        if self.current is None or tag != "div":
            return
        self.current["depth"] -= 1
        if self.current["depth"] == 0:
            item = self.current
            if item["href"] and item["title"].lower().endswith(VIDEO_EXTENSIONS):
                self.videos.append("https://bunkr.pk" + item["href"])
            self.current = None


def discover(url):
    parsed = checked_url(url)
    if not re.fullmatch(r"/a/[A-Za-z0-9_-]+/?", parsed.path):
        raise ValueError("Il link Bunkr non è un album pubblico.")
    parser = AlbumParser()
    parser.feed(fetch(url).decode("utf-8", errors="replace"))
    videos = list(dict.fromkeys(parser.videos))
    if not videos:
        raise ValueError("Nessun video trovato nell'album Bunkr.")
    if len(videos) > 100:
        raise ValueError("L'album contiene più di 100 video; scegli un album più piccolo.")
    emit(type="discovery", urls=videos)


def js_variable(document, name):
    match = re.search(r"\bvar\s+" + re.escape(name) + r"\s*=\s*(\"(?:[^\"\\]|\\.)*\")", document)
    if not match:
        raise ValueError("Il player Bunkr non espone l'indirizzo del video.")
    return json.loads(match.group(1))


def download(url, directory, max_bytes):
    parsed = checked_url(url)
    if not re.fullmatch(r"/f/[A-Za-z0-9_-]+/?", parsed.path):
        raise ValueError("Il link Bunkr deve puntare a un singolo video.")
    document = fetch(url).decode("utf-8", errors="replace")
    title_match = re.search(r"<h1\b[^>]*>(.*?)</h1>", document, re.IGNORECASE | re.DOTALL)
    title = html.unescape(re.sub(r"<[^>]+>", "", title_match.group(1))).strip() if title_match else "video.mp4"
    file_name = Path(title).name
    if not file_name.lower().endswith(VIDEO_EXTENSIONS):
        raise ValueError("La pagina Bunkr non contiene un video supportato.")

    media_url = js_variable(document, "jsCDN")
    media_parts = checked_url(media_url, allow_cdn=True)
    if not media_parts.path.lower().endswith(VIDEO_EXTENSIONS):
        raise ValueError("Il player Bunkr non ha indicato un file video.")
    sign_url = js_variable(document, "signUrl")
    sign_parts = checked_url(sign_url)
    if sign_parts.hostname != "glb-apisign.cdn.cr" or sign_parts.path != "/sign":
        raise ValueError("Il server di firma Bunkr non è quello previsto.")
    token_data = json.loads(fetch(sign_url + "?" + urlencode({"path": media_parts.path}), 10000))
    if not isinstance(token_data.get("token"), str) or not isinstance(token_data.get("ex"), int):
        raise ValueError("Bunkr non ha autorizzato il flusso video pubblico.")
    signed_url = urlunsplit((media_parts.scheme, media_parts.netloc, media_parts.path,
                            urlencode({"token": token_data["token"], "ex": token_data["ex"]}), ""))

    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    partial = directory / ("video" + Path(file_name).suffix.lower() + ".part")
    output = directory / ("video" + Path(file_name).suffix.lower())
    offset = partial.stat().st_size if partial.exists() else 0
    headers = {"User-Agent": "Mozilla/5.0 Frameo/1.0"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    checked_url(signed_url, allow_cdn=True)
    with opener.open(Request(signed_url, headers=headers), timeout=30) as response:
        if offset and response.status != 206:
            offset = 0
        remaining = int(response.headers.get("Content-Length") or 0)
        total = offset + remaining if remaining else 0
        content_range = response.headers.get("Content-Range", "")
        range_match = re.search(r"/(\d+)$", content_range)
        if range_match:
            total = int(range_match.group(1))
        if total > max_bytes:
            raise ValueError("Il video supera il limite massimo configurato per gli upload.")
        emit(type="metadata", fileName=file_name, totalBytes=total)
        downloaded = offset
        previous_bytes = downloaded
        previous_time = time.monotonic()
        last_report = 0
        with partial.open("ab" if offset else "wb") as output_file:
            while True:
                chunk = response.read(512 * 1024)
                if not chunk:
                    break
                output_file.write(chunk)
                downloaded += len(chunk)
                if downloaded > max_bytes:
                    raise ValueError("Il video supera il limite massimo configurato per gli upload.")
                now = time.monotonic()
                if now - last_report >= 0.5 or (total and downloaded >= total):
                    seconds = max(0.001, now - previous_time)
                    speed = max(0, round((downloaded - previous_bytes) / seconds))
                    eta = round((total - downloaded) / speed) if total > downloaded and speed else None
                    emit(type="progress", downloadedBytes=downloaded, totalBytes=total,
                         speedBps=speed, etaSeconds=eta)
                    previous_bytes, previous_time, last_report = downloaded, now, now
    if total and downloaded != total:
        raise ValueError(f"Download Bunkr incompleto: {downloaded} byte su {total}.")
    os.replace(partial, output)
    emit(type="complete", filePath=str(output), fileName=file_name, bytes=downloaded)


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        if request.get("action") == "discover":
            discover(request["url"])
        else:
            download(request["url"], request["directory"], int(request["maxBytes"]))
    except Exception as error:
        emit(type="error", message=str(error)[:1200])
        sys.exit(1)
