"""
開発確認用の管理サイト登録。

一覧表示を軽く設定するのみに留め、過剰な admin カスタマイズは行わない。
"""

from django.contrib import admin

from .models import Attachment, Page


@admin.register(Page)
class PageAdmin(admin.ModelAdmin):
    # 一覧ではパス・タイトルと更新情報を確認できれば十分。
    list_display = ("path", "title", "updated_at", "updated_by")


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    # 一覧では添付名・所属ページ・MIME・作成日時を確認できれば十分。
    list_display = ("original_name", "page", "content_type", "created_at")
