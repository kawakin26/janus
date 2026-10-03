"""Janus フェーズ 1 のデータモデル。"""

import os
import re
import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class Page(models.Model):
    """ページ（Markdown 生テキストを保持する最小単位）。"""

    path = models.CharField(max_length=1000, unique=True, db_index=True)
    title = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_pages",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="updated_pages",
    )

    def __str__(self) -> str:
        return self.path


class Folder(models.Model):
    """アセットライブラリの論理フォルダ。"""

    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="children",
    )
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["parent", "name"],
                condition=Q(parent__isnull=False),
                name="folder_parent_name_unique",
            ),
            models.UniqueConstraint(
                fields=["name"],
                condition=Q(parent__isnull=True),
                name="folder_root_name_unique",
            ),
        ]

    def __str__(self) -> str:
        return self.name


def asset_upload_to(_instance: "Asset", filename: str) -> str:
    """論理階層や表示名を含まないUUID系のフラット保存名を返す。"""

    extension = os.path.splitext(os.path.basename(filename))[1].lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,10}", extension):
        extension = ""
    return f"{uuid.uuid4()}{extension}"


class Asset(models.Model):
    """ページから独立したアセットライブラリの実体。"""

    folder = models.ForeignKey(
        Folder,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assets",
    )
    filename = models.CharField(max_length=255, db_index=True)
    alias = models.CharField(max_length=255, blank=True, db_index=True)
    file = models.FileField(upload_to=asset_upload_to)
    content_type = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["folder", "filename"],
                condition=Q(folder__isnull=False),
                name="asset_folder_filename_unique",
            ),
            models.UniqueConstraint(
                fields=["filename"],
                condition=Q(folder__isnull=True),
                name="asset_root_filename_unique",
            ),
            models.UniqueConstraint(
                fields=["folder", "alias"],
                condition=Q(folder__isnull=False) & ~Q(alias=""),
                name="asset_folder_alias_unique",
            ),
            models.UniqueConstraint(
                fields=["alias"],
                condition=Q(folder__isnull=True) & ~Q(alias=""),
                name="asset_root_alias_unique",
            ),
        ]

    def __str__(self) -> str:
        return self.filename
