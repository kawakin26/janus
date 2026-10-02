"""
API シリアライザ。

design.md 4 章の AuthClient 契約（login / currentUser が返す User 表現）に対応する。
UserSerializer は login と me の両エンドポイントで共通利用し、ユーザー表現を一本化する。
"""

from django.contrib.auth import get_user_model
from rest_framework import serializers


class UserSerializer(serializers.ModelSerializer):
    """ユーザー表現（login / me 共通）。

    要件 4-4 の「管理者 / 一般の区別」のため is_staff / is_superuser を含める。
    すべて読み取り専用（この契約では更新用途を持たない）。
    """

    class Meta:
        model = get_user_model()
        fields = ["id", "username", "is_staff", "is_superuser"]
        read_only_fields = fields
