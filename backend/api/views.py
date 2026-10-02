"""
API ビュー。

このタスク（タスク 4）では design.md 4 章の AuthClient 契約に対応する
認証エンドポイント（login / logout / me）のみを実装する。
ページ / アセット API はタスク 5 以降で追加する。

認証方式はフェーズ 1 の方針どおり DRF TokenAuthentication。認証ロジックを
これらのビュー（AuthClient 契約の実体）の裏に閉じ込めることで、将来の
Cookie セッション + CSRF への移行をフロント非改修で行えるようにする。
"""

from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.authtoken.views import ObtainAuthToken
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import UserSerializer


class LoginView(ObtainAuthToken):
    """POST /api/auth/login: username/password で認証し token と user を返す。

    DRF 標準の ObtainAuthToken をサブクラス化し、token に加えて user 表現を返す。
    ログイン自体は未認証から呼ぶため AllowAny（既定の認証必須を上書き）。
    認証失敗時は親 serializer の ValidationError（400・DRF 標準エラー形式）に委ねる。
    パスワード照合は Django の authenticate()（ハッシュ機構）に委ねる（要件 4-3）。
    """

    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        # 親の serializer が username/password を検証する（失敗は 400）。
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        # ユーザーごとに 1 つの token を発行（既存があれば再利用）。
        token, _created = Token.objects.get_or_create(user=user)
        return Response(
            {"token": token.key, "user": UserSerializer(user).data},
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    """POST /api/auth/logout: 現在のユーザーの token を無効化する。

    認証必須（既定権限 IsAuthenticated のまま）。token を削除することで
    以降その token は使えなくなる。再ログインで新しい token が発行される。
    """

    def post(self, request, *args, **kwargs):
        # TokenAuthentication 経由なら request.user.auth_token が存在する。
        token = Token.objects.filter(user=request.user).first()
        if token is not None:
            token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """GET /api/auth/me: 現在のユーザー表現を返す（未認証は null）。

    design 5 章「未認証は null」に従い、未認証でも 200 を返し本文は JSON null。
    そのため AllowAny（既定の認証必須を上書き）。認証済みなら user オブジェクト。
    """

    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return Response(UserSerializer(request.user).data, status=status.HTTP_200_OK)
        # 未認証は HTTP 200 + JSON null。
        return Response(None, status=status.HTTP_200_OK)
