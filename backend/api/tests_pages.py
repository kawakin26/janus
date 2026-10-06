"""
ページ CRUD / 階層ナビ API（タスク 5.1・5.2）と path 正規化のテスト。

design.md 4 章 PageClient 契約 / 5 章 REST エンドポイント表 / 9 章エラーハンドリング、
要件 2-1,2-2,2-4,2-6,2-7,4-5 を検証する。モデル系（tests.py）・認証系（tests_auth.py）
とは独立させ、ページ関連のみをここに集約する。
"""

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Page, PagePermission
from .utils import normalize_path


def _make_user_perm(path, user, action, effect):
    """PagePermission（user 主体）を作る（tests_permissions.py の流儀を踏襲）。"""
    return PagePermission.objects.create(
        path=path,
        principal_type="user",
        user=user,
        action=action,
        effect=effect,
    )


def _flatten_tree(nodes):
    """ネストツリーを全ノードのフラットなリストに展開する（再帰）。"""
    out = []
    for node in nodes:
        out.append(node)
        out.extend(_flatten_tree(node["children"]))
    return out


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


class PageTreeTests(APITestCase):
    """サブツリー一括取得 GET /api/pages/tree（design 2.9）を検証する。"""

    def setUp(self):
        self.user_model = get_user_model()
        self.user = self.user_model.objects.create_user(
            username="alice", password="test-pass-123"
        )
        self.client.force_authenticate(user=self.user)
        self.tree_url = reverse("api:pages-tree")

    def _create_pages(self, specs):
        # specs: iterable of (path, title)。
        for path, title in specs:
            Page.objects.create(path=path, title=title, created_by=self.user)

    def _node_by_path(self, nodes, path):
        for node in _flatten_tree(nodes):
            if node["path"] == path:
                return node
        return None

    def test_nested_structure(self):
        # 実ページで階層を作り ?root=/ がネスト構造を正しく返す。
        self._create_pages(
            [
                ("/docs", "Docs"),
                ("/docs/intro", "Intro"),
                ("/docs/guide", "Guide"),
                ("/docs/intro/deep", "Deep"),
                ("/blog", "Blog"),
            ]
        )
        res = self.client.get(self.tree_url, {"root": "/"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        # トップ配列は root 直下（/blog, /docs）をパス昇順で。root 自身は含まない。
        top_paths = [node["path"] for node in res.data]
        self.assertEqual(top_paths, ["/blog", "/docs"])
        self.assertNotIn("/", top_paths)
        # /docs 配下は /docs/guide → /docs/intro（パス昇順）。
        docs = self._node_by_path(res.data, "/docs")
        self.assertEqual([c["path"] for c in docs["children"]], ["/docs/guide", "/docs/intro"])
        # /docs/intro 配下に /docs/intro/deep。
        intro = self._node_by_path(res.data, "/docs/intro")
        self.assertEqual([c["path"] for c in intro["children"]], ["/docs/intro/deep"])

    def test_virtual_node(self):
        # /docs 実ページ無し。/docs は hasPage=False・hasChildren=True・title="docs"。
        self._create_pages(
            [
                ("/docs/intro", "Intro"),
                ("/docs/guide", "Guide"),
            ]
        )
        res = self.client.get(self.tree_url, {"root": "/"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        docs = self._node_by_path(res.data, "/docs")
        self.assertIsNotNone(docs)
        self.assertFalse(docs["hasPage"])
        self.assertTrue(docs["hasChildren"])
        self.assertEqual(docs["title"], "docs")
        # 実ページ子は hasPage=True・title は Page.title。
        intro = self._node_by_path(res.data, "/docs/intro")
        self.assertTrue(intro["hasPage"])
        self.assertEqual(intro["title"], "Intro")

    def test_root_argument_scopes_subtree(self):
        # ?root=/docs は /docs 配下のみ。/blog を含まず、/docs 自身もトップに出ない。
        self._create_pages(
            [
                ("/docs", "Docs"),
                ("/docs/intro", "Intro"),
                ("/docs/guide", "Guide"),
                ("/docs/intro/deep", "Deep"),
                ("/blog", "Blog"),
            ]
        )
        res = self.client.get(self.tree_url, {"root": "/docs"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        top_paths = [node["path"] for node in res.data]
        self.assertEqual(top_paths, ["/docs/guide", "/docs/intro"])
        all_paths = {node["path"] for node in _flatten_tree(res.data)}
        self.assertNotIn("/blog", all_paths)
        self.assertNotIn("/docs", all_paths)
        intro = self._node_by_path(res.data, "/docs/intro")
        self.assertEqual([c["path"] for c in intro["children"]], ["/docs/intro/deep"])

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_permission_filter_and_ancestor_inheritance(self):
        # 既定非公開。明示 allow のノードのみ出現し、祖先不可の枝は子孫ごと欠落。
        self._create_pages(
            [
                ("/docs", "Docs"),
                ("/docs/intro", "Intro"),
                ("/docs/guide", "Guide"),
                ("/docs/intro/deep", "Deep"),
                ("/blog", "Blog"),
            ]
        )
        # /docs と /docs/guide を view allow。/docs/intro は deny（祖先 /docs は allow）。
        _make_user_perm("/docs", self.user, "view", "allow")
        _make_user_perm("/docs/guide", self.user, "view", "allow")
        _make_user_perm("/docs/intro", self.user, "view", "deny")
        res = self.client.get(self.tree_url, {"root": "/"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        all_paths = {node["path"] for node in _flatten_tree(res.data)}
        # /docs（allow）と /docs/guide（allow）は出る。
        self.assertIn("/docs", all_paths)
        self.assertIn("/docs/guide", all_paths)
        # /docs/intro は deny → 自身も子孫 /docs/intro/deep も欠落（祖先継承）。
        self.assertNotIn("/docs/intro", all_paths)
        self.assertNotIn("/docs/intro/deep", all_paths)
        # /blog は未許可（既定非公開）→ 欠落。
        self.assertNotIn("/blog", all_paths)

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_empty_virtual_node_pruned(self):
        # 祖先ルート可視・中間仮想 /docs・唯一の実ページ子孫 /docs/intro が view 拒否。
        # 空になった /docs がレスポンスに現れない（手順 7.5 の剪定）。
        self._create_pages([("/docs/intro", "Intro")])
        # /docs 自身を view allow（仮想ノードだが path 単位で許可可能）。
        _make_user_perm("/docs", self.user, "view", "allow")
        # 唯一の実ページ子孫 /docs/intro を deny。
        _make_user_perm("/docs/intro", self.user, "view", "deny")
        res = self.client.get(self.tree_url, {"root": "/"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        all_paths = {node["path"] for node in _flatten_tree(res.data)}
        self.assertNotIn("/docs", all_paths)
        self.assertNotIn("/docs/intro", all_paths)
        # 空仮想ノード不変条件: 全ノードで not (hasPage==False and hasChildren==False)。
        for node in _flatten_tree(res.data):
            self.assertFalse(node["hasPage"] is False and node["hasChildren"] is False)

    def test_empty_tree_no_pages(self):
        # ページ 0 件で ?root=/ は 200 + []。
        res = self.client.get(self.tree_url, {"root": "/"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data, [])

    def test_empty_tree_nonexistent_root(self):
        # 非実在 root（配下に何も無い）は 200 + []（非実在と可視 0 件を区別しない）。
        self._create_pages([("/docs/intro", "Intro")])
        res = self.client.get(self.tree_url, {"root": "/ghost"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data, [])

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_empty_tree_zero_visible(self):
        # 全ノード view 不可（既定非公開・allow 無し）→ 200 + []。
        self._create_pages([("/docs", "Docs"), ("/docs/intro", "Intro")])
        res = self.client.get(self.tree_url, {"root": "/"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data, [])

    def test_has_children_matches_children_length(self):
        # 全ノードで hasChildren == (len(children) > 0)。
        self._create_pages(
            [
                ("/docs", "Docs"),
                ("/docs/intro", "Intro"),
                ("/docs/guide", "Guide"),
                ("/docs/intro/deep", "Deep"),
                ("/blog", "Blog"),
            ]
        )
        res = self.client.get(self.tree_url, {"root": "/"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        for node in _flatten_tree(res.data):
            self.assertEqual(node["hasChildren"], len(node["children"]) > 0)

    def test_requires_authentication(self):
        # 未認証は既定 IsAuthenticated が 401。
        self.client.force_authenticate(user=None)
        res = self.client.get(self.tree_url, {"root": "/"})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
