import base64
import logging
from urllib.parse import parse_qs, urlsplit

import aiohttp
import bilibili_api
import bilibili_api.login_v2 as login
from bilibili_api import Credential

from .credential_refresh import ensure_buvid3
from .credential_store import save_credential
from ..logging_utils import auth_log

logger = logging.getLogger(__name__)


async def get_login_url():
    try:
        auth_log(logger, "info", "login-qrcode-start")
        q = login.QrCodeLogin(login.QrCodeLoginChannel.WEB)
        await q.generate_qrcode()
        qr_link = q._QrCodeLogin__qr_link
        qr_key = q._QrCodeLogin__qr_key
        embedded_key = parse_qs(urlsplit(qr_link).query).get("qrcode_key", [""])[0]
        if not qr_key or embedded_key != qr_key:
            raise ValueError("Bilibili login QR key mismatch")
        picture = q.get_qrcode_picture()
        if not picture or not picture.content:
            raise ValueError("Bilibili login QR image is empty")
        qr_image = "data:image/png;base64," + base64.b64encode(picture.content).decode("ascii")
        auth_log(logger, "info", "login-qrcode-ready")
        return {
            "status": "success",
            "data": {"url": qr_link, "key": qr_key, "image": qr_image},
        }
    except Exception as e:
        auth_log(logger, "error", "login-qrcode-failed", error=str(e))
        return {"status": "error", "message": str(e)}


async def _poll_qrcode(qrcode_key):
    # The SDK only reads cookies embedded in data.url, losing Set-Cookie headers.
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=15),
        headers=bilibili_api.HEADERS.copy(),
        cookie_jar=aiohttp.DummyCookieJar(),
    ) as session:
        async with session.get(
            "https://passport.bilibili.com/x/passport-login/web/qrcode/poll",
            params={"qrcode_key": qrcode_key, "source": "main-fe-header"},
            allow_redirects=False,
        ) as response:
            response.raise_for_status()
            payload = await response.json()
            cookies = {name: value.value for name, value in response.cookies.items()}
            return payload, cookies


async def poll_login(qrcode_key, group_id=None):
    try:
        payload, cookies = await _poll_qrcode(qrcode_key)
        if payload.get("code") != 0 or not isinstance(payload.get("data"), dict):
            return {"status": "error", "message": "B站登录接口返回异常，请重新扫码"}
        data = payload["data"]
        code = data.get("code")
        if code == 86101:
            return {"status": "pending", "code": code, "message": "等待扫码"}
        if code == 86090:
            return {"status": "pending", "code": code, "message": "已扫码，请在手机上确认"}
        if code == 86038:
            return {"status": "error", "code": code, "message": "二维码已过期"}
        if code != 0:
            return {"status": "error", "message": "B站返回未知登录状态，请重新扫码"}

        # Keep compatibility with older responses that carry cookies in the URL.
        query = parse_qs(urlsplit(data.get("url") or "").query)
        def cookie(name):
            return cookies.get(name) or query.get(name, [""])[0]

        sessdata, bili_jct, uid = cookie("SESSDATA"), cookie("bili_jct"), cookie("DedeUserID")
        if not all((sessdata, bili_jct, uid)):
            auth_log(logger, "warn", "login-credential-incomplete")
            return {"status": "error", "message": "B站未返回完整登录凭据，请重新扫码"}
        credential = Credential(
            sessdata=sessdata, bili_jct=bili_jct, dedeuserid=uid,
            buvid3=cookie("buvid3") or None,
            ac_time_value=data.get("refresh_token"),
        )
        await ensure_buvid3(credential)
        save_credential(credential)
        auth_log(logger, "info", "login-succeeded", group_id=group_id)
        return {"status": "success", "message": "登录成功"}
    except Exception as e:
        # Transport exceptions may include the secret QR key in a request URL.
        auth_log(logger, "error", "login-check-failed", error=type(e).__name__)
        return {"status": "error", "message": "登录检查失败，请稍后重新扫码"}
