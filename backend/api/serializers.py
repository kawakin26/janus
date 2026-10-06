"""APIシリアライザ。"""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import serializers

from .models import Asset, Comment, Folder, Page, PagePermission, Revision

COMMENT_BODY_MAX_LENGTH = 10000


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


class PageTreeNodeSerializer(serializers.Serializer):
    """ページツリー 1 ノードの出力表現（design 2.2 / 2.3）。

    PageTreeView が組み立てたプレーンな dict ツリー（キーは path/title/hasPage/
    hasChildren/children。仮想ノードは Page インスタンスを持たない）を整形する
    純粋 Serializer。ModelSerializer にはしない。children は自己再帰で、クラス
    定義本体内から自分自身を many=True 参照できないため get_fields() で後付けする。
    出力 JSON のキーは dict と一致させ camelCase（hasPage/hasChildren）のまま返す。
    """

    path = serializers.CharField()
    title = serializers.CharField()
    hasPage = serializers.BooleanField()
    hasChildren = serializers.BooleanField()

    def get_fields(self):
        fields = super().get_fields()
        # 自己再帰: children は PageTreeNodeSerializer のネスト配列。
        fields["children"] = PageTreeNodeSerializer(many=True)
        return fields


class RevisionSummarySerializer(serializers.ModelSerializer):
    """履歴一覧の軽量表現（design 5.5）。body/title を含めない。"""

    author = UserSerializer(read_only=True)

    class Meta:
        model = Revision
        fields = ["id", "number", "created_at", "author"]
        read_only_fields = fields


class RevisionSerializer(serializers.ModelSerializer):
    """リビジョン 1 件の詳細表現（design 5.5）。本文・タイトルを含む。"""

    author = UserSerializer(read_only=True)

    class Meta:
        model = Revision
        fields = ["id", "number", "created_at", "author", "body", "title"]
        read_only_fields = fields


class CommentSerializer(serializers.ModelSerializer):
    """コメント 1 件の入出力（design 2.2）。本文検証は validate_body が所有する。

    出力は {id, body, author, created_at, updated_at}（author は UserSerializer で
    User | null）。id/author/created_at/updated_at は read-only、body のみ書込可。
    PATCH（partial=True + body のみ）で created_at/author は不変。
    """

    author = UserSerializer(read_only=True)
    # DRF CharField は既定で前後空白を除去する（trim_whitespace=True）。本文の上限は
    # strip() 前の受領文字列の len() で課す（design 2.2）ため、トリムを無効化して
    # validate_body に生の文字列を渡す。空判定も validate_body が strip() して行う。
    body = serializers.CharField(trim_whitespace=False)

    class Meta:
        model = Comment
        fields = ["id", "body", "author", "created_at", "updated_at"]
        read_only_fields = ["id", "author", "created_at", "updated_at"]

    def validate_body(self, value):
        # 上限と空判定は別基準（design 2.2 / レビュー指摘 6）。
        # (1) 上限: strip() 前の受領文字列の len()（コードポイント数、改行も 1 文字）
        #     が 10,000 を超える（10,001 以上）なら 400。
        if len(value) > COMMENT_BODY_MAX_LENGTH:
            raise serializers.ValidationError(
                f"本文は{COMMENT_BODY_MAX_LENGTH}文字以内で入力してください。"
            )
        # (2) 空判定: strip() 後が空（空文字・空白のみ）なら 400。
        if not value.strip():
            raise serializers.ValidationError("本文を入力してください。")
        return value


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


class PagePermissionSerializer(serializers.ModelSerializer):
    """権限エントリの入出力（design 5.3）。camelCase 契約とモデル 2 FK を橋渡しする。

    入力 {path, principalType, principalId, action, effect} を受け、principalType
    に応じて principalId を user/group の片方の FK に落とす（FolderSerializer の
    parentId->parent 流儀）。出力は非 null 側 FK を principalId、principal_type を
    principalType に逆射影する。PATCH は effect のみ書込可（他フィールドは
    partial=True で受理しても無視できるよう read-only にする）。
    """

    principalType = serializers.ChoiceField(
        choices=PagePermission.PRINCIPAL_TYPE_CHOICES, source="principal_type"
    )
    principalId = serializers.SerializerMethodField()
    path = serializers.CharField(max_length=1000)
    action = serializers.ChoiceField(choices=PagePermission.ACTION_CHOICES)
    effect = serializers.ChoiceField(choices=PagePermission.EFFECT_CHOICES)

    class Meta:
        model = PagePermission
        fields = ["id", "path", "principalType", "principalId", "action", "effect"]
        read_only_fields = ["id"]
        # path/principalType/action は作成時のみ指定。PATCH(partial=True)では
        # effect だけ更新し、送られても無視できるよう required=False にする。
        extra_kwargs = {
            "path": {"required": False},
            "action": {"required": False},
        }

    def get_principalId(self, obj):
        # 非 null 側 FK を principalId に逆射影。
        if obj.principal_type == "user":
            return obj.user_id
        return obj.group_id

    def to_internal_value(self, data):
        # principalId は SerializerMethodField（出力専用）なので手動で取り込む。
        validated = super().to_internal_value(data)
        if self.partial:
            # PATCH: effect 以外は無視する（path/principalType/action/principalId）。
            effect = validated.get("effect")
            result = {}
            if effect is not None:
                result["effect"] = effect
            return result
        principal_type = validated.get("principal_type")
        principal_id = data.get("principalId")
        if principal_type == "user":
            if not get_user_model().objects.filter(pk=principal_id).exists():
                raise serializers.ValidationError(
                    {"principalId": ["指定されたユーザーが存在しません。"]}
                )
            validated["user_id"] = principal_id
            validated["group"] = None
        elif principal_type == "group":
            if not Group.objects.filter(pk=principal_id).exists():
                raise serializers.ValidationError(
                    {"principalId": ["指定されたグループが存在しません。"]}
                )
            validated["group_id"] = principal_id
            validated["user"] = None
        return validated
