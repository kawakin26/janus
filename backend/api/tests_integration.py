"""ログインから独立アセット操作までの最小統合テスト。"""

import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Asset, Page

_TEMP_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=_TEMP_MEDIA_ROOT)
class Phase1IntegrationScenarioTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_TEMP_MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.password = "test-pass-123"
        self.user = get_user_model().objects.create_user(username="alice", password=self.password)

    def test_login_page_and_independent_asset_flow(self):
        login = self.client.post(
            reverse("api:auth-login"),
            {"username": "alice", "password": self.password},
        )
        self.assertEqual(login.status_code, status.HTTP_200_OK)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {login.data['token']}")

        page_response = self.client.post(
            reverse("api:pages"),
            {"path": "/docs/map", "title": "Map", "body": ":::custom-map"},
        )
        self.assertEqual(page_response.status_code, status.HTTP_201_CREATED)

        upload = self.client.post(
            reverse("api:assets"),
            {"file": SimpleUploadedFile("map.png", b"PNGDATA", content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(upload.status_code, status.HTTP_201_CREATED)
        self.assertEqual(upload.data["filename"], "map.png")
        asset_id = upload.data["id"]

        deleted = self.client.delete(f"{reverse('api:pages')}?path=/docs/map")
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertTrue(Asset.objects.filter(pk=asset_id).exists())
        self.assertEqual(
            self.client.get(reverse("api:assets"), status=status.HTTP_200_OK).status_code,
            status.HTTP_200_OK,
        )
