"""
settings.py の環境変数による設定切替を確認する最小テスト。

app（api）ではなくプロジェクト設定の検証なので janus 配下に置く。
過剰な網羅はせず、design.md 6 章の要点のみ確認する。
"""

from django.conf import settings
from django.test import SimpleTestCase


class SettingsDefaultsTest(SimpleTestCase):
    """既定（環境変数未設定）時の設定値を確認する。"""

    def test_database_defaults_to_sqlite(self):
        # DATABASE_URL 未設定時は SQLite 単一ファイルが既定になる。
        self.assertEqual(
            settings.DATABASES["default"]["ENGINE"],
            "django.db.backends.sqlite3",
        )
        self.assertTrue(
            str(settings.DATABASES["default"]["NAME"]).endswith("db.sqlite3")
        )

    def test_require_auth_defaults_to_true(self):
        # JANUS_REQUIRE_AUTH の既定は True。
        self.assertTrue(settings.JANUS_REQUIRE_AUTH)

    def test_third_party_and_api_apps_installed(self):
        # rest_framework / corsheaders / api が登録されている。
        for app in ("rest_framework", "corsheaders", "api"):
            self.assertIn(app, settings.INSTALLED_APPS)

    def test_cors_middleware_before_common(self):
        # CorsMiddleware は CommonMiddleware より前に置く必要がある。
        cors = "corsheaders.middleware.CorsMiddleware"
        common = "django.middleware.common.CommonMiddleware"
        self.assertIn(cors, settings.MIDDLEWARE)
        self.assertLess(
            settings.MIDDLEWARE.index(cors),
            settings.MIDDLEWARE.index(common),
        )
