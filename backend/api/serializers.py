"""
API シリアライザ。

design.md 4 章の AuthClient 契約（login / currentUser が返す User 表現）に対応する。
UserSerializer は login と me の両エンドポイントで共通利用し、ユーザー表現を一本化する。
"""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Page


class UserSerializer(serializers.ModelSerializer):
    """ユーザー表現（login / me 共通）。

    要件 4-4 の「管理者 / 一般の区別」のため is_staff / is_superuser を含める。
    すべて読み取り専用（この契約では更新用途を持たない）。
    """

    class Meta:
        model = get_user_model()
        fields = ["id", "username", "is_staff", "is_superuser"]
        read_only_fields = fields


class PageSerializer(serializers.ModelSerializer):
    """ページの詳細表現（design.md 4 章 PageClient の Page 相当）。

    getPage / createPage / updatePage のレスポンスに使う。created_by /
    updated_by は UserSerializer の軽量ネスト（null 許容・読み取り専用）で返す。
    path / title / body は入力に使うが、path の正規化・重複判定と created_by /
    updated_by の設定はビュー側で行う（save() 時に明示設定）ため、本シリアライザの
    create / update ロジックには依存しない。
    """

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
        # id・日時・作成者/更新者はサーバー側で決まるため読み取り専用。
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]


class PageSummarySerializer(serializers.ModelSerializer):
    """ページの軽量表現（design.md 4 章 PageClient の PageSummary 相当）。

    listChildren（子ページ一覧）のレスポンスに使う。階層ナビで必要な最小限の
    フィールド（path・title）のみを読み取り専用で返す。
    """

    class Meta:
        model = Page
        fields = ["path", "title"]
        read_only_fields = fields
