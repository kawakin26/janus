"""
アセット（添付）API（タスク 6）のテスト。

design.md 4 章 AssetClient 契約 / 5 章 REST エンドポイント表 / 9 章エラーハンドリング、
要件（アセットのアップロード・一覧・実体配信）を検証する。ページ系（tests_pages.py）・
認証系（tests_auth.py）とは独立させ、アセット関連のみをここに集約する。

MEDIA_ROOT をテストごとに一時ディレクトリへ向け、backend/media/ に実ファイルを
残さない（override_settings + tearDown での rmtree）。
"""

import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Attachment, Page

# クラス全体の MEDIA_ROOT を一時ディレクトリへ向ける（実 media/ を汚さない）。
_TEMP_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=_TEMP_MEDIA_ROOT)
class AssetApiTests(APITestCase):
    """アセットのアップロード・一覧・実体配信・権限・エラーを検証する。"""

    @classmethod
    def tearDownClass(cls):
        # 一時ディレクトリごと生成ファイルを掃除する。
        shutil.rmtree(_TEMP_MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user_model = get_user_model()
        self.user = self.user_model.objects.create_user(
            username="alice", password="test-pass-123"
        )
        self.page = Page.objects.create(path="/docs/map", title="Map")
        self.assets_url = reverse("api:pages-assets")

    def _authenticate(self):
        # 書き込み系（アップロード）は認証必須。
        self.client.force_authenticate(user=self.user)

    def _upload(self, name="map.png", content=b"PNGDATA", content_type="image/png",
                path="/docs/map"):
        upload = SimpleUploadedFile(name, content, content_type=content_type)
        return self.client.post(
            f"{self.assets_url}?path={path}", {"file": upload}, format="multipart"
        )

    def test_upload_success(self):
        # 認証ユーザーで multipart アップロード → 201、表現と DB を検証。
        self._authenticate()
        res = self._upload()
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        for field in ("id", "original_name", "url", "content_type", "created_at"):
            self.assertIn(field, res.data)
        self.assertEqual(res.data["original_name"], "map.png")
        self.assertEqual(res.data["content_type"], "image/png")
        self.assertTrue(res.data["url"])
        # Attachment が 1 件増え、該当ページに紐付く。
        self.assertEqual(self.page.attachments.count(), 1)
        attachment = self.page.attachments.first()
        self.assertEqual(attachment.original_name, "map.png")
        self.assertEqual(attachment.page_id, self.page.id)

    def test_list_returns_uploaded_assets(self):
        # 一覧 GET → 200、アップロード済みアセットが url 付きで返る。
        self._authenticate()
        self._upload()
        res = self.client.get(f"{self.assets_url}?path=/docs/map")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        item = res.data[0]
        self.assertEqual(item["original_name"], "map.png")
        self.assertTrue(item["url"])

    def test_upload_requires_authentication(self):
        # 未認証アップロードは 401（既定 JANUS_REQUIRE_AUTH=True → IsAuthenticated）。
        res = self._upload()
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_list_missing_page_returns_404(self):
        # 存在しないページへの一覧 GET → 404（日本語 detail）。
        # GET は既定権限（JANUS_REQUIRE_AUTH=True → 認証必須）に委ねるため認証する。
        self._authenticate()
        res = self.client.get(f"{self.assets_url}?path=/nope")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("detail", res.data)

    def test_upload_missing_page_returns_404(self):
        # 存在しないページへのアップロード POST → 404。
        self._authenticate()
        res = self._upload(path="/nope")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("detail", res.data)

    def test_upload_without_file_returns_400(self):
        # ファイル未指定アップロード → 400（日本語 detail）。
        self._authenticate()
        res = self.client.post(
            f"{self.assets_url}?path=/docs/map", {}, format="multipart"
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", res.data)

    def test_upload_sanitizes_original_name(self):
        # "../etc/passwd" のような区切りを含む名前は basename に切り詰められる。
        self._authenticate()
        res = self._upload(name="../etc/passwd")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["original_name"], "passwd")
        attachment = self.page.attachments.first()
        self.assertEqual(attachment.original_name, "passwd")

    def test_upload_strips_control_chars_from_original_name(self):
        # ヌルバイトや制御文字を含むファイル名は除去される（表示・照合用の防御）。
        self._authenticate()
        res = self._upload(name="ma\x00p\x1f.png")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["original_name"], "map.png")
        attachment = self.page.attachments.first()
        self.assertEqual(attachment.original_name, "map.png")

    def test_detail_serves_file(self):
        # 実体配信 GET → 200、Content-Type と本文が投入値と一致。
        self._authenticate()
        upload_res = self._upload(content=b"PNGDATA", content_type="image/png")
        asset_id = upload_res.data["id"]
        detail_url = reverse("api:assets-detail", args=[asset_id])
        res = self.client.get(detail_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res["Content-Type"], "image/png")
        body = b"".join(res.streaming_content)
        self.assertEqual(body, b"PNGDATA")

    def test_detail_missing_asset_returns_404(self):
        # 存在しない id の配信 → 404。
        # 配信 GET も既定権限に委ねる（認証必須）ため認証する。
        self._authenticate()
        detail_url = reverse("api:assets-detail", args=[99999])
        res = self.client.get(detail_url)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
