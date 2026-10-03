"""独立アセットライブラリREST APIのテスト。"""

import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Asset, Folder, Page

_TEMP_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=_TEMP_MEDIA_ROOT)
class AssetApiTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_TEMP_MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = get_user_model().objects.create_user(username="alice", password="pw")
        self.client.force_authenticate(user=self.user)
        self.folders_url = reverse("api:folders")
        self.assets_url = reverse("api:assets")
        self.folder = Folder.objects.create(name="本館")
        self.other_folder = Folder.objects.create(name="別館")

    def _upload(self, name="map.png", alias="", folder=None, content=b"DATA"):
        query = "" if folder is None else f"?folder={folder}"
        return self.client.post(
            f"{self.assets_url}{query}",
            {"file": SimpleUploadedFile(name, content, content_type="image/png"), "alias": alias},
            format="multipart",
        )

    def test_root_and_nested_folder_api_and_duplicate_409(self):
        created = self.client.post(self.folders_url, {"name": "別館"})
        self.assertEqual(created.status_code, status.HTTP_409_CONFLICT)
        child = self.client.post(self.folders_url, {"parentId": self.folder.id, "name": "2F"})
        self.assertEqual(child.status_code, status.HTTP_201_CREATED)
        self.assertEqual(child.data["parentId"], self.folder.id)
        duplicate = self.client.post(self.folders_url, {"parentId": self.folder.id, "name": "2F"})
        self.assertEqual(duplicate.status_code, status.HTTP_409_CONFLICT)
        listed = self.client.get(self.folders_url, {"parent": self.folder.id})
        self.assertEqual([item["name"] for item in listed.data], ["2F"])

    def test_upload_list_and_uuid_flat_file_name(self):
        response = self._upload(alias="現場図")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["filename"], "map.png")
        self.assertEqual(response.data["alias"], "現場図")
        self.assertEqual(response.data["folderId"], None)
        asset = Asset.objects.get(pk=response.data["id"])
        self.assertEqual(asset.folder_id, None)
        self.assertEqual(len(Path(asset.file.name).parts), 1)
        self.assertNotEqual(asset.file.name, "map.png")
        self.assertTrue(asset.file.name.endswith(".png"))
        self.assertEqual(response.data["url"], f"/api/assets/{asset.id}/file")

        in_folder = self._upload(name="map.png", folder=self.folder.id)
        self.assertEqual(in_folder.status_code, status.HTTP_201_CREATED)
        listed = self.client.get(self.assets_url, {"folder": self.folder.id})
        self.assertEqual(len(listed.data), 1)
        self.assertEqual(listed.data[0]["filename"], "map.png")

    def test_physical_extension_is_safe_and_display_filename_is_preserved(self):
        response = self._upload(name="drawing.svg!", content=b"SVGDATA")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        asset = Asset.objects.get(pk=response.data["id"])
        self.assertEqual(asset.filename, "drawing.svg!")
        self.assertRegex(Path(asset.file.name).name, r"^[0-9a-f-]{36}$")

    def test_duplicate_filename_and_alias_return_409(self):
        self.assertEqual(self._upload(alias="floor").status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._upload(name="map.png", alias="other").status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(self._upload(name="other.png", alias="floor").status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(self._upload(name="map.png", alias="", folder=self.folder.id).status_code, status.HTTP_201_CREATED)

    def test_move_conflict_is_409_and_file_remains_physically_unchanged(self):
        source = self._upload(name="source.png", alias="same", folder=self.folder.id, content=b"SOURCE")
        target = self._upload(name="target.png", alias="same", folder=self.other_folder.id)
        asset = Asset.objects.get(pk=source.data["id"])
        physical_name = asset.file.name
        conflict = self.client.patch(
            reverse("api:assets-detail", args=[asset.id]),
            {"folderId": self.other_folder.id},
            format="json",
        )
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        asset.refresh_from_db()
        self.assertEqual(asset.folder_id, self.folder.id)
        self.assertEqual(asset.file.name, physical_name)

        Asset.objects.get(pk=target.data["id"]).delete()
        moved = self.client.patch(
            reverse("api:assets-detail", args=[asset.id]),
            {"folderId": self.other_folder.id},
            format="json",
        )
        self.assertEqual(moved.status_code, status.HTTP_200_OK)
        asset.refresh_from_db()
        self.assertEqual(asset.folder_id, self.other_folder.id)
        self.assertEqual(asset.file.name, physical_name)

    def test_file_delivery_and_page_deletion_do_not_remove_asset(self):
        page = Page.objects.create(path="/docs/map")
        uploaded = self._upload(content=b"PNGDATA")
        asset = Asset.objects.get(pk=uploaded.data["id"])
        response = self.client.get(reverse("api:assets-file", args=[asset.id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(b"".join(response.streaming_content), b"PNGDATA")
        page.delete()
        self.assertTrue(Asset.objects.filter(pk=asset.id).exists())

    def test_old_page_attachment_and_old_asset_url_are_removed(self):
        self.assertEqual(self.client.get("/api/pages/assets?path=/docs/map").status_code, status.HTTP_404_NOT_FOUND)
        asset = Asset.objects.create(filename="map.png", file=SimpleUploadedFile("map.png", b"x"))
        self.assertEqual(self.client.get(f"/api/assets/{asset.id}").status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_new_asset_endpoints_require_authentication(self):
        asset = Asset.objects.create(
            filename="protected.png",
            file=SimpleUploadedFile("protected.png", b"x"),
        )
        self.client.force_authenticate(user=None)

        self.assertEqual(self.client.get(self.folders_url).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(
            self.client.post(self.folders_url, {"name": "private"}).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(self.client.get(self.assets_url).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(
            self.client.post(
                self.assets_url,
                {"file": SimpleUploadedFile("new.png", b"x")},
                format="multipart",
            ).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(
            self.client.patch(
                reverse("api:assets-detail", args=[asset.id]),
                {"folderId": self.folder.id},
                format="json",
            ).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(
            self.client.get(reverse("api:assets-file", args=[asset.id])).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_integrity_error_upload_removes_file_saved_before_database_rollback(self):
        before_files = set(Path(_TEMP_MEDIA_ROOT).iterdir())
        original_save = Asset.save

        def save_then_fail(asset, *args, **kwargs):
            original_save(asset, *args, **kwargs)
            raise IntegrityError("simulated concurrent upload")

        with patch.object(Asset, "save", new=save_then_fail):
            response = self._upload(name="race.png")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertFalse(Asset.objects.filter(filename="race.png").exists())
        self.assertEqual(set(Path(_TEMP_MEDIA_ROOT).iterdir()), before_files)
