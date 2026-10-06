"""apiアプリのURL配線。"""

from django.urls import path

from . import views

app_name = "api"

urlpatterns = [
    path("auth/login", views.LoginView.as_view(), name="auth-login"),
    path("auth/logout", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me", views.MeView.as_view(), name="auth-me"),
    path("pages/children", views.PageChildrenView.as_view(), name="pages-children"),
    path("pages/tree", views.PageTreeView.as_view(), name="pages-tree"),
    path(
        "pages/permissions/<int:pk>",
        views.PagePermissionDetailView.as_view(),
        name="pages-permissions-detail",
    ),
    path(
        "pages/permissions",
        views.PagePermissionView.as_view(),
        name="pages-permissions",
    ),
    path(
        "pages/effective-permission",
        views.PageEffectivePermissionView.as_view(),
        name="pages-effective-permission",
    ),
    path(
        "pages/revisions/detail",
        views.RevisionDetailView.as_view(),
        name="pages-revisions-detail",
    ),
    path(
        "pages/revisions/diff",
        views.RevisionDiffView.as_view(),
        name="pages-revisions-diff",
    ),
    path(
        "pages/revisions/restore",
        views.RevisionRestoreView.as_view(),
        name="pages-revisions-restore",
    ),
    path(
        "pages/revisions",
        views.RevisionListView.as_view(),
        name="pages-revisions",
    ),
    path(
        "pages/comments/<int:pk>",
        views.CommentDetailView.as_view(),
        name="pages-comments-detail",
    ),
    path(
        "pages/comments",
        views.CommentListCreateView.as_view(),
        name="pages-comments",
    ),
    path("pages", views.PageDetailView.as_view(), name="pages"),
    path("folders", views.FolderListCreateView.as_view(), name="folders"),
    path("assets", views.AssetListCreateView.as_view(), name="assets"),
    path("assets/<int:pk>", views.AssetMoveView.as_view(), name="assets-detail"),
    path("assets/<int:pk>/file", views.AssetFileView.as_view(), name="assets-file"),
]
