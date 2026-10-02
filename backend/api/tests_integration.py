"""
フェーズ 1 の結合（統合）テスト。

design.md 10 章の統合シナリオ（ログイン → ページ作成 → 閲覧 → アセットアップロード
→ 一覧 → 編集 → 削除）を、API 経由で一連に通す単一の APITestCase として担保する。
各機能の網羅は tests_auth.py / tests_pages.py / tests_assets.py が担保済みのため、
ここでは「横断の一本」が実際のトークン認証で通ることだけを示す（過剰網羅はしない）。

MEDIA_ROOT はテスト用の一時ディレクトリへ向け、backend/media/ に実ファイルを
残さない（override_settings + tearDownClass での rmtree。tests_assets.py と同様）。
"""

import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

# クラス全体の MEDIA_ROOT を一時ディレクトリへ向ける（実 media/ を汚さない）。
_TEMP_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=_TEMP_MEDIA_ROOT)
class Phase1IntegrationScenarioTests(APITestCase):
    """design 10 章の統合シナリオを実トークン認証で一連に通す。"""

    @classmethod
    def tearDownClass(cls):
        # 一時ディレクトリごと生成ファイルを掃除する。
        shutil.rmtree(_TEMP_MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        # 一般ユーザーを 1 人用意する（統合シナリオの操作主体）。
        self.user_model = get_user_model()
        self.password = "test-pass-123"
        self.user = self.user_model.objects.create_user(
            username="alice", password=self.password
        )
        self.pages_url = reverse("api:pages")
        self.assets_url = reverse("api:pages-assets")

    def test_login_create_view_upload_update_delete_flow(self):
        # 1) ログイン → token 取得（force_authenticate ではなく実ログインで取得し、
        #    以降は Authorization: Token ヘッダで「トークン認証で一連が通る」ことを示す）。
        login = self.client.post(
            reverse("api:auth-login"),
            {"username": "alice", "password": self.password},
        )
        self.assertEqual(login.status_code, status.HTTP_200_OK)
        token_key = login.data["token"]
        self.assertTrue(token_key)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token_key}")

        # 2) ページ作成（Markdown + 地図記法で画像マーカーを表示する body を投入）。
        #    body は閲覧時に Markdown として解釈され、地図記法が画像マーカーを描く想定。
        page_path = "/docs/map"
        # body は DRF の CharField 既定（trim_whitespace=True）で前後空白が
        # 落ちるため、往復比較が成立するよう前後に余分な空白を付けない。
        map_body = (
            "# 現場地図\n\n"
            "説明テキスト。\n\n"
            "```map\n"
            "image: map.png\n"
            "marker: 10,20\n"
            "```"
        )
        create = self.client.post(
            self.pages_url,
            {"path": page_path, "title": "現場地図", "body": map_body},
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED)
        self.assertEqual(create.data["path"], page_path)
        self.assertEqual(create.data["created_by"]["username"], "alice")

        # 3) 閲覧（取得）→ 作成した body が返る。
        got = self.client.get(self.pages_url, {"path": page_path})
        self.assertEqual(got.status_code, status.HTTP_200_OK)
        self.assertEqual(got.data["path"], page_path)
        self.assertEqual(got.data["body"], map_body)

        # 4) 地図記法で参照する画像をアセットとしてアップロード（PNG）。
        upload = SimpleUploadedFile("map.png", b"PNGDATA", content_type="image/png")
        up = self.client.post(
            f"{self.assets_url}?path={page_path}",
            {"file": upload},
            format="multipart",
        )
        self.assertEqual(up.status_code, status.HTTP_201_CREATED)
        self.assertEqual(up.data["original_name"], "map.png")
        self.assertTrue(up.data["url"])

        # 5) アセット一覧 → アップロード済みが original_name 一致・url 非空で返る
        #    （地図記法が original_name でマーカー画像を解決できる前提を担保）。
        listed = self.client.get(f"{self.assets_url}?path={page_path}")
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual(len(listed.data), 1)
        self.assertEqual(listed.data[0]["original_name"], "map.png")
        self.assertTrue(listed.data[0]["url"])

        # 6) 編集 → body を上書きし updated_by が記録される。
        new_body = map_body + "\n\n追記: 位置を更新。"
        updated = self.client.put(
            f"{self.pages_url}?path={page_path}",
            {"title": "現場地図（更新）", "body": new_body},
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        self.assertEqual(updated.data["title"], "現場地図（更新）")
        self.assertEqual(updated.data["body"], new_body)
        self.assertEqual(updated.data["updated_by"]["username"], "alice")

        # 7) 削除 → 204、以降の取得は 404。
        deleted = self.client.delete(f"{self.pages_url}?path={page_path}")
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        after = self.client.get(self.pages_url, {"path": page_path})
        self.assertEqual(after.status_code, status.HTTP_404_NOT_FOUND)
