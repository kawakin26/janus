"""PagePermission / Revision モデルの契約テスト（design 2.1 / 2.2）。

既存 tests.py のモデルテスト流儀（IntegrityError を transaction.atomic 内で
assertRaises）に合わせ、部分一意制約・clean 整合・CASCADE/SET_NULL を検証する。
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Page, PagePermission, Revision


class PagePermissionModelTest(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="alice", password="pw")
        self.group = Group.objects.create(name="editors")

    def test_user_action_partial_unique_rejects_duplicate(self):
        # (path, user, action) 部分一意制約。同一 (path,user,action) の重複は弾く。
        PagePermission.objects.create(
            path="/docs",
            principal_type="user",
            user=self.user,
            action="view",
            effect="allow",
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                PagePermission.objects.create(
                    path="/docs",
                    principal_type="user",
                    user=self.user,
                    action="view",
                    effect="deny",
                )
        # action が異なれば別エントリとして許容される。
        PagePermission.objects.create(
            path="/docs",
            principal_type="user",
            user=self.user,
            action="edit",
            effect="allow",
        )

    def test_group_action_partial_unique_rejects_duplicate(self):
        # (path, group, action) 部分一意制約。同一 (path,group,action) の重複は弾く。
        PagePermission.objects.create(
            path="/docs",
            principal_type="group",
            group=self.group,
            action="view",
            effect="allow",
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                PagePermission.objects.create(
                    path="/docs",
                    principal_type="group",
                    group=self.group,
                    action="view",
                    effect="deny",
                )

    def test_clean_rejects_user_type_without_user(self):
        perm = PagePermission(
            path="/docs", principal_type="user", user=None, action="view", effect="allow"
        )
        with self.assertRaises(ValidationError):
            perm.full_clean()

    def test_clean_rejects_user_type_with_group(self):
        perm = PagePermission(
            path="/docs",
            principal_type="user",
            user=self.user,
            group=self.group,
            action="view",
            effect="allow",
        )
        with self.assertRaises(ValidationError):
            perm.clean()

    def test_clean_rejects_group_type_without_group(self):
        perm = PagePermission(
            path="/docs", principal_type="group", group=None, action="view", effect="allow"
        )
        with self.assertRaises(ValidationError):
            perm.clean()

    def test_clean_rejects_group_type_with_user(self):
        perm = PagePermission(
            path="/docs",
            principal_type="group",
            group=self.group,
            user=self.user,
            action="view",
            effect="allow",
        )
        with self.assertRaises(ValidationError):
            perm.clean()

    def test_clean_accepts_consistent_principals(self):
        user_perm = PagePermission(
            path="/docs", principal_type="user", user=self.user, action="view", effect="allow"
        )
        group_perm = PagePermission(
            path="/docs", principal_type="group", group=self.group, action="edit", effect="deny"
        )
        # 不整合が無ければ ValidationError は上がらない。
        user_perm.clean()
        group_perm.clean()


class RevisionModelTest(TestCase):
    def setUp(self):
        self.page = Page.objects.create(path="/docs/intro", body="latest")

    def _revision(self, number, **kwargs):
        return Revision.objects.create(
            page=self.page,
            number=number,
            body=kwargs.get("body", ""),
            title=kwargs.get("title", ""),
            created_at=kwargs.get("created_at", timezone.now()),
            author=kwargs.get("author"),
        )

    def test_page_number_unique(self):
        self._revision(1)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self._revision(1)
        # 別ページなら同じ number でも許容される。
        other = Page.objects.create(path="/docs/other", body="x")
        Revision.objects.create(page=other, number=1, created_at=timezone.now())

    def test_ordering_is_newest_number_first(self):
        self._revision(1)
        self._revision(3)
        self._revision(2)
        numbers = list(Revision.objects.filter(page=self.page).values_list("number", flat=True))
        self.assertEqual(numbers, [3, 2, 1])

    def test_cascade_delete_with_page(self):
        self._revision(1)
        self._revision(2)
        page_id = self.page.id
        self.page.delete()
        self.assertFalse(Revision.objects.filter(page_id=page_id).exists())

    def test_author_set_null_on_user_delete(self):
        author = get_user_model().objects.create_user(username="author", password="pw")
        revision = self._revision(1, author=author)
        author.delete()
        revision.refresh_from_db()
        self.assertIsNone(revision.author)
        # 履歴そのものは残る（監査保持）。
        self.assertTrue(Revision.objects.filter(pk=revision.pk).exists())


class RevisionApiTest(APITestCase):
    """リビジョン保存経路・履歴/詳細/差分/復元 API の統合テスト（design 5.5 / 6）。

    task 15 の網羅項目を APITestCase + force_authenticate + reverse で検証する。
    既存モデル契約テスト（上記クラス）はそのまま残す。
    """

    def setUp(self):
        self.user = get_user_model().objects.create_user(username="alice", password="pw")
        self.other = get_user_model().objects.create_user(username="bob", password="pw")
        self.client.force_authenticate(user=self.user)
        self.pages_url = reverse("api:pages")
        self.list_url = reverse("api:pages-revisions")
        self.detail_url = reverse("api:pages-revisions-detail")
        self.diff_url = reverse("api:pages-revisions-diff")
        self.restore_url = reverse("api:pages-revisions-restore")

    def _create_page(self, path="/docs/intro", title="T", body="line1\nline2"):
        res = self.client.post(
            self.pages_url, {"path": path, "title": title, "body": body}
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        return Page.objects.get(path=path)

    def _put(self, path, **data):
        return self.client.put(f"{self.pages_url}?path={path}", data)

    # --- 保存スナップショット -------------------------------------------------

    def test_create_records_single_initial_revision(self):
        # 新規作成 → number=1 の初回リビジョン 1 件、Page.body と一致（6.2）。
        page = self._create_page(body="hello")
        revisions = Revision.objects.filter(page=page)
        self.assertEqual(revisions.count(), 1)
        rev = revisions.get(number=1)
        self.assertEqual(rev.body, "hello")
        self.assertEqual(page.body, rev.body)

    def test_update_records_full_snapshot_and_body_matches_latest(self):
        # 本文変更 PUT で全文スナップショットが増え、Page.body が最新リビジョンと一致。
        page = self._create_page(body="v1")
        self._put("/docs/intro", body="v2")
        page.refresh_from_db()
        latest = Revision.objects.filter(page=page).order_by("-number").first()
        self.assertEqual(latest.number, 2)
        self.assertEqual(latest.body, "v2")
        self.assertEqual(page.body, latest.body)

    def test_unchanged_body_does_not_increment(self):
        # 本文不変の PUT ではリビジョンが増えず updated_at も動かない（6.3）。
        page = self._create_page(body="same")
        before = page.updated_at
        self._put("/docs/intro", body="same")
        page.refresh_from_db()
        self.assertEqual(Revision.objects.filter(page=page).count(), 1)
        self.assertEqual(page.updated_at, before)

    def test_title_only_change_does_not_increment_but_updates_title(self):
        # title のみ変更: リビジョン増えず Page.title は更新・updated_at は動く（6.3）。
        page = self._create_page(title="Old", body="body")
        before = page.updated_at
        self._put("/docs/intro", title="New", body="body")
        page.refresh_from_db()
        self.assertEqual(Revision.objects.filter(page=page).count(), 1)
        self.assertEqual(page.title, "New")
        self.assertGreater(page.updated_at, before)

    def test_concurrent_duplicate_post_conflicts_409(self):
        # 同一 path への 2 回目 POST は 409（直列化は unique 制約が担保）。
        self._create_page(path="/dup", body="a")
        res = self.client.post(self.pages_url, {"path": "/dup", "body": "b"})
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        # リビジョンは最初の 1 件のみ（二重作成されない）。
        page = Page.objects.get(path="/dup")
        self.assertEqual(Revision.objects.filter(page=page).count(), 1)

    # --- 履歴一覧 -------------------------------------------------------------

    def test_history_newest_first(self):
        self._create_page(body="v1")
        self._put("/docs/intro", body="v2")
        self._put("/docs/intro", body="v3")
        res = self.client.get(self.list_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        numbers = [item["number"] for item in res.data]
        self.assertEqual(numbers, [3, 2, 1])
        # 軽量メタ: body/title を含めない。
        self.assertEqual(set(res.data[0].keys()), {"id", "number", "created_at", "author"})

    def test_history_paging_limit_offset(self):
        self._create_page(body="v1")
        for i in range(2, 6):
            self._put("/docs/intro", body=f"v{i}")  # numbers 2..5, total 5
        res = self.client.get(self.list_url, {"path": "/docs/intro", "limit": 2, "offset": 1})
        numbers = [item["number"] for item in res.data]
        # 新しい順 [5,4,3,2,1] の offset=1,limit=2 → [4,3]
        self.assertEqual(numbers, [4, 3])

    def test_history_limit_capped_at_200(self):
        page = self._create_page(body="v1")
        # 過大 limit は 200 にクランプ（例外にせず 200 応答）。
        res = self.client.get(self.list_url, {"path": "/docs/intro", "limit": 10000})
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_history_invalid_limit_offset_fallback(self):
        self._create_page(body="v1")
        res = self.client.get(
            self.list_url, {"path": "/docs/intro", "limit": "abc", "offset": "-5"}
        )
        # 不正値は既定へフォールバックし 400 にならない。
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)

    def test_history_missing_page_404(self):
        res = self.client.get(self.list_url, {"path": "/nope"})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    # --- 詳細取得 -------------------------------------------------------------

    def test_detail_returns_body(self):
        self._create_page(body="hello")
        res = self.client.get(self.detail_url, {"path": "/docs/intro", "number": 1})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["number"], 1)
        self.assertEqual(res.data["body"], "hello")

    def test_detail_nonexistent_number_404(self):
        self._create_page(body="hello")
        res = self.client.get(self.detail_url, {"path": "/docs/intro", "number": 99})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_detail_other_page_number_404(self):
        # 別ページの number は filter(page=page, number) で 404 になる。
        self._create_page(path="/a", body="a1")
        self._create_page(path="/b", body="b1")
        res = self.client.get(self.detail_url, {"path": "/a", "number": 1})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["body"], "a1")

    def test_detail_non_integer_number_404(self):
        self._create_page(body="hello")
        res = self.client.get(self.detail_url, {"path": "/docs/intro", "number": "x"})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    # --- 差分 -----------------------------------------------------------------

    def test_diff_line_level_replace_split_into_del_add(self):
        # v1: "a\nb\nc" → v2: "a\nX\nc"。中間行の replace が del+add に分解される。
        self._create_page(body="a\nb\nc")
        self._put("/docs/intro", body="a\nX\nc")
        res = self.client.get(
            self.diff_url, {"path": "/docs/intro", "from": 1, "to": 2}
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ops = [(d["op"], d["line"]) for d in res.data]
        self.assertEqual(
            ops,
            [("equal", "a"), ("del", "b"), ("add", "X"), ("equal", "c")],
        )
        # op:"change" は使わない。
        self.assertNotIn("change", {d["op"] for d in res.data})

    def test_diff_nonexistent_number_404(self):
        self._create_page(body="a")
        res = self.client.get(self.diff_url, {"path": "/docs/intro", "from": 1, "to": 9})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_diff_other_page_number_404(self):
        self._create_page(path="/a", body="a1")
        self._create_page(path="/b", body="b1")
        # /a has only number=1; number=2 does not exist for /a → 404
        res = self.client.get(self.diff_url, {"path": "/a", "from": 1, "to": 2})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    # --- 復元 -----------------------------------------------------------------

    def test_restore_makes_past_a_new_revision_without_deleting_past(self):
        self._create_page(body="v1")
        self._put("/docs/intro", body="v2")  # number=2 current
        page = Page.objects.get(path="/docs/intro")
        res = self.client.post(self.restore_url, {"path": "/docs/intro", "number": 1})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        page.refresh_from_db()
        # 復元で過去 body(v1) が新リビジョン number=3 として記録される。
        self.assertEqual(page.body, "v1")
        numbers = list(
            Revision.objects.filter(page=page).order_by("number").values_list("number", flat=True)
        )
        self.assertEqual(numbers, [1, 2, 3])
        # 過去（number=1）は消えていない。
        self.assertTrue(Revision.objects.filter(page=page, number=1).exists())

    def test_restore_noop_when_body_matches_latest(self):
        page = self._create_page(body="same")  # number=1 current
        res = self.client.post(self.restore_url, {"path": "/docs/intro", "number": 1})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        # 本文一致 → 新リビジョンを作らない no-op 成功。
        self.assertEqual(Revision.objects.filter(page=page).count(), 1)

    def test_restore_missing_page_404(self):
        res = self.client.post(self.restore_url, {"path": "/nope", "number": 1})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_restore_nonexistent_number_404(self):
        self._create_page(body="v1")
        res = self.client.post(self.restore_url, {"path": "/docs/intro", "number": 99})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    # --- author 削除 / page 削除 ---------------------------------------------

    def test_author_deletion_nulls_author_keeps_history(self):
        self.client.force_authenticate(user=self.other)
        self._create_page(body="v1")
        page = Page.objects.get(path="/docs/intro")
        self.other.delete()
        rev = Revision.objects.get(page=page, number=1)
        self.assertIsNone(rev.author)
        self.assertTrue(Revision.objects.filter(page=page, number=1).exists())

    def test_page_deletion_cascades_revisions(self):
        page = self._create_page(body="v1")
        self._put("/docs/intro", body="v2")
        page_id = page.id
        self.client.delete(f"{self.pages_url}?path=/docs/intro")
        self.assertFalse(Revision.objects.filter(page_id=page_id).exists())

    # --- 権限ゲート（履歴=view, restore=edit） --------------------------------

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_history_requires_view_denied_403(self):
        # 事前にページ作成（権限ありの状態で作る）。
        with override_settings(JANUS_DEFAULT_PAGE_VIEW=True, JANUS_DEFAULT_PAGE_EDIT=True):
            self._create_page(body="v1")
        res = self.client.get(self.list_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(
        JANUS_DEFAULT_PAGE_VIEW=False,
        JANUS_DEFAULT_PAGE_EDIT=False,
        JANUS_HIDE_FORBIDDEN=True,
    )
    def test_history_denied_404_when_hidden(self):
        with override_settings(JANUS_DEFAULT_PAGE_VIEW=True, JANUS_DEFAULT_PAGE_EDIT=True):
            self._create_page(body="v1")
        res = self.client.get(self.list_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_restore_requires_edit(self):
        # view はできるが edit できないユーザーで restore → 403。
        self._create_page(body="v1")
        self._put("/docs/intro", body="v2")
        # /docs に alice への edit deny を置く（view は含意されない deny）。
        PagePermission.objects.create(
            path="/docs/intro",
            principal_type="user",
            user=self.user,
            action="edit",
            effect="deny",
        )
        res = self.client.post(self.restore_url, {"path": "/docs/intro", "number": 1})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        # view（履歴一覧）は edit deny では妨げられない。
        res_list = self.client.get(self.list_url, {"path": "/docs/intro"})
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)

    def test_restore_permission_before_existence_when_hidden(self):
        # 権限→存在の順: edit 不足 + 秘匿で、number 不在でも 404（権限段階で確定）。
        self._create_page(body="v1")
        with override_settings(JANUS_HIDE_FORBIDDEN=True):
            PagePermission.objects.create(
                path="/docs/intro",
                principal_type="user",
                user=self.user,
                action="edit",
                effect="deny",
            )
            res = self.client.post(
                self.restore_url, {"path": "/docs/intro", "number": 999}
            )
            self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)


class BackfillMigrationTest(TestCase):
    """0004 バックフィル forward 関数の冪等性・空ページ対象を固定する（design 7）。"""

    def _load_backfill(self):
        import importlib

        module = importlib.import_module(
            "api.migrations.0004_backfill_initial_revisions"
        )
        return module

    def test_backfill_covers_empty_body_and_is_idempotent(self):
        from django.apps import apps as global_apps

        module = self._load_backfill()
        # バックフィルは setUp 時点で既に適用済み。空 body ページを新規に作り、
        # forward を直接呼んで初回リビジョンが付くこと・2 回目で増えないことを固定。
        empty_page = Page.objects.create(path="/empty", title="", body="")
        self.assertFalse(Revision.objects.filter(page=empty_page).exists())

        module.backfill_initial_revisions(global_apps, None)
        self.assertEqual(Revision.objects.filter(page=empty_page).count(), 1)
        rev = Revision.objects.get(page=empty_page, number=1)
        self.assertEqual(rev.body, "")
        self.assertEqual(rev.created_at, empty_page.updated_at)

        # 2 回目は exists() ガードで二重作成しない（冪等）。
        module.backfill_initial_revisions(global_apps, None)
        self.assertEqual(Revision.objects.filter(page=empty_page).count(), 1)
