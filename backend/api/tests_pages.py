"""
ページ CRUD / 階層ナビ API（タスク 5.1・5.2）と path 正規化のテスト。

design.md 4 章 PageClient 契約 / 5 章 REST エンドポイント表 / 9 章エラーハンドリング、
要件 2-1,2-2,2-4,2-6,2-7,4-5 を検証する。モデル系（tests.py）・認証系（tests_auth.py）
とは独立させ、ページ関連のみをここに集約する。
"""

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Page
from .utils import normalize_path


class NormalizePathTests(SimpleTestCase):
    """normalize_path のユニットテスト（D1 の正規化規則）。"""

    def test_empty_and_none_become_root(self):
        # 空文字・None はルート "/" に畳む（空文字は返さない）。
        self.assertEqual(normalize_path(""), "/")
        self.assertEqual(normalize_path(None), "/")

    def test_slash_variants_become_root(self):
        # "/"・"///"・"."・".." はいずれもルート "/"。
        self.assertEqual(normalize_path("/"), "/")
        self.assertEqual(normalize_path("///"), "/")
        self.assertEqual(normalize_path("."), "/")
        self.assertEqual(normalize_path(".."), "/")

    def test_relative_prefix_normalized_to_absolute(self):
        # 先頭スラッシュ無し入力は絶対パス表現に正規化する。
        self.assertEqual(normalize_path("docs/intro"), "/docs/intro")

    def test_trailing_slash_removed(self):
        # 末尾スラッシュは除去し、付き/無しを同一視できるようにする。
        self.assertEqual(normalize_path("/docs/intro/"), "/docs/intro")

    def test_duplicate_slashes_collapsed(self):
        # 過剰スラッシュ（空セグメント）は除去する。
        self.assertEqual(normalize_path("/docs//intro"), "/docs/intro")

    def test_dotdot_segment_removed_not_traversal(self):
        # ".." は親遡上を許さず単純除去（トラバーサル無効化・安全側）。
        self.assertEqual(normalize_path("/docs/../etc"), "/docs/etc")

    def test_dot_segment_removed(self):
        # "." は除去する。
        self.assertEqual(normalize_path("a/./b"), "/a/b")

    def test_surrounding_whitespace_stripped(self):
        # 前後空白・セグメント内の空白は strip する。
        self.assertEqual(normalize_path("  /docs/intro  "), "/docs/intro")


class PageCrudTests(APITestCase):
    """ページ CRUD（取得・作成・更新・削除）と重複 409 を検証する。"""

    def setUp(self):
        self.user_model = get_user_model()
        self.user = self.user_model.objects.create_user(
            username="alice", password="test-pass-123"
        )
        self.pages_url = reverse("api:pages")

    def _authenticate(self):
        # 書き込み系は認証必須。force_authenticate で認証状態にする。
        self.client.force_authenticate(user=self.user)

    def test_create_page_success_records_authors(self):
        # 認証ユーザーで作成 → 201、created_by/updated_by が当該ユーザー（要件 4-5）。
        self._authenticate()
        res = self.client.post(
            self.pages_url,
            {"path": "/docs/intro", "title": "Intro", "body": "hello"},
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["path"], "/docs/intro")
        self.assertEqual(res.data["title"], "Intro")
        self.assertEqual(res.data["body"], "hello")
        self.assertEqual(res.data["created_by"]["username"], "alice")
        self.assertEqual(res.data["updated_by"]["username"], "alice")
        # 詳細表現のフィールドが揃っていること。
        for field in ("id", "created_at", "updated_at"):
            self.assertIn(field, res.data)
        # 正規化済み path で保存されていること。
        self.assertTrue(Page.objects.filter(path="/docs/intro").exists())

    def test_create_page_normalizes_path(self):
        # 末尾スラッシュ付き入力でも正規化後の path で保存される。
        self._authenticate()
        res = self.client.post(
            self.pages_url, {"path": "/docs/guide/", "body": "x"}
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["path"], "/docs/guide")

    def test_create_duplicate_path_returns_409(self):
        # 同一パス 2 回目の POST は 409（400 ではない）＋日本語 detail（要件 2-7）。
        self._authenticate()
        self.client.post(self.pages_url, {"path": "/docs/intro", "body": "a"})
        res = self.client.post(self.pages_url, {"path": "/docs/intro", "body": "b"})
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("detail", res.data)
        self.assertEqual(res.data["detail"], "同一パスのページが既に存在します。")

    def test_create_duplicate_differing_trailing_slash_returns_409(self):
        # 末尾スラッシュ違いも正規化後に重複判定されて 409 になる。
        self._authenticate()
        self.client.post(self.pages_url, {"path": "/docs/intro", "body": "a"})
        res = self.client.post(self.pages_url, {"path": "/docs/intro/", "body": "b"})
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)

    def test_create_requires_authentication(self):
        # 未認証 POST は 401（既定 JANUS_REQUIRE_AUTH=True → IsAuthenticated）。
        res = self.client.post(self.pages_url, {"path": "/docs/intro", "body": "a"})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_get_page_success(self):
        # ?path= で 1 件取得 → 200 と内容（要件 2-1）。
        self._authenticate()
        self.client.post(
            self.pages_url, {"path": "/docs/intro", "title": "Intro", "body": "hello"}
        )
        res = self.client.get(self.pages_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["path"], "/docs/intro")
        self.assertEqual(res.data["body"], "hello")

    def test_get_page_not_found(self):
        # 存在しないパスは 404。
        self._authenticate()
        res = self.client.get(self.pages_url, {"path": "/nope"})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_get_page_trailing_slash_matches(self):
        # "/docs/intro" と "/docs/intro/" が同一ページ扱い（正規化）。
        self._authenticate()
        self.client.post(self.pages_url, {"path": "/docs/intro", "body": "hello"})
        res = self.client.get(self.pages_url, {"path": "/docs/intro/"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["path"], "/docs/intro")

    def test_update_page_overwrites_body_and_records_updater(self):
        # PUT ?path= で body/title 更新 → 200、updated_by 記録（要件 2-2, 4-5）。
        self._authenticate()
        self.client.post(
            self.pages_url, {"path": "/docs/intro", "title": "Old", "body": "old"}
        )
        res = self.client.put(
            f"{self.pages_url}?path=/docs/intro",
            {"title": "New", "body": "new"},
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["title"], "New")
        self.assertEqual(res.data["body"], "new")
        self.assertEqual(res.data["updated_by"]["username"], "alice")

    def test_update_page_keeps_title_when_omitted(self):
        # title 省略時は既存を維持し、body のみ上書き。
        self._authenticate()
        self.client.post(
            self.pages_url, {"path": "/docs/intro", "title": "Keep", "body": "old"}
        )
        res = self.client.put(
            f"{self.pages_url}?path=/docs/intro", {"body": "new"}
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["title"], "Keep")
        self.assertEqual(res.data["body"], "new")

    def test_update_page_not_found(self):
        # 存在しないパスの PUT は 404。
        self._authenticate()
        res = self.client.put(f"{self.pages_url}?path=/nope", {"body": "x"})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_requires_authentication(self):
        # 未認証 PUT は 401。
        res = self.client.put(f"{self.pages_url}?path=/docs/intro", {"body": "x"})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_delete_page_success(self):
        # DELETE ?path= → 204、以降 GET が 404（要件 2-4）。
        self._authenticate()
        self.client.post(self.pages_url, {"path": "/docs/intro", "body": "x"})
        res = self.client.delete(f"{self.pages_url}?path=/docs/intro")
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Page.objects.filter(path="/docs/intro").exists())
        res_get = self.client.get(self.pages_url, {"path": "/docs/intro"})
        self.assertEqual(res_get.status_code, status.HTTP_404_NOT_FOUND)

    def test_delete_page_not_found(self):
        # 存在しないパスの DELETE は 404。
        self._authenticate()
        res = self.client.delete(f"{self.pages_url}?path=/nope")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_delete_requires_authentication(self):
        # 未認証 DELETE は 401。
        res = self.client.delete(f"{self.pages_url}?path=/docs/intro")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)


class PageChildrenTests(APITestCase):
    """子ページ一覧（階層ナビ・要件 2-6）を検証する。"""

    def setUp(self):
        self.user_model = get_user_model()
        self.user = self.user_model.objects.create_user(
            username="alice", password="test-pass-123"
        )
        self.client.force_authenticate(user=self.user)
        self.children_url = reverse("api:pages-children")
        # 階層構造を用意する。
        for path in ("/docs", "/docs/intro", "/docs/guide", "/docs/intro/deep", "/blog"):
            Page.objects.create(path=path, title=path, created_by=self.user)

    def test_children_direct_only(self):
        # ?parent=/docs は直下の子（/docs/intro, /docs/guide）のみ。孫・親自身は除外。
        res = self.client.get(self.children_url, {"parent": "/docs"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        paths = {item["path"] for item in res.data}
        self.assertEqual(paths, {"/docs/intro", "/docs/guide"})
        # 軽量表現（path, title のみ）。
        self.assertEqual(set(res.data[0].keys()), {"path", "title"})

    def test_children_top_level_for_empty_parent(self):
        # parent 空（または "/"）は第 1 階層（/docs, /blog）のみ。第 2 階層は含めない。
        res = self.client.get(self.children_url, {"parent": ""})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        paths = {item["path"] for item in res.data}
        self.assertEqual(paths, {"/docs", "/blog"})
