import hashlib
import json
import os
import re
import secrets
import time
import uuid
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
WEB_DIR = ROOT_DIR / "web"
STATIC_DIR = WEB_DIR / "static"

DATA_DIR.mkdir(exist_ok=True)

USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
CAMPAIGNS_FILE = DATA_DIR / "campaigns.json"
NOTIFICATIONS_FILE = DATA_DIR / "notifications.json"

WEB_HOST = os.getenv("WEB_HOST", "0.0.0.0")
WEB_PORT = int(os.getenv("PORT") or os.getenv("WEB_PORT") or "80")
PUBLIC_MAIN_URL = os.getenv("PUBLIC_MAIN_URL", "https://chamas-main.shardweb.app").rstrip("/")
MIXER_PUBLIC_URL = os.getenv("MIXER_PUBLIC_URL", "https://chamas-mixer.shardweb.app").rstrip("/")
DASHBOARD_KEY = os.getenv("DASHBOARD_KEY", "").strip()
FIRST_USER_ROLE = os.getenv("FIRST_USER_ROLE", "developer").strip().lower()

DEFAULT_SHEET_ID = "basic-white-html"
CHARACTER_SHEETS = [
    {
        "id": DEFAULT_SHEET_ID,
        "name": "Ficha basica em branco",
        "system": "Chamas da Guerra RPG",
        "description": "Ficha padrao para criar personagem.",
        "url": f"{MIXER_PUBLIC_URL}/static/sheets/basic/Ficha_Chamas_da_Guerra_Minimalista_Editavel.pdf",
    },
    {
        "id": "cyberpunk-html",
        "name": "Cyberpunk editavel",
        "system": "Chamas da Guerra RPG",
        "description": "Ficha Cyberpunk editavel direto no navegador.",
        "url": f"{MIXER_PUBLIC_URL}/static/sheets/cyberpunk/index.html",
    },
    {
        "id": "hack-html",
        "name": "Ficha Hack editavel",
        "system": "Chamas da Guerra RPG",
        "description": "Ficha Hack com visual terminal/circuito.",
        "url": f"{MIXER_PUBLIC_URL}/static/sheets/hack/index.html",
    },
]


class RegisterPayload(BaseModel):
    name: str
    password: str
    password_confirm: Optional[str] = None


class LoginPayload(BaseModel):
    name: str
    password: str


class ProfilePayload(BaseModel):
    display_name: Optional[str] = None
    about: Optional[str] = None


class ProfileAvatarPayload(BaseModel):
    avatar_url: Optional[str] = None


class FriendPayload(BaseModel):
    name: str


class CampaignPayload(BaseModel):
    name: str


class CampaignInvitePayload(BaseModel):
    user_id: str


class CampaignSheetPayload(BaseModel):
    sheet_id: str


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path: Path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    tmp.replace(path)


def load_users() -> dict:
    data = read_json(USERS_FILE, {"users": []})
    data.setdefault("users", [])
    return data


def save_users(data: dict):
    write_json(USERS_FILE, data)


def load_sessions() -> dict:
    data = read_json(SESSIONS_FILE, {"sessions": {}})
    data.setdefault("sessions", {})
    return data


def save_sessions(data: dict):
    write_json(SESSIONS_FILE, data)


def load_campaigns() -> dict:
    data = read_json(CAMPAIGNS_FILE, {"campaigns": []})
    data.setdefault("campaigns", [])
    return data


def save_campaigns(data: dict):
    write_json(CAMPAIGNS_FILE, data)


def load_notifications() -> dict:
    data = read_json(NOTIFICATIONS_FILE, {"notifications": []})
    data.setdefault("notifications", [])
    return data


def save_notifications(data: dict):
    write_json(NOTIFICATIONS_FILE, data)


def hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()
    return f"{salt}:{digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split(":", 1)
    except ValueError:
        return False
    return hash_password(password, salt).split(":", 1)[1] == digest


def clean_name(name: str) -> str:
    return re.sub(r"\s+", " ", str(name or "").strip())[:40]


def normalize_campaign_name(name: str) -> str:
    clean = re.sub(r"\s+", " ", str(name or "").strip())[:80]
    return clean or "Campanha"


def find_user_by_name(name: str) -> Optional[dict]:
    key = clean_name(name).lower()
    for user in load_users().get("users", []):
        if str(user.get("name", "")).strip().lower() == key:
            return user
    return None


def find_user_by_id(user_id: str) -> Optional[dict]:
    for user in load_users().get("users", []):
        if str(user.get("id")) == str(user_id):
            return user
    return None


def normalize_user(user: dict) -> dict:
    user.setdefault("display_name", user.get("name") or "")
    user.setdefault("about", "")
    user.setdefault("friends", [])
    user.setdefault("avatar_url", "")
    user.setdefault("role", "user")
    return user


def public_user(user: Optional[dict]) -> Optional[dict]:
    if not user:
        return None
    user = normalize_user(dict(user))
    role = user.get("role", "user")
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "display_name": user.get("display_name") or user.get("name"),
        "about": user.get("about") or "",
        "avatar_url": user.get("avatar_url") or "",
        "role": role,
        "is_admin": role in {"admin", "developer"},
    }


def create_session(user: dict) -> str:
    token = "cm_" + secrets.token_urlsafe(32)
    sessions = load_sessions()
    sessions["sessions"][token] = {
        "user_id": user["id"],
        "created_at": int(time.time()),
        "last_seen": int(time.time()),
    }
    save_sessions(sessions)
    return token


def auth_context_from_token(token: Optional[str]) -> Optional[dict]:
    if DASHBOARD_KEY and token == DASHBOARD_KEY:
        return {
            "id": "dashboard-key",
            "name": "Admin",
            "display_name": "Admin",
            "role": "developer",
            "is_admin": True,
            "legacy_key": True,
        }
    if not token:
        return None
    sessions = load_sessions()
    session = sessions.get("sessions", {}).get(token)
    if not session:
        return None
    user = find_user_by_id(session.get("user_id"))
    if not user:
        return None
    session["last_seen"] = int(time.time())
    sessions["sessions"][token] = session
    save_sessions(sessions)
    return public_user(user)


def require_user(x_dashboard_key: Optional[str]) -> dict:
    ctx = auth_context_from_token(x_dashboard_key)
    if not ctx:
        raise HTTPException(status_code=401, detail="Login invalido ou sessao expirada.")
    return ctx


def sheet_by_id(sheet_id: Optional[str]) -> dict:
    wanted = str(sheet_id or DEFAULT_SHEET_ID)
    for sheet in CHARACTER_SHEETS:
        if sheet["id"] == wanted:
            return dict(sheet)
    return dict(CHARACTER_SHEETS[0])


def add_notification(user_id: str, kind: str, title: str, message: str, campaign_id: Optional[str] = None):
    data = load_notifications()
    data["notifications"].append({
        "id": str(uuid.uuid4())[:12],
        "user_id": str(user_id),
        "kind": kind,
        "title": title[:90],
        "message": message[:280],
        "campaign_id": campaign_id,
        "status": "unread",
        "created_at": int(time.time()),
    })
    data["notifications"] = data["notifications"][-500:]
    save_notifications(data)


def campaign_visible(campaign: dict, ctx: dict) -> bool:
    if ctx.get("is_admin") or ctx.get("legacy_key"):
        return True
    uid = str(ctx.get("id"))
    return uid == str(campaign.get("owner_id")) or uid in [str(item) for item in campaign.get("member_ids", [])]


def campaign_owned(campaign: dict, ctx: dict) -> bool:
    if ctx.get("is_admin") or ctx.get("legacy_key"):
        return True
    return str(ctx.get("id")) == str(campaign.get("owner_id"))


def campaign_to_dict(campaign: dict, ctx: dict) -> dict:
    member_ids = [str(item) for item in campaign.get("member_ids", [])]
    members = [public_user(find_user_by_id(member_id)) for member_id in member_ids]
    members = [item for item in members if item]
    owner = public_user(find_user_by_id(str(campaign.get("owner_id") or "")))
    is_owner = str(ctx.get("id")) == str(campaign.get("owner_id"))
    return {
        "id": campaign.get("id"),
        "name": campaign.get("name"),
        "owner": owner or {
            "id": campaign.get("owner_id"),
            "name": campaign.get("owner_name") or "Mestre",
            "display_name": campaign.get("owner_name") or "Mestre",
        },
        "owner_id": campaign.get("owner_id"),
        "owner_name": campaign.get("owner_name"),
        "members": members,
        "member_ids": member_ids,
        "main_sheet_id": campaign.get("main_sheet_id") or DEFAULT_SHEET_ID,
        "main_sheet": sheet_by_id(campaign.get("main_sheet_id")),
        "created_at": campaign.get("created_at"),
        "updated_at": campaign.get("updated_at"),
        "is_owner": is_owner,
        "can_manage": campaign_owned(campaign, ctx),
        "role": "mestre" if is_owner else "jogador",
    }


def build_social_state(ctx: dict) -> dict:
    user = find_user_by_id(str(ctx.get("id"))) if not ctx.get("legacy_key") else None
    profile = public_user(user) if user else ctx
    friend_cards = []
    if user:
        normalize_user(user)
        for friend_id in user.get("friends", []):
            friend = public_user(find_user_by_id(str(friend_id)))
            if friend:
                friend_cards.append(friend)
    campaigns = [
        campaign_to_dict(campaign, ctx)
        for campaign in load_campaigns().get("campaigns", [])
        if campaign_visible(campaign, ctx)
    ]
    campaigns.sort(key=lambda item: (item.get("name") or "").lower())
    notifications = [
        dict(item)
        for item in load_notifications().get("notifications", [])
        if str(item.get("user_id")) == str(ctx.get("id"))
    ]
    notifications.sort(key=lambda item: int(item.get("created_at") or 0), reverse=True)
    return {
        "profile": profile,
        "friends": friend_cards,
        "campaigns": campaigns,
        "notifications": notifications[:80],
        "sheets": CHARACTER_SHEETS,
        "tools": [
            {
                "id": "mixer",
                "name": "Mixer",
                "description": "Audio, cenas, biblioteca sonora e Discord.",
                "url": MIXER_PUBLIC_URL,
            }
        ],
    }


app = FastAPI(title="Chamas Main", version="1.0.0")

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/health")
async def health():
    return {
        "ok": True,
        "app": "chamas-main",
        "public_main_url": PUBLIC_MAIN_URL,
        "mixer_public_url": MIXER_PUBLIC_URL,
    }


@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/dashboard")
async def dashboard():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
async def api_config():
    return {
        "app": "chamas-main",
        "public_main_url": PUBLIC_MAIN_URL,
        "mixer_public_url": MIXER_PUBLIC_URL,
    }


@app.get("/api/auth/status")
async def api_auth_status():
    return {"ok": True, "has_users": bool(load_users().get("users"))}


@app.post("/api/auth/register")
async def api_auth_register(payload: RegisterPayload):
    name = clean_name(payload.name)
    password = payload.password or ""
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Use um nome com pelo menos 2 caracteres.")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Use uma senha com pelo menos 4 caracteres.")
    if password != (payload.password_confirm or ""):
        raise HTTPException(status_code=400, detail="As senhas nao conferem.")
    if find_user_by_name(name):
        raise HTTPException(status_code=400, detail="Esse nome ja existe.")

    store = load_users()
    role = FIRST_USER_ROLE if not store.get("users") and FIRST_USER_ROLE in {"user", "admin", "developer"} else "user"
    user = {
        "id": str(uuid.uuid4())[:12],
        "name": name,
        "display_name": name,
        "about": "",
        "avatar_url": "",
        "role": role,
        "friends": [],
        "password_hash": hash_password(password),
        "created_at": int(time.time()),
    }
    store["users"].append(user)
    save_users(store)
    token = create_session(user)
    return {"token": token, "user": public_user(user)}


@app.post("/api/auth/login")
async def api_auth_login(payload: LoginPayload):
    user = find_user_by_name(payload.name or "")
    if not verify_password(payload.password or "", (user or {}).get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Nome ou senha invalidos.")
    token = create_session(user)
    return {"token": token, "user": public_user(user)}


@app.post("/api/auth/logout")
async def api_auth_logout(x_dashboard_key: Optional[str] = Header(default=None)):
    if x_dashboard_key:
        sessions = load_sessions()
        sessions.get("sessions", {}).pop(x_dashboard_key, None)
        save_sessions(sessions)
    return {"ok": True}


@app.get("/api/me")
async def api_me(x_dashboard_key: Optional[str] = Header(default=None)):
    return {"user": require_user(x_dashboard_key)}


@app.get("/api/social/state")
async def api_social_state(x_dashboard_key: Optional[str] = Header(default=None)):
    return build_social_state(require_user(x_dashboard_key))


@app.post("/api/profile")
async def api_profile_update(payload: ProfilePayload, x_dashboard_key: Optional[str] = Header(default=None)):
    ctx = require_user(x_dashboard_key)
    if ctx.get("legacy_key"):
        raise HTTPException(status_code=400, detail="Entre com uma conta normal.")
    display_name = re.sub(r"\s+", " ", str(payload.display_name or "").strip())[:60]
    about = str(payload.about or "").strip()[:500]
    if not display_name:
        raise HTTPException(status_code=400, detail="Digite um nome para o perfil.")
    store = load_users()
    updated = None
    for user in store.get("users", []):
        if str(user.get("id")) == str(ctx.get("id")):
            user["display_name"] = display_name
            user["about"] = about
            updated = user
            break
    if not updated:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    save_users(store)
    return build_social_state(public_user(updated))


@app.post("/api/profile/avatar")
async def api_profile_avatar(payload: ProfileAvatarPayload, x_dashboard_key: Optional[str] = Header(default=None)):
    ctx = require_user(x_dashboard_key)
    avatar_url = (payload.avatar_url or "").strip()
    if avatar_url and (not avatar_url.startswith("data:image/") or len(avatar_url) > 350_000):
        raise HTTPException(status_code=400, detail="Use PNG, JPG ou WebP menor.")
    store = load_users()
    updated = None
    for user in store.get("users", []):
        if str(user.get("id")) == str(ctx.get("id")):
            user["avatar_url"] = avatar_url
            updated = user
            break
    if not updated:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    save_users(store)
    return {"user": public_user(updated)}


@app.post("/api/friends")
async def api_add_friend(payload: FriendPayload, x_dashboard_key: Optional[str] = Header(default=None)):
    ctx = require_user(x_dashboard_key)
    target_name = clean_name(payload.name)
    store = load_users()
    actor = None
    target = None
    for user in store.get("users", []):
        normalize_user(user)
        if str(user.get("id")) == str(ctx.get("id")):
            actor = user
        if str(user.get("name", "")).strip().lower() == target_name.lower():
            target = user
    if not actor or not target:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    if str(actor.get("id")) == str(target.get("id")):
        raise HTTPException(status_code=400, detail="Voce ja esta no proprio perfil.")
    actor_friends = [str(item) for item in actor.get("friends", [])]
    target_friends = [str(item) for item in target.get("friends", [])]
    if str(target.get("id")) not in actor_friends:
        actor_friends.append(str(target.get("id")))
    if str(actor.get("id")) not in target_friends:
        target_friends.append(str(actor.get("id")))
    actor["friends"] = actor_friends
    target["friends"] = target_friends
    save_users(store)
    add_notification(str(target.get("id")), "friend_add", "Novo perfil", f'{actor.get("display_name") or actor.get("name")} adicionou voce.')
    return build_social_state(public_user(actor))


@app.delete("/api/friends/{friend_id}")
async def api_remove_friend(friend_id: str, x_dashboard_key: Optional[str] = Header(default=None)):
    ctx = require_user(x_dashboard_key)
    store = load_users()
    actor = None
    target = None
    for user in store.get("users", []):
        if str(user.get("id")) == str(ctx.get("id")):
            actor = user
        if str(user.get("id")) == str(friend_id):
            target = user
    if not actor or not target:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    actor["friends"] = [item for item in actor.get("friends", []) if str(item) != str(target.get("id"))]
    target["friends"] = [item for item in target.get("friends", []) if str(item) != str(actor.get("id"))]
    save_users(store)
    return build_social_state(public_user(actor))


@app.post("/api/campaigns")
async def api_create_campaign(payload: CampaignPayload, x_dashboard_key: Optional[str] = Header(default=None)):
    ctx = require_user(x_dashboard_key)
    name = normalize_campaign_name(payload.name)
    data = load_campaigns()
    campaign = {
        "id": str(uuid.uuid4())[:12],
        "name": name,
        "owner_id": str(ctx.get("id")),
        "owner_name": ctx.get("display_name") or ctx.get("name"),
        "member_ids": [str(ctx.get("id"))],
        "main_sheet_id": DEFAULT_SHEET_ID,
        "created_at": int(time.time()),
        "updated_at": int(time.time()),
    }
    data["campaigns"].append(campaign)
    save_campaigns(data)
    return build_social_state(ctx)


@app.post("/api/campaigns/{campaign_id}/invite")
async def api_campaign_invite(campaign_id: str, payload: CampaignInvitePayload, x_dashboard_key: Optional[str] = Header(default=None)):
    ctx = require_user(x_dashboard_key)
    target = find_user_by_id(str(payload.user_id))
    if not target:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    data = load_campaigns()
    campaign = next((item for item in data.get("campaigns", []) if str(item.get("id")) == str(campaign_id)), None)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha nao encontrada.")
    if not campaign_owned(campaign, ctx):
        raise HTTPException(status_code=403, detail="Apenas o mestre pode convidar.")
    members = [str(item) for item in campaign.get("member_ids", [])]
    if str(target.get("id")) not in members:
        members.append(str(target.get("id")))
    campaign["member_ids"] = members
    campaign["updated_at"] = int(time.time())
    save_campaigns(data)
    add_notification(str(target.get("id")), "campaign_added", "Campanha adicionada", f'Voce entrou em "{campaign.get("name")}".', campaign.get("id"))
    return build_social_state(ctx)


@app.post("/api/campaigns/{campaign_id}/sheet")
async def api_campaign_sheet(campaign_id: str, payload: CampaignSheetPayload, x_dashboard_key: Optional[str] = Header(default=None)):
    ctx = require_user(x_dashboard_key)
    sheet = sheet_by_id(payload.sheet_id)
    data = load_campaigns()
    campaign = next((item for item in data.get("campaigns", []) if str(item.get("id")) == str(campaign_id)), None)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha nao encontrada.")
    if not campaign_owned(campaign, ctx):
        raise HTTPException(status_code=403, detail="Apenas o mestre pode trocar a ficha.")
    campaign["main_sheet_id"] = sheet["id"]
    campaign["updated_at"] = int(time.time())
    save_campaigns(data)
    return build_social_state(ctx)


if __name__ == "__main__":
    uvicorn.run(app, host=WEB_HOST, port=WEB_PORT)
