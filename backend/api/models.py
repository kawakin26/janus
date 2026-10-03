"""Janus フェーズ 1 のデータモデル。"""

import os
import re
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
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


class PagePermission(models.Model):
    """ページパスに対する権限エントリ（design 2.1 / 要件 P2-1）。

    path は Page への FK ではなく文字列で保持し、実ページが無い祖先パスにも
    設定できる（仮想ノード許容）。主体は principal_type に応じて user/group の
    どちらか一方のみを非 null で持つ。主体が消えたら設定自体が無意味になるため
    user/group は CASCADE（Revision の author SET_NULL とは目的が異なる）。
    """

    PRINCIPAL_TYPE_CHOICES = [
        ("user", "user"),
        ("group", "group"),
    ]
    ACTION_CHOICES = [
        ("view", "view"),
        ("edit", "edit"),
    ]
    EFFECT_CHOICES = [
        ("allow", "allow"),
        ("deny", "deny"),
    ]

    path = models.CharField(max_length=1000, db_index=True)
    principal_type = models.CharField(max_length=5, choices=PRINCIPAL_TYPE_CHOICES)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="page_permissions",
    )
    group = models.ForeignKey(
        "auth.Group",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="page_permissions",
    )
    action = models.CharField(max_length=4, choices=ACTION_CHOICES)
    effect = models.CharField(max_length=5, choices=EFFECT_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["path", "user", "action"],
                condition=Q(principal_type="user"),
                name="pageperm_user_unique",
            ),
            models.UniqueConstraint(
                fields=["path", "group", "action"],
                condition=Q(principal_type="group"),
                name="pageperm_group_unique",
            ),
        ]

    def clean(self) -> None:
        """principal_type と user/group の整合性を検証する（admin 直接作成の保険）。"""

        if self.principal_type == "user":
            if self.user is None or self.group is not None:
                raise ValidationError(
                    "principal_type='user' のときは user のみを指定してください。"
                )
        elif self.principal_type == "group":
            if self.group is None or self.user is not None:
                raise ValidationError(
                    "principal_type='group' のときは group のみを指定してください。"
                )

    def __str__(self) -> str:
        return f"{self.path} {self.principal_type} {self.action} {self.effect}"


class Revision(models.Model):
    """ページ本文の全文スナップショット履歴（design 2.2 / 要件 P2-8）。"""

    page = models.ForeignKey(
        Page,
        on_delete=models.CASCADE,
        related_name="revisions",
    )
    number = models.PositiveIntegerField()
    body = models.TextField(blank=True)
    title = models.CharField(max_length=255, blank=True)
    # auto_now_add は使わない（Block B のバックフィルで過去日時を明示代入するため）。
    created_at = models.DateTimeField(db_index=True)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="authored_revisions",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["page", "number"],
                name="revision_page_number_unique",
            ),
        ]
        ordering = ["-number"]
        indexes = [
            models.Index(fields=["page", "number"]),
        ]

    def __str__(self) -> str:
        return f"{self.page_id}#{self.number}"
