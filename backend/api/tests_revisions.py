"""PagePermission / Revision モデルの契約テスト（design 2.1 / 2.2）。

既存 tests.py のモデルテスト流儀（IntegrityError を transaction.atomic 内で
assertRaises）に合わせ、部分一意制約・clean 整合・CASCADE/SET_NULL を検証する。
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

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
