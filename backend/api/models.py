"""
Janus フェーズ 1 のデータモデル。

design.md 3 章「データモデル（フェーズ 1）」に厳密準拠する。
このタスクのスコープは Page と Attachment の 2 モデルのみ。
Revision / Comment / PagePermission / Group はフェーズ 2 以降で追加する。
"""

from django.conf import settings
from django.db import models


class Page(models.Model):
    """ページ（Markdown 生テキストを保持する最小単位）。"""

    # ページパス（例: /docs/intro）。末尾スラッシュ正規化は API 層（タスク 5）で
    # 行い、本モデルでは一意制約と索引の担保のみを行う（要件 2-7）。
    path = models.CharField(max_length=1000, unique=True, db_index=True)
    # 表示タイトル。省略可（省略時の path 末尾補完は表示側の責務）。
    title = models.CharField(max_length=255, blank=True)
    # Markdown 生テキスト。レンダリングはフロント側で行う。
    body = models.TextField(blank=True)
    # 作成・更新日時は Django に自動管理させる。
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # 作成者 / 最終更新者（要件 4-5）。ユーザー削除時はページ本体を保全するため
    # SET_NULL とする（作成者情報は失うが、ページ資産を優先）。
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
        # 一意なパスを識別子として返す。
        return self.path


class Attachment(models.Model):
    """ページに紐づく添付（アセット）。地図画像・写真などの実体を保持する。"""

    # 添付先ページ。ページ削除時に孤児を残さないため CASCADE とする。
    page = models.ForeignKey(
        Page,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    # アップロード時のファイル名。記法の file= / photo= 照合に使うため索引を付す。
    original_name = models.CharField(max_length=255, db_index=True)
    # 実体ファイル。保存先は settings.MEDIA_ROOT（JANUS_MEDIA_ROOT で切替可能）。
    file = models.FileField(upload_to="attachments/%Y/%m/%d/")
    # MIME タイプ。未判定の場合もあるため blank 許容。
    content_type = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        # アップロード時のファイル名を識別子として返す。
        return self.original_name
