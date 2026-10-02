"""
settings.py の環境変数による設定切替を確認する最小テスト。

app（api）ではなくプロジェクト設定の検証なので janus 配下に置く。
過剰な網羅はせず、design.md 6 章の要点のみ確認する。
"""

from unittest import mock

import dj_database_url
from django.conf import settings
from django.test import SimpleTestCase

from janus.settings import BASE_DIR


class SettingsDefaultsTest(SimpleTestCase):
    """既定（環境変数未設定）時の設定値を確認する。"""

    def test_database_defaults_to_sqlite(self):
        # DATABASE_URL 未設定時に dj_database_url が SQLite エンジンを既定に
        # 解決することを確認する。
        #
        # 実行時の settings.DATABASES["default"]["NAME"] はテストランナーが
        # テスト用 DB 名（インメモリ等）に差し替えるため assert しない。
        # settings.py と同じ既定値を使い、環境変数をクリアした状態で
        # dj_database_url.config() を直接呼んで解決結果を検証する。
        default_url = f"sqlite:///{BASE_DIR / 'db.sqlite3'}"
        with mock.patch.dict("os.environ", {}, clear=True):
            resolved = dj_database_url.config(
                default=default_url, conn_max_age=600
            )
        self.assertEqual(resolved["ENGINE"], "django.db.backends.sqlite3")
        self.assertTrue(str(resolved["NAME"]).endswith("db.sqlite3"))

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
