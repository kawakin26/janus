"""
認証エンドポイント（login / logout / me）の APITestCase。

design.md 4 章 AuthClient 契約 / 5 章 REST エンドポイント表 / 要件 4-1〜4-6 を検証する。
モデルの最小テスト（tests.py）とは独立させ、認証系のみをここに集約する。
"""

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase


class AuthEndpointTests(APITestCase):
    """ログイン / ログアウト / me の挙動を検証する。"""

    def setUp(self):
        # 一般ユーザーと管理者（superuser）を用意する。
        self.user_model = get_user_model()
        self.password = "test-pass-123"
        self.user = self.user_model.objects.create_user(
            username="alice", password=self.password
        )
        self.admin = self.user_model.objects.create_superuser(
            username="root", password=self.password
        )

    def test_login_success_returns_token_and_user(self):
        # 正しい資格情報 → 200、token（非空）と user 表現が返る（要件 4-1）。
        res = self.client.post(
            reverse("api:auth-login"),
            {"username": "alice", "password": self.password},
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("token", res.data)
        self.assertTrue(isinstance(res.data["token"], str) and res.data["token"])
        self.assertIn("user", res.data)
        user = res.data["user"]
        self.assertEqual(user["username"], "alice")
        self.assertIn("id", user)
        # 管理者/一般の区別のため is_staff / is_superuser を含む（要件 4-4）。
        self.assertFalse(user["is_staff"])
        self.assertFalse(user["is_superuser"])

    def test_login_is_accessible_without_auth(self):
        # login は AllowAny。認証ヘッダ無しでも成功する（design 5 章）。
        self.assertFalse("HTTP_AUTHORIZATION" in self.client._credentials)
        res = self.client.post(
            reverse("api:auth-login"),
            {"username": "alice", "password": self.password},
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_login_failure_returns_400_without_token(self):
        # 誤パスワード → 400（DRF 標準エラー形式）、token を発行しない（要件 4-1）。
        res = self.client.post(
            reverse("api:auth-login"),
            {"username": "alice", "password": "wrong-password"},
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        # 非フィールドエラーが返る（資格情報不一致）。
        self.assertIn("non_field_errors", res.data)
        self.assertFalse(Token.objects.filter(user=self.user).exists())

    def test_me_unauthenticated_returns_null(self):
        # 未認証の me は 200 + JSON null（design 5 章）。
        res = self.client.get(reverse("api:auth-me"))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIsNone(res.data)

    def test_me_authenticated_returns_user(self):
        # login で得た token を付与 → me が user オブジェクトを返す（要件 4-1, 4-4）。
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        res = self.client.get(reverse("api:auth-me"))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["username"], "alice")
        self.assertIn("is_staff", res.data)
        self.assertIn("is_superuser", res.data)

    def test_logout_requires_authentication(self):
        # 未認証の logout は 401（既定で認証必須。要件 4-2）。
        res = self.client.post(reverse("api:auth-logout"))
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_invalidates_token(self):
        # token 付きで logout → 204、以降その token は無効化される（要件 4-1）。
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        res = self.client.post(reverse("api:auth-logout"))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Token.objects.filter(key=token.key).exists())

        # 無効化された token を再度使うと、TokenAuthentication が不正トークンと
        # 判定して 401 を返す（＝その token はもう使えない）。認証必須の
        # logout を同 token で叩き、拒否されることで無効化を確認する。
        res_reuse = self.client.post(reverse("api:auth-logout"))
        self.assertEqual(res_reuse.status_code, status.HTTP_401_UNAUTHORIZED)

        # 認証ヘッダを外せば me は未認証扱いの null を返す。
        self.client.credentials()
        res_me = self.client.get(reverse("api:auth-me"))
        self.assertEqual(res_me.status_code, status.HTTP_200_OK)
        self.assertIsNone(res_me.data)

    def test_login_then_token_authenticates(self):
        # login→token 取得→その token で認証付きリクエスト（logout）が通る。
        login = self.client.post(
            reverse("api:auth-login"),
            {"username": "alice", "password": self.password},
        )
        token_key = login.data["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token_key}")
        res = self.client.post(reverse("api:auth-logout"))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)

    def test_admin_user_flags(self):
        # superuser は is_staff / is_superuser が真で返る（要件 4-4）。
        res = self.client.post(
            reverse("api:auth-login"),
            {"username": "root", "password": self.password},
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data["user"]["is_staff"])
        self.assertTrue(res.data["user"]["is_superuser"])


class DefaultPermissionSwitchTests(APITestCase):
    """JANUS_REQUIRE_AUTH による既定権限の切替を確認する（要件 4-2）。

    REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"] は settings 読込時に
    JANUS_REQUIRE_AUTH の値で決まる。ここでは「既定（True）で認証必須の
    エンドポイント（logout）が未認証で 401 を返す」ことで実挙動を担保し、
    併せて settings の分岐値そのものを確認する。
    """

    def test_default_permission_requires_auth_when_enabled(self):
        # 既定（JANUS_REQUIRE_AUTH=True）では認証必須ビューが 401 を返す。
        from django.conf import settings

        self.assertIn(
            "rest_framework.permissions.IsAuthenticated",
            settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"],
        )
        res = self.client.post(reverse("api:auth-logout"))
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_permission_class_resolution_matches_flag(self):
        # settings の分岐関数そのものを両値で検証する（import 時評価に依存しない）。
        # True→IsAuthenticated / False→AllowAny。
        from janus.settings import default_permission_classes

        self.assertEqual(
            default_permission_classes(True),
            ["rest_framework.permissions.IsAuthenticated"],
        )
        self.assertEqual(
            default_permission_classes(False),
            ["rest_framework.permissions.AllowAny"],
        )
