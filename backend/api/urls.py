"""
api アプリの URL 配線。

design.md 5 章の REST エンドポイント表に合わせ、認証系とページ系のパスを定義する
（末尾スラッシュ無し）。アセット API はタスク 6 以降で追加する。
"""

from django.urls import path

from . import views

app_name = "api"

urlpatterns = [
    path("auth/login", views.LoginView.as_view(), name="auth-login"),
    path("auth/logout", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me", views.MeView.as_view(), name="auth-me"),
    # pages/children を pages より前に置き、ルーティングの意図を明確にする
    # （どちらも完全一致パスだが、より具体的な children を先に記述）。
    path("pages/children", views.PageChildrenView.as_view(), name="pages-children"),
    path("pages", views.PageDetailView.as_view(), name="pages"),
]
