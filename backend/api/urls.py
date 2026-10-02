"""
api アプリの URL 配線。

design.md 5 章の REST エンドポイント表に合わせ、認証系のパスを定義する
（末尾スラッシュ無し）。ページ / アセット API はタスク 5 以降で追加する。
"""

from django.urls import path

from . import views

app_name = "api"

urlpatterns = [
    path("auth/login", views.LoginView.as_view(), name="auth-login"),
    path("auth/logout", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me", views.MeView.as_view(), name="auth-me"),
]
