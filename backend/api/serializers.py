"""APIシリアライザ。"""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import serializers

from .models import Asset, Folder, Page


class UserSerializer(serializers.ModelSerializer):
    """ログイン・現在ユーザー共通のユーザー表現。"""

    class Meta:
        model = get_user_model()
        fields = ["id", "username", "is_staff", "is_superuser"]
        read_only_fields = fields


class PageSerializer(serializers.ModelSerializer):
    """ページ詳細表現。"""

    created_by = UserSerializer(read_only=True)
    updated_by = UserSerializer(read_only=True)

    class Meta:
        model = Page
        fields = [
            "id",
            "path",
            "title",
            "body",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]


class PageSummarySerializer(serializers.ModelSerializer):
    """ページ一覧の軽量表現。"""

    class Meta:
        model = Page
        fields = ["path", "title"]
        read_only_fields = fields


class FolderSerializer(serializers.ModelSerializer):
    """フォルダ表現。parentId はAPI入力・出力のフォルダID。"""

    parentId = serializers.SerializerMethodField()
    name = serializers.CharField(max_length=255)

    class Meta:
        model = Folder
        fields = ["id", "parentId", "name", "created_at", "updated_at"]
        read_only_fields = ["id", "parentId", "created_at", "updated_at"]

    def get_parentId(self, obj):
        return obj.parent_id


class AssetSerializer(serializers.ModelSerializer):
    """独立アセットの表現。"""

    folderId = serializers.PrimaryKeyRelatedField(
        source="folder", read_only=True, allow_null=True
    )
    url = serializers.SerializerMethodField()

    class Meta:
        model = Asset
        fields = [
            "id",
            "folderId",
            "filename",
            "alias",
            "url",
            "content_type",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_url(self, obj):
        if not obj.file:
            return ""
        return reverse("api:assets-file", args=[obj.pk])
