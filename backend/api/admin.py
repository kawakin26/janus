"""開発確認用の管理サイト登録。"""

from django.contrib import admin

from .models import Asset, Comment, Folder, Page, PagePermission, Revision


@admin.register(Page)
class PageAdmin(admin.ModelAdmin):
    list_display = ("path", "title", "updated_at", "updated_by")


@admin.register(Folder)
class FolderAdmin(admin.ModelAdmin):
    list_display = ("name", "parent", "updated_at")


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ("filename", "alias", "folder", "content_type", "created_at")


@admin.register(PagePermission)
class PagePermissionAdmin(admin.ModelAdmin):
    list_display = ("path", "principal_type", "user", "group", "action", "effect")


@admin.register(Revision)
class RevisionAdmin(admin.ModelAdmin):
    list_display = ("page", "number", "created_at", "author")


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("page", "author", "created_at", "updated_at")
