"""
Janus プロジェクトの Django 設定。

Django 5.2 系の 'django-admin startproject' をベースに、design.md 6 章
（DB / 公開範囲の切替）に従って設定値を環境変数化している。
最小構成は「Python 1 プロセス + SQLite 1 ファイル」。

主要な設定ドキュメント:
https://docs.djangoproject.com/en/5.2/ref/settings/
"""

import os
from pathlib import Path

import dj_database_url
from django.core.management.utils import get_random_secret_key

# プロジェクト内のパスは BASE_DIR / "subdir" のように組み立てる。
BASE_DIR = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# 環境変数読み込みヘルパ
# 追加依存を増やさず、標準ライブラリ os.environ で読む（DATABASE_URL のみ
# dj-database-url を利用）。design.md 6 章の設定切替を実現する。
# ---------------------------------------------------------------------------
def env_bool(name: str, default: bool) -> bool:
    """環境変数を真偽値として読む。"1/true/yes/on" を真、"0/false/no/off" を偽とする。"""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: list[str] | None = None) -> list[str]:
    """カンマ区切りの環境変数を、空要素を除いたリストに変換する。"""
    raw = os.environ.get(name)
    if raw is None:
        return list(default) if default is not None else []
    return [item.strip() for item in raw.split(",") if item.strip()]


# ---------------------------------------------------------------------------
# セキュリティ関連
# ---------------------------------------------------------------------------
# SECRET_KEY は環境変数での指定を優先する。未設定時は開発起動を阻害しない
# よう毎回ランダム生成する（本番では必ず環境変数で固定値を与えること。
# 詳細は .env.example を参照）。
SECRET_KEY = os.environ.get("SECRET_KEY") or get_random_secret_key()

# DEBUG は既定 false（安全側）。開発時のみ環境変数で true にする。
DEBUG = env_bool("DEBUG", False)

# ALLOWED_HOSTS は既定空。DEBUG 時のみ localhost を補う。
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS")
if DEBUG and not ALLOWED_HOSTS:
    ALLOWED_HOSTS = ["localhost", "127.0.0.1"]


# ---------------------------------------------------------------------------
# アプリケーション定義
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # サードパーティ
    "rest_framework",
    # DRF の TokenAuthentication 用。authtoken_token テーブルの
    # マイグレーションを同梱するため migrate が必要（makemigrations は不要）。
    "rest_framework.authtoken",
    "corsheaders",
    # Janus 本体
    "api",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # CORS ヘッダは CommonMiddleware より前で処理する必要がある。
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "janus.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "janus.wsgi.application"


# ---------------------------------------------------------------------------
# データベース（design.md 6 章: DATABASE_URL で SQLite / PostgreSQL を切替）
# 未設定時は backend/db.sqlite3 の SQLite 単一ファイルを既定とする。
# ---------------------------------------------------------------------------
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    ),
}


# ---------------------------------------------------------------------------
# パスワードバリデーション
# ---------------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# ---------------------------------------------------------------------------
# 国際化
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True


# ---------------------------------------------------------------------------
# 静的ファイル
# ---------------------------------------------------------------------------
STATIC_URL = "static/"


# ---------------------------------------------------------------------------
# メディア（アセット保存先。design.md 6 章: JANUS_MEDIA_ROOT で切替）
# 未設定時は backend/media/ を既定とする。
# ---------------------------------------------------------------------------
MEDIA_URL = "/media/"
MEDIA_ROOT = os.environ.get("JANUS_MEDIA_ROOT") or str(BASE_DIR / "media")


# ---------------------------------------------------------------------------
# CORS（design.md 6 章: JANUS_CORS_ALLOWED_ORIGINS をカンマ区切りで指定）
# 未設定時は許可オリジン空（＝許可なし、安全側）。
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env_list("JANUS_CORS_ALLOWED_ORIGINS")


# ---------------------------------------------------------------------------
# Janus 固有の設定フラグ
# JANUS_REQUIRE_AUTH は全体を認証必須にするかの意図を表す（既定 true）。
# フェーズ 1 のこのタスクでは settings 変数として公開するのみで、DRF の
# 既定権限への反映は認証実装（タスク 4）で行う。
# ---------------------------------------------------------------------------
JANUS_REQUIRE_AUTH = env_bool("JANUS_REQUIRE_AUTH", True)


# ---------------------------------------------------------------------------
# Django REST Framework（design.md 5 章「認証方式（要件4）とセキュリティ移行方針」）
#
# 認証方式: フェーズ 1 は DRF の TokenAuthentication 一本とする。
#   ログインで token を発行し、以降 `Authorization: Token <...>` ヘッダで送る。
#   将来の Cookie セッション + CSRF への移行は、認証ロジックを AuthClient 契約
#   （エンドポイント）の裏に閉じ込めることで吸収する想定。
#
# SessionAuthentication は「あえて追加しない」。理由:
#   - design が「Cookie セッションより CORS が単純」として Token を初期採用と明言。
#   - フロントは未実装（タスク 7 以降）で、CSRF を伴う Cookie フローのテスト相手が無い。
#   - SessionAuthentication を足すと Django admin のブラウザセッションで API の
#     認証判定が変わり、テストが複雑化する。admin は Django 標準のセッション
#     ログイン（DRF 非経由）を使うため、ここに入れなくても影響しない。
#
# 既定権限: JANUS_REQUIRE_AUTH が True なら全 API を認証必須（IsAuthenticated）、
#   False なら AllowAny（公開）に切り替える（要件 4-2）。login と me は
#   ビュー側で permission_classes=[AllowAny] を明示して例外化する。
# ---------------------------------------------------------------------------
def default_permission_classes(require_auth: bool) -> list[str]:
    """既定権限クラスを JANUS_REQUIRE_AUTH の値から決める。

    True なら認証必須（IsAuthenticated）、False なら公開（AllowAny）。
    テストから分岐ロジックそのものを検証できるよう関数に切り出している。
    """
    if require_auth:
        return ["rest_framework.permissions.IsAuthenticated"]
    return ["rest_framework.permissions.AllowAny"]


REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": default_permission_classes(JANUS_REQUIRE_AUTH),
}


# ---------------------------------------------------------------------------
# 既定の主キー型
# ---------------------------------------------------------------------------
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
