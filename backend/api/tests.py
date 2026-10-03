"""Page / Folder / Asset モデルの契約テスト。"""

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.test import TestCase

from .models import Asset, Folder, Page


class PageModelTest(TestCase):
    def test_str_returns_path(self):
        page = Page.objects.create(path="/docs/intro", body="hello")
        self.assertEqual(str(page), "/docs/intro")

    def test_path_must_be_unique(self):
        Page.objects.create(path="/docs/intro", body="first")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Page.objects.create(path="/docs/intro", body="second")

    def test_created_by_is_set_null_on_user_delete(self):
        user = get_user_model().objects.create_user(username="author", password="pw")
        page = Page.objects.create(path="/docs/owned", body="x", created_by=user)
        user.delete()
        page.refresh_from_db()
        self.assertIsNone(page.created_by)


class AssetLibraryModelTest(TestCase):
    def test_folder_root_and_nested_names_are_unique(self):
        Folder.objects.create(name="2F")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Folder.objects.create(name="2F")
        parent = Folder.objects.create(name="本館")
        Folder.objects.create(parent=parent, name="2F")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Folder.objects.create(parent=parent, name="2F")
        other = Folder.objects.create(name="別館")
        Folder.objects.create(parent=other, name="2F")

    def test_asset_names_are_unique_per_folder_and_empty_alias_is_exempt(self):
        first = Asset.objects.create(filename="map.png", alias="floor", file=ContentFile(b"a", "a.png"))
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Asset.objects.create(filename="map.png", alias="other", file=ContentFile(b"b", "b.png"))
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Asset.objects.create(filename="other.png", alias="floor", file=ContentFile(b"c", "c.png"))
        Asset.objects.create(filename="other.png", file=ContentFile(b"d", "d.png"))
        self.assertEqual(first.filename, "map.png")

    def test_asset_str_returns_filename(self):
        asset = Asset.objects.create(filename="map.png", file=ContentFile(b"a", "map.png"))
        self.assertEqual(str(asset), "map.png")
