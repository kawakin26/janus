"""コメント REST API のテスト（design 3.1 / 3.2 / 12 章 T-C-1..6）。

tests_assets.py / tests_revisions.py の APITestCase 流儀（force_authenticate、
reverse、override_settings）に合わせる。既定ポリシー（view/edit allow）では権限
分岐が観測できないため、権限を要する検証は JANUS_DEFAULT_PAGE_VIEW/EDIT=False
を敷いた上で明示 PagePermission を付与して行う。
"""

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Comment, Page, PagePermission, Revision
from .services import save_page_body


def _make_user_perm(path, user, action, effect):
    return PagePermission.objects.create(
        path=path,
        principal_type="user",
        user=user,
        action=action,
        effect=effect,
    )


class CommentApiTests(APITestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.alice = self.user_model.objects.create_user(username="alice", password="pw")
        self.bob = self.user_model.objects.create_user(username="bob", password="pw")
        self.list_url = reverse("api:pages-comments")
        # ページは既定許可の下で作成しておく（権限分岐は各テストで override する）。
        self.page, _ = save_page_body(
            "/docs/intro", title="T", body="line1\nline2", author=self.alice
        )

    def _detail_url(self, pk):
        return reverse("api:pages-comments-detail", args=[pk])

    # --- T-C-1: view 権限で投稿、body/created_at/author を記録 ------------------
    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_post_with_view_permission_records_fields(self):
        _make_user_perm("/docs/intro", self.alice, "view", "allow")
        self.client.force_authenticate(user=self.alice)
        res = self.client.post(
            self.list_url, {"path": "/docs/intro", "body": "最初のコメント"}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["body"], "最初のコメント")
        self.assertIsNotNone(res.data["created_at"])
        self.assertEqual(res.data["author"]["id"], self.alice.id)
        self.assertEqual(res.data["author"]["username"], "alice")

    # --- T-C-2: 一覧は昇順、権限/存在の 403/404 を分割検証 ----------------------
    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_list_returns_ascending_by_created_at(self):
        _make_user_perm("/docs/intro", self.alice, "view", "allow")
        c1 = Comment.objects.create(page=self.page, body="one", author=self.alice)
        c2 = Comment.objects.create(page=self.page, body="two", author=self.alice)
        self.client.force_authenticate(user=self.alice)
        res = self.client.get(self.list_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in res.data], [c1.id, c2.id])
        self.assertEqual([item["body"] for item in res.data], ["one", "two"])

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_list_no_view_permission_is_403_by_default(self):
        self.client.force_authenticate(user=self.alice)
        res = self.client.get(self.list_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(
        JANUS_DEFAULT_PAGE_VIEW=False,
        JANUS_DEFAULT_PAGE_EDIT=False,
        JANUS_HIDE_FORBIDDEN=True,
    )
    def test_list_no_view_permission_is_404_when_hidden(self):
        self.client.force_authenticate(user=self.alice)
        res = self.client.get(self.list_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_list_view_permission_but_page_absent_is_404(self):
        _make_user_perm("/docs/missing", self.alice, "view", "allow")
        self.client.force_authenticate(user=self.alice)
        res = self.client.get(self.list_url, {"path": "/docs/missing"})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(
        JANUS_DEFAULT_PAGE_VIEW=False,
        JANUS_DEFAULT_PAGE_EDIT=False,
        JANUS_HIDE_FORBIDDEN=True,
    )
    def test_list_view_permission_but_page_absent_is_404_even_when_hidden(self):
        # view 権限がある以上、不在ページは秘匿運用でも常に 404（403 ではない）。
        _make_user_perm("/docs/missing", self.alice, "view", "allow")
        self.client.force_authenticate(user=self.alice)
        res = self.client.get(self.list_url, {"path": "/docs/missing"})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    # --- T-C-3: 編集/削除の権限（本人・edit・superuser 可、無関係者は常に 403）---
    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_author_self_can_modify_and_delete(self):
        comment = Comment.objects.create(page=self.page, body="orig", author=self.alice)
        self.client.force_authenticate(user=self.alice)
        res = self.client.patch(
            self._detail_url(comment.id), {"body": "edited"}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["body"], "edited")
        res_del = self.client.delete(self._detail_url(comment.id))
        self.assertEqual(res_del.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Comment.objects.filter(pk=comment.id).exists())

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_edit_permission_holder_can_modify_and_delete(self):
        # bob はページ edit 権限者（投稿者ではない）。
        _make_user_perm("/docs/intro", self.bob, "edit", "allow")
        comment = Comment.objects.create(page=self.page, body="orig", author=self.alice)
        self.client.force_authenticate(user=self.bob)
        res = self.client.patch(
            self._detail_url(comment.id), {"body": "by editor"}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        res_del = self.client.delete(self._detail_url(comment.id))
        self.assertEqual(res_del.status_code, status.HTTP_204_NO_CONTENT)

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_superuser_can_modify_and_delete(self):
        root = self.user_model.objects.create_superuser(
            username="root", password="pw", email="r@example.com"
        )
        comment = Comment.objects.create(page=self.page, body="orig", author=self.alice)
        self.client.force_authenticate(user=root)
        res = self.client.patch(
            self._detail_url(comment.id), {"body": "by admin"}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        res_del = self.client.delete(self._detail_url(comment.id))
        self.assertEqual(res_del.status_code, status.HTTP_204_NO_CONTENT)

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_unrelated_user_modify_is_403_by_default(self):
        comment = Comment.objects.create(page=self.page, body="orig", author=self.alice)
        self.client.force_authenticate(user=self.bob)
        res = self.client.patch(
            self._detail_url(comment.id), {"body": "nope"}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        res_del = self.client.delete(self._detail_url(comment.id))
        self.assertEqual(res_del.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(
        JANUS_DEFAULT_PAGE_VIEW=False,
        JANUS_DEFAULT_PAGE_EDIT=False,
        JANUS_HIDE_FORBIDDEN=True,
    )
    def test_unrelated_user_modify_is_403_even_when_hidden(self):
        # 秘匿運用でもコメント編集系は 404 すり替えされず常に 403（design 3.2 不変条件）。
        comment = Comment.objects.create(page=self.page, body="orig", author=self.alice)
        self.client.force_authenticate(user=self.bob)
        res = self.client.patch(
            self._detail_url(comment.id), {"body": "nope"}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        res_del = self.client.delete(self._detail_url(comment.id))
        self.assertEqual(res_del.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_patch_delete_missing_comment_is_404(self):
        self.client.force_authenticate(user=self.alice)
        res = self.client.patch(self._detail_url(999999), {"body": "x"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        res_del = self.client.delete(self._detail_url(999999))
        self.assertEqual(res_del.status_code, status.HTTP_404_NOT_FOUND)

    # --- T-C-4: ページ削除で連動削除、投稿者削除で author=null -------------------
    def test_page_delete_cascades_comments(self):
        Comment.objects.create(page=self.page, body="x", author=self.alice)
        page_id = self.page.id
        self.page.delete()
        self.assertEqual(Comment.objects.filter(page_id=page_id).count(), 0)

    def test_author_delete_sets_author_null(self):
        comment = Comment.objects.create(page=self.page, body="x", author=self.bob)
        self.bob.delete()
        comment.refresh_from_db()
        self.assertIsNone(comment.author_id)
        # 本文・日時は監査性のため残る（SET_NULL）。
        self.assertEqual(comment.body, "x")

    # --- T-C-5: コメント操作は本文・リビジョン・Page.updated_at に非干渉 ---------
    def test_comment_ops_do_not_touch_body_or_revision_or_updated_at(self):
        before = Page.objects.get(pk=self.page.pk)
        body_before = before.body
        updated_before = before.updated_at
        rev_count_before = Revision.objects.filter(page=self.page).count()
        latest_rev_before = Revision.objects.filter(page=self.page).order_by("-number").first()

        self.client.force_authenticate(user=self.alice)
        res = self.client.post(
            self.list_url, {"path": "/docs/intro", "body": "c1"}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        comment_id = res.data["id"]
        self.client.patch(
            self._detail_url(comment_id), {"body": "c1-edited"}, format="json"
        )
        self.client.delete(self._detail_url(comment_id))

        after = Page.objects.get(pk=self.page.pk)
        self.assertEqual(after.body, body_before)
        self.assertEqual(after.updated_at, updated_before)
        self.assertEqual(
            Revision.objects.filter(page=self.page).count(), rev_count_before
        )
        latest_rev_after = Revision.objects.filter(page=self.page).order_by("-number").first()
        self.assertEqual(latest_rev_after.number, latest_rev_before.number)
        self.assertEqual(latest_rev_after.body, latest_rev_before.body)

    # --- T-C-6: 本文バリデーション（空・空白のみ・上限境界） ---------------------
    def test_empty_body_is_400(self):
        self.client.force_authenticate(user=self.alice)
        res = self.client.post(
            self.list_url, {"path": "/docs/intro", "body": ""}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_whitespace_only_body_is_400(self):
        self.client.force_authenticate(user=self.alice)
        res = self.client.post(
            self.list_url, {"path": "/docs/intro", "body": "   \n\t  "}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_body_exactly_10000_is_201(self):
        self.client.force_authenticate(user=self.alice)
        res = self.client.post(
            self.list_url, {"path": "/docs/intro", "body": "a" * 10000}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

    def test_body_10001_is_400(self):
        self.client.force_authenticate(user=self.alice)
        res = self.client.post(
            self.list_url, {"path": "/docs/intro", "body": "a" * 10001}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_body_over_limit_with_surrounding_whitespace_is_400(self):
        # strip() 前の len() が 10,000 超（中身 9,999 + 前後空白）→ 上限超過で 400。
        self.client.force_authenticate(user=self.alice)
        body = " " + ("a" * 9999) + "  "  # len() == 10002
        self.assertEqual(len(body), 10002)
        res = self.client.post(
            self.list_url, {"path": "/docs/intro", "body": body}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patch_empty_body_is_400(self):
        comment = Comment.objects.create(page=self.page, body="orig", author=self.alice)
        self.client.force_authenticate(user=self.alice)
        res = self.client.patch(
            self._detail_url(comment.id), {"body": "   "}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        comment.refresh_from_db()
        self.assertEqual(comment.body, "orig")
