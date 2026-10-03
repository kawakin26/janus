"""開発確認用の管理サイト登録。"""

from django.contrib import admin

from .models import Asset, Folder, Page


@admin.register(Page)
class PageAdmin(admin.ModelAdmin):
    list_display = ("path", "title", "updated_at", "updated_by")


@admin.register(Folder)
class FolderAdmin(admin.ModelAdmin):
    list_display = ("name", "parent", "updated_at")


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ("filename", "alias", "folder", "content_type", "created_at")
