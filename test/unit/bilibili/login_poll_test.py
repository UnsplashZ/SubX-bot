import asyncio
from http.cookies import SimpleCookie
import unittest
from unittest import mock

from src.services.bili_server_core.auth import login as service


class LoginPollTest(unittest.TestCase):
    def poll(self, data, cookies=None, outer_code=0):
        response = mock.MagicMock()
        response.json = mock.AsyncMock(return_value={"code": outer_code, "data": data})
        response.cookies = SimpleCookie()
        for key, value in (cookies or {}).items():
            response.cookies[key] = value
        response.__aenter__ = mock.AsyncMock(return_value=response)
        session = mock.MagicMock()
        session.get.return_value = response
        session.__aenter__ = mock.AsyncMock(return_value=session)
        with mock.patch.object(service.aiohttp, "ClientSession", return_value=session), \
             mock.patch.object(service, "save_credential") as save, \
             mock.patch.object(service, "ensure_buvid3", new_callable=mock.AsyncMock) as ensure:
            result = asyncio.run(service.poll_login("test-key"))
        return result, save, ensure

    def test_header_only_credentials_are_saved(self):
        result, save, _ = self.poll(
            {"code": 0, "url": "https://www.bilibili.com/?gourl=home", "refresh_token": "refresh"},
            {"SESSDATA": "header-session", "bili_jct": "csrf", "DedeUserID": "123"},
        )
        self.assertEqual(result["status"], "success")
        credential = save.call_args.args[0]
        self.assertEqual(credential.sessdata, "header-session")
        self.assertEqual(credential.dedeuserid, "123")
        self.assertEqual(credential.ac_time_value, "refresh")

    def test_legacy_url_credentials_and_header_precedence(self):
        url = "https://www.bilibili.com/?SESSDATA=old%2Csession&bili_jct=csrf&DedeUserID=123"
        for headers, expected in [({}, "old%2Csession"), ({"SESSDATA": "new"}, "new")]:
            with self.subTest(headers=headers):
                result, save, _ = self.poll({"code": 0, "url": url}, headers)
                self.assertEqual(result["status"], "success")
                self.assertEqual(save.call_args.args[0].sessdata, expected)

    def test_incomplete_credentials_never_overwrite_existing_login(self):
        for cookies in [{}, {"SESSDATA": "session"}, {"SESSDATA": "session", "bili_jct": "csrf"}]:
            with self.subTest(cookies=cookies):
                result, save, ensure = self.poll({"code": 0, "url": "https://www.bilibili.com/"}, cookies)
                self.assertEqual(result["status"], "error")
                save.assert_not_called()
                ensure.assert_not_called()

    def test_pending_expired_unknown_and_api_errors_do_not_save(self):
        for code, status in [(86101, "pending"), (86090, "pending"), (86038, "error"), (999, "error"), (None, "error")]:
            with self.subTest(code=code):
                result, save, _ = self.poll({"code": code})
                self.assertEqual(result["status"], status)
                save.assert_not_called()
        result, save, _ = self.poll({}, outer_code=-412)
        self.assertEqual(result["status"], "error")
        save.assert_not_called()

    def test_transport_failure_does_not_leak_key_or_overwrite_login(self):
        with mock.patch.object(service, "_poll_qrcode", side_effect=TimeoutError("secret-key")), \
             mock.patch.object(service, "save_credential") as save:
            result = asyncio.run(service.poll_login("secret-key"))
        self.assertEqual(result["status"], "error")
        self.assertNotIn("secret-key", result["message"])
        save.assert_not_called()


if __name__ == "__main__":
    unittest.main()
