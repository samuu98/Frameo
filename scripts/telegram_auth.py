#!/usr/bin/env python3
"""Small Telethon bridge used only for Telegram user authentication."""

import asyncio
import json
import os
import sys
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from telethon.sessions import StringSession


storage_root = Path(os.environ.get("STORAGE_ROOT", "/app/storage")).resolve()
private_root = storage_root / "private"
sqlite_session = private_root / "telegram-telethon"
pending_path = private_root / "telegram-login-pending.json"
frameo_session_path = private_root / "telegram-session.json"


def read_input():
    return json.loads(sys.stdin.read() or "{}")


def write_result(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def save_frameo_session(client, api_id, api_hash):
    session = StringSession.save(client.session)
    frameo_session_path.write_text(
        json.dumps({"apiId": api_id, "apiHash": api_hash, "session": session}, indent=2) + "\n",
        encoding="utf-8",
    )
    os.chmod(frameo_session_path, 0o600)


async def request_code(data):
    api_id = int(data["apiId"])
    api_hash = str(data["apiHash"])
    phone = str(data["phone"])
    private_root.mkdir(parents=True, exist_ok=True)
    client = TelegramClient(str(sqlite_session), api_id, api_hash)
    await client.connect()
    try:
        if await client.is_user_authorized():
            save_frameo_session(client, api_id, api_hash)
            return {"authorized": True, "codeSent": False}
        sent = await client.send_code_request(phone)
        pending_path.write_text(
            json.dumps({
                "apiId": api_id,
                "apiHash": api_hash,
                "phone": phone,
                "phoneCodeHash": sent.phone_code_hash,
            }, indent=2) + "\n",
            encoding="utf-8",
        )
        os.chmod(pending_path, 0o600)
        delivery = sent.type.__class__.__name__.removeprefix("SentCodeType").lower()
        return {
            "authorized": False,
            "codeSent": True,
            "viaApp": delivery == "app",
            "delivery": delivery,
        }
    finally:
        await client.disconnect()


async def verify(data):
    if not pending_path.exists():
        raise RuntimeError("Nessun accesso Telegram in corso")
    pending = json.loads(pending_path.read_text(encoding="utf-8"))
    client = TelegramClient(str(sqlite_session), int(pending["apiId"]), pending["apiHash"])
    await client.connect()
    try:
        password = str(data.get("password") or "")
        try:
            if password:
                await client.sign_in(password=password)
            else:
                await client.sign_in(
                    phone=pending["phone"],
                    code=str(data.get("code") or ""),
                    phone_code_hash=pending["phoneCodeHash"],
                )
        except SessionPasswordNeededError:
            return {"authorized": False, "passwordRequired": True}
        if not await client.is_user_authorized():
            raise RuntimeError("Telegram non ha autorizzato la sessione")
        save_frameo_session(client, int(pending["apiId"]), pending["apiHash"])
        pending_path.unlink(missing_ok=True)
        return {"authorized": True, "passwordRequired": False}
    finally:
        await client.disconnect()


async def main():
    data = read_input()
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action == "request-code":
        write_result(await request_code(data))
    elif action == "verify":
        write_result(await verify(data))
    else:
        raise RuntimeError("Azione Telegram non valida")


try:
    asyncio.run(main())
except Exception as error:
    write_result({"error": str(error)})
    sys.exit(1)
