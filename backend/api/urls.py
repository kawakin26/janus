"""apiアプリのURL配線。"""

from django.urls import path

from . import views

app_name = "api"

urlpatterns = [
    path("auth/login", views.LoginView.as_view(), name="auth-login"),
    path("auth/logout", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me", views.MeView.as_view(), name="auth-me"),
    path("pages/children", views.PageChildrenView.as_view(), name="pages-children"),
    path("pages", views.PageDetailView.as_view(), name="pages"),
    path("folders", views.FolderListCreateView.as_view(), name="folders"),
    path("assets", views.AssetListCreateView.as_view(), name="assets"),
    path("assets/<int:pk>", views.AssetMoveView.as_view(), name="assets-detail"),
    path("assets/<int:pk>/file", views.AssetFileView.as_view(), name="assets-file"),
]
