"""
Page / Attachment モデルの最小テスト。

design.md 10 章の方針に従い、網羅テストは作らずモデルの契約点のみ検証する。
検証対象: __str__、path の一意制約、created_by の SET_NULL 挙動、
Attachment の related_name="attachments" 逆参照。
"""

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase

from .models import Attachment, Page


class PageModelTest(TestCase):
    """Page モデルの契約を確認する。"""

    def test_str_returns_path(self):
        # __str__ は一意なパスを返す。
        page = Page.objects.create(path="/docs/intro", body="hello")
        self.assertEqual(str(page), "/docs/intro")

    def test_path_must_be_unique(self):
        # 同一 path の 2 件目作成は IntegrityError になる（要件 2-7）。
        Page.objects.create(path="/docs/intro", body="first")
        with self.assertRaises(IntegrityError):
            # IntegrityError 後にトランザクションが壊れるため atomic で包む。
            with transaction.atomic():
                Page.objects.create(path="/docs/intro", body="second")

    def test_created_by_is_set_null_on_user_delete(self):
        # ユーザー削除後もページは残り、created_by は None になる（SET_NULL）。
        user = get_user_model().objects.create_user(
            username="author", password="pw-for-test"
        )
        page = Page.objects.create(path="/docs/owned", body="x", created_by=user)
        user.delete()
        page.refresh_from_db()
        self.assertIsNone(page.created_by)


class AttachmentModelTest(TestCase):
    """Attachment モデルの契約を確認する。"""

    def test_str_and_reverse_relation(self):
        # __str__ は original_name を返し、page.attachments から逆参照できる。
        page = Page.objects.create(path="/docs/with-asset", body="x")
        attachment = Attachment.objects.create(
            page=page,
            original_name="map.png",
            file="attachments/2024/01/01/map.png",
            content_type="image/png",
        )
        self.assertEqual(str(attachment), "map.png")
        self.assertEqual(list(page.attachments.all()), [attachment])
