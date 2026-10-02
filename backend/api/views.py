"""
API ビュー。

このタスク（タスク 4）では design.md 4 章の AuthClient 契約に対応する
認証エンドポイント（login / logout / me）のみを実装する。
ページ / アセット API はタスク 5 以降で追加する。

認証方式はフェーズ 1 の方針どおり DRF TokenAuthentication。認証ロジックを
これらのビュー（AuthClient 契約の実体）の裏に閉じ込めることで、将来の
Cookie セッション + CSRF への移行をフロント非改修で行えるようにする。
"""

from django.db import IntegrityError
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.authtoken.views import ObtainAuthToken
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Page
from .serializers import PageSerializer, PageSummarySerializer, UserSerializer
from .utils import normalize_path


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


# ---------------------------------------------------------------------------
# ページ API（design.md 4 章 PageClient 契約 / 5 章 REST エンドポイント表）
#
# ページ識別子はクエリ文字列（?path= / ?parent=）で渡す（design 5 章の表に忠実。
# REST の /pages/<id>/ 形式には変えない）。パスは末尾スラッシュ無しの既存規約。
#
# 権限方針（design 5 章・要件 4-2）:
#   - 書き込み系（POST/PUT/DELETE）は認証必須＝既定権限（IsAuthenticated）のまま。
#     ビューで permission_classes を上書きしない。
#   - 読み取り系（GET）は JANUS_REQUIRE_AUTH 由来の既定権限に委ねる。AllowAny に
#     上書きしない。
# ---------------------------------------------------------------------------

# 重複パス作成時の 409 用メッセージ（design 9 章・要件 2-7）。
DUPLICATE_PATH_DETAIL = "同一パスのページが既に存在します。"
# 対象ページが存在しないときの 404 用メッセージ。
PAGE_NOT_FOUND_DETAIL = "指定されたパスのページが見つかりません。"


class PageDetailView(APIView):
    """GET/POST/PUT/DELETE /api/pages: ページ 1 件の取得・作成・更新・削除。

    design 5 章の getPage / createPage / updatePage / deletePage に対応する。
    GET/PUT/DELETE はクエリ ?path= で対象を指定し、POST は body の path で作成する。

    注意: ?path= が未指定（空）の GET/PUT/DELETE は、normalize_path("") が "/"
    （ルートページ）を返すため、ルートページを対象として解釈する。空 path を 400
    にはしない（正規化で安全な既定へ畳む方針で一貫させる）。
    """

    def get(self, request, *args, **kwargs):
        # ?path= を正規化して 1 件取得。無ければ 404。
        path = normalize_path(request.query_params.get("path"))
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response(
                {"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND
            )
        return Response(PageSerializer(page).data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        # body { path, title?, body }。path を正規化し重複を 409（400 に化けさせない）。
        path = normalize_path(request.data.get("path"))

        # 保存前に重複判定（design 9 章: パス重複は必ず 409）。serializer の unique
        # バリデータを通すと 400 になるため、serializer より前にここで弾く。
        if Page.objects.filter(path=path).exists():
            return Response(
                {"detail": DUPLICATE_PATH_DETAIL}, status=status.HTTP_409_CONFLICT
            )

        # title / body の検証は serializer に委ねる（path は正規化済みを使う）。
        serializer = PageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        try:
            # created_by / updated_by は現在の認証ユーザー（要件 4-5）。
            page = Page.objects.create(
                path=path,
                title=validated.get("title", ""),
                body=validated.get("body", ""),
                created_by=request.user,
                updated_by=request.user,
            )
        except IntegrityError:
            # 並行作成で exists() 判定をすり抜けた場合も 409 に畳む（二重の安全策）。
            return Response(
                {"detail": DUPLICATE_PATH_DETAIL}, status=status.HTTP_409_CONFLICT
            )
        return Response(
            PageSerializer(page).data, status=status.HTTP_201_CREATED
        )

    def put(self, request, *args, **kwargs):
        # ?path= で対象取得（無ければ 404）。body { title?, body } を適用。
        path = normalize_path(request.query_params.get("path"))
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response(
                {"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND
            )

        # 更新対象は title / body のみ。path は変更しない（識別子）。
        serializer = PageSerializer(page, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        # title 省略時は既存を維持。body は与えられた値で上書き（リビジョンは
        # フェーズ 2 のため記録しない＝body 上書きのみ）。
        if "title" in validated:
            page.title = validated["title"]
        if "body" in validated:
            page.body = validated["body"]
        page.updated_by = request.user
        page.save()
        return Response(PageSerializer(page).data, status=status.HTTP_200_OK)

    def delete(self, request, *args, **kwargs):
        # ?path= で対象取得（無ければ 404）、存在すれば削除して 204。
        path = normalize_path(request.query_params.get("path"))
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response(
                {"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND
            )
        page.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PageChildrenView(APIView):
    """GET /api/pages/children: 指定親パス直下の子ページ一覧（listChildren）。

    design 5 章 listChildren・要件 2-6 に対応する。?parent= で親を指定し、親直下
    の子（親セグメント数 +1 のパス）のみを返す。孫や親自身は含めない。

    parent が空 / ルート（"/"）のときはトップレベル（第 1 階層）の一覧を返す。
    """

    def get(self, request, *args, **kwargs):
        # parent を正規化（?path= と同じ規則）。
        parent = normalize_path(request.query_params.get("parent"))

        # 「直下の子」= 親パス直後にちょうど 1 セグメントだけ付くページ。
        #   - parent が "/"（ルート/空）: トップレベル。prefix は "/"。
        #   - それ以外（例 "/docs"）: prefix は "/docs/"。
        # prefix 一致で候補を絞り、残り部分に "/" を含まないものだけを子とする。
        # 親自身（path == parent）は常に除外する。
        prefix = "/" if parent == "/" else parent + "/"

        children = []
        for page in Page.objects.filter(path__startswith=prefix).order_by("path"):
            # 親自身は除外。
            if page.path == parent:
                continue
            remainder = page.path[len(prefix):]
            # 残りに "/" を含む（＝孫以下）は除外。空（＝親自身の別表現）も除外。
            if remainder and "/" not in remainder:
                children.append(page)

        serializer = PageSummarySerializer(children, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
