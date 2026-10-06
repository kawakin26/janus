"""API ビュー（認証・ページ・独立アセットライブラリ）。"""

import difflib
import os

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import FileResponse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.authtoken.views import ObtainAuthToken
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Asset, Comment, Folder, Page, PagePermission, Revision
from .permissions import (
    PERMISSION_DENIED_DETAIL,
    PERMISSION_ENTRY_NOT_FOUND_DETAIL,
    can_modify_comment,
    compute_view_edit,
    require_edit_permission_strict,
    require_page_permission,
)
from .serializers import (
    AssetSerializer,
    CommentSerializer,
    FolderSerializer,
    PagePermissionSerializer,
    PageSerializer,
    PageSummarySerializer,
    PageTreeNodeSerializer,
    RevisionSerializer,
    RevisionSummarySerializer,
    UserSerializer,
)
from .services import PathConflictError, save_page_body
from .utils import ancestor_paths, normalize_path


class LoginView(ObtainAuthToken):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, _created = Token.objects.get_or_create(user=user)
        return Response(
            {"token": token.key, "user": UserSerializer(user).data},
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    def post(self, request, *args, **kwargs):
        token = Token.objects.filter(user=request.user).first()
        if token is not None:
            token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return Response(UserSerializer(request.user).data, status=status.HTTP_200_OK)
        return Response(None, status=status.HTTP_200_OK)


DUPLICATE_PATH_DETAIL = "同一パスのページが既に存在します。"
PAGE_NOT_FOUND_DETAIL = "指定されたパスのページが見つかりません。"
DUPLICATE_PERMISSION_DETAIL = "同一の権限エントリが既に存在します。"


class PageDetailView(APIView):
    def get(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        # 権限 → 存在の順（design 5.2）。view 拒否は実在を参照せず 403/404。
        denied = require_page_permission(request, path, "view")
        if denied is not None:
            return denied
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        return Response(PageSerializer(page).data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        path = normalize_path(request.data.get("path"))
        # 作成予定 path をそのまま対象に edit 判定（design 3「POST での対象 path」）。
        # POST の edit 拒否は秘匿設定に関わらず常に 403（MEDIUM-C）。
        denied = require_edit_permission_strict(request, path)
        if denied is not None:
            return denied
        if Page.objects.filter(path=path).exists():
            return Response({"detail": DUPLICATE_PATH_DETAIL}, status=status.HTTP_409_CONFLICT)
        serializer = PageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        try:
            page, _created = save_page_body(
                path,
                title=validated.get("title", ""),
                body=validated.get("body", ""),
                author=request.user,
            )
        except (PathConflictError, IntegrityError):
            return Response({"detail": DUPLICATE_PATH_DETAIL}, status=status.HTTP_409_CONFLICT)
        return Response(PageSerializer(page).data, status=status.HTTP_201_CREATED)

    def put(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        # 権限 → 存在の順（design 5.2）。edit 拒否は 403（既定）／404（秘匿）。
        denied = require_page_permission(request, path, "edit")
        if denied is not None:
            return denied
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        serializer = PageSerializer(page, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        # 未指定フィールドは既存値を渡し、部分更新 + 本文/タイトル不変抑制を両立する。
        title = validated["title"] if "title" in validated else page.title
        body = validated["body"] if "body" in validated else page.body
        page, _created = save_page_body(
            page, title=title, body=body, author=request.user
        )
        return Response(PageSerializer(page).data, status=status.HTTP_200_OK)

    def delete(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        # 権限 → 存在の順（design 5.2）。edit 拒否は 403（既定）／404（秘匿）。
        denied = require_page_permission(request, path, "edit")
        if denied is not None:
            return denied
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        page.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PageChildrenView(APIView):
    def get(self, request, *args, **kwargs):
        parent = normalize_path(request.query_params.get("parent"))
        prefix = "/" if parent == "/" else parent + "/"
        children = []
        for page in Page.objects.filter(path__startswith=prefix).order_by("path"):
            if page.path == parent:
                continue
            remainder = page.path[len(prefix):]
            if remainder and "/" not in remainder:
                children.append(page)
        # parent 自身の存在・可視性は確認せず常に 200。view 判定を各子にのみ適用し、
        # 許可された子のみ返す（design 5.2）。非実在 parent と可視子ゼロは同じ []。
        visible = [
            page
            for page in children
            if require_page_permission(request, page.path, "view") is None
        ]
        return Response(PageSummarySerializer(visible, many=True).data, status=status.HTTP_200_OK)


class PageTreeView(APIView):
    """サブツリー一括取得（design 2.4）。root 配下の全階層をネスト JSON で返す。

    PageChildrenView の「直下 1 階層」ロジックを全階層へ一般化する。純粋な文字列
    処理（normalize_path/ancestor_paths 流儀）＋クエリ 1 回でツリーを組み、各ノード
    に require_page_permission(view) を適用して枝刈りする。固定 detail は新設せず
    常に 200 を返す（children と同一契約）。depth クエリは受理しても無視（予約）。
    """

    def get(self, request, *args, **kwargs):
        # 1. root 正規化（既定 "/"）。不正値は normalize_path が安全な正規値へ畳む。
        root = normalize_path(request.query_params.get("root"))
        # 2. prefix（PageChildrenView と同一式）。
        prefix = "/" if root == "/" else root + "/"
        # 3. 配下の実ページを 1 回だけ取得（path 昇順）。root 自身はトップに含めない。
        pages = list(Page.objects.filter(path__startswith=prefix).order_by("path"))
        real_titles = {page.path: page.title for page in pages}

        # 4-5. path キー dict でノード生成（中間＝仮想ノード含む）＋親子接続。
        nodes = {}  # path -> {"path","title","hasPage","children": {child_path: node}}
        roots = {}  # 親を持たない（root 直下）ノード。

        def ensure(node_path):
            if node_path not in nodes:
                has_page = node_path in real_titles
                title = (
                    real_titles[node_path]
                    if has_page
                    else node_path.rsplit("/", 1)[-1]
                )
                nodes[node_path] = {
                    "path": node_path,
                    "title": title,
                    "hasPage": has_page,
                    "children": {},
                }
            return nodes[node_path]

        for page in pages:
            # root より深い祖先パス（自身含む）を "浅い→深い" 順に並べて親子を接続。
            chain = [
                ancestor
                for ancestor in ancestor_paths(page.path)
                if ancestor != root and ancestor.startswith(prefix)
            ]
            chain = list(reversed(chain))  # 近い順(深い→浅い) → 浅い→深い。
            parent_path = None
            for node_path in chain:
                node = ensure(node_path)
                if parent_path is None:
                    roots[node_path] = node
                else:
                    nodes[parent_path]["children"][node_path] = node
                parent_path = node_path

        # 6. 権限枝刈り（design 2.5）: ルート側から下り、view 不可ノードで部分木を破棄。
        def prune_perms(node):
            if require_page_permission(request, node["path"], "view") is not None:
                return None  # この部分木ごと破棄（祖先継承）。
            kept = {}
            for child_path, child in node["children"].items():
                survived = prune_perms(child)
                if survived is not None:
                    kept[child_path] = survived
            node["children"] = kept
            return node

        roots = {
            path: node
            for path, node in roots.items()
            if prune_perms(node) is not None
        }

        # 7.5. ボトムアップの空仮想ノード剪定（design 2.4 手順 7.5／2.5）。
        #   hasPage=False かつ children 空 のノードを親から外し上位へ伝播。
        #   実ページ葉（hasPage=True かつ children 空）は残す。純粋な木操作。
        def prune_empty(node):
            kept = {}
            for child_path, child in node["children"].items():
                survived = prune_empty(child)
                if survived is not None:
                    kept[child_path] = survived
            node["children"] = kept
            if node["hasPage"] is False and len(node["children"]) == 0:
                return None  # 空仮想ノードは除去。
            return node

        roots = {
            path: node
            for path, node in roots.items()
            if prune_empty(node) is not None
        }

        # 7 + 7.5 後処理. children をパス昇順の配列化 ＆ hasChildren を確定（len>0）。
        def finalize(node):
            child_list = [
                finalize(node["children"][child_path])
                for child_path in sorted(node["children"].keys())
            ]
            return {
                "path": node["path"],
                "title": node["title"],
                "hasPage": node["hasPage"],
                "hasChildren": len(child_list) > 0,
                "children": child_list,
            }

        root_list = [finalize(roots[path]) for path in sorted(roots.keys())]

        # 8. シリアライズして 200。可視 0 件・非実在 root は 200 + []。
        return Response(
            PageTreeNodeSerializer(root_list, many=True).data,
            status=status.HTTP_200_OK,
        )


class PagePermissionView(APIView):
    """権限エントリの一覧取得・新規作成（design 5.3）。管理 API 自体は edit 権限者/管理者のみ。"""

    def get(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        # 認可を一覧取得より先に（第三者に任意 path のエントリ有無を観測させない）。
        denied = require_page_permission(request, path, "edit")
        if denied is not None:
            return denied
        entries = PagePermission.objects.filter(path=path)
        return Response(
            PagePermissionSerializer(entries, many=True).data,
            status=status.HTTP_200_OK,
        )

    def post(self, request, *args, **kwargs):
        path = normalize_path(request.data.get("path"))
        denied = require_page_permission(request, path, "edit")
        if denied is not None:
            return denied
        # 正規化済み path を注入して検証・作成する。
        payload = {key: request.data.get(key) for key in request.data}
        payload["path"] = path
        serializer = PagePermissionSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                entry = serializer.save()
        except IntegrityError:
            return Response(
                {"detail": DUPLICATE_PERMISSION_DETAIL}, status=status.HTTP_409_CONFLICT
            )
        return Response(
            PagePermissionSerializer(entry).data, status=status.HTTP_201_CREATED
        )


class PagePermissionDetailView(APIView):
    """権限エントリの effect 更新・削除（design 5.3 MEDIUM-2）。"""

    def _get_entry(self, pk):
        return PagePermission.objects.filter(pk=pk).first()

    def patch(self, request, pk, *args, **kwargs):
        # ①エントリ取得（無ければ 404）②entry.path の edit 判定 ③effect のみ更新。
        entry = self._get_entry(pk)
        if entry is None:
            return Response(
                {"detail": PERMISSION_ENTRY_NOT_FOUND_DETAIL},
                status=status.HTTP_404_NOT_FOUND,
            )
        denied = require_page_permission(request, entry.path, "edit")
        if denied is not None:
            return denied
        serializer = PagePermissionSerializer(entry, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            PagePermissionSerializer(entry).data, status=status.HTTP_200_OK
        )

    def delete(self, request, pk, *args, **kwargs):
        entry = self._get_entry(pk)
        if entry is None:
            return Response(
                {"detail": PERMISSION_ENTRY_NOT_FOUND_DETAIL},
                status=status.HTTP_404_NOT_FOUND,
            )
        denied = require_page_permission(request, entry.path, "edit")
        if denied is not None:
            return denied
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PageEffectivePermissionView(APIView):
    """現在ユーザーの path に対する {view, edit} を返す（design 5.4）。

    未認証は既定 IsAuthenticated が 401 を担保。認証済みは任意 path 可で、権限
    不足でも 403/404 を返さず常に 200+{view,edit}（秘匿運用でも {false,false}）。
    """

    def get(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        return Response(compute_view_edit(request, path), status=status.HTTP_200_OK)


REVISION_NOT_FOUND_DETAIL = "指定されたリビジョンが見つかりません。"
REVISION_LIMIT_DEFAULT = 50
REVISION_LIMIT_MAX = 200


def _revision_limit(value):
    """limit を既定 50・上限 200 でクランプ。不正値は既定へフォールバック（design 9.1）。"""
    try:
        limit = int(value)
    except (TypeError, ValueError):
        return REVISION_LIMIT_DEFAULT
    if limit < 1:
        return REVISION_LIMIT_DEFAULT
    return min(limit, REVISION_LIMIT_MAX)


def _revision_offset(value):
    """offset を既定 0。不正値・負値は 0 へフォールバック（design 9.1）。"""
    try:
        offset = int(value)
    except (TypeError, ValueError):
        return 0
    return offset if offset >= 0 else 0


def _revision_number(value):
    """number の整数化。非整数は None（呼び出し側で 404 に落とす・design 5.5）。"""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class RevisionListView(APIView):
    """ページ履歴一覧（新しい順・ページング・軽量メタ、design 5.5）。view 権限。"""

    def get(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        # 権限 → 存在の順（design 5.5）。view 拒否は実在を参照せず 403/404。
        denied = require_page_permission(request, path, "view")
        if denied is not None:
            return denied
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        limit = _revision_limit(request.query_params.get("limit"))
        offset = _revision_offset(request.query_params.get("offset"))
        revisions = page.revisions.order_by("-number")[offset:offset + limit]
        return Response(
            RevisionSummarySerializer(revisions, many=True).data,
            status=status.HTTP_200_OK,
        )


class RevisionDetailView(APIView):
    """リビジョン 1 件の本文取得（design 5.5）。view 権限。指定子は number。"""

    def get(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        denied = require_page_permission(request, path, "view")
        if denied is not None:
            return denied
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        number = _revision_number(request.query_params.get("number"))
        revision = (
            Revision.objects.filter(page=page, number=number).first()
            if number is not None
            else None
        )
        if revision is None:
            return Response(
                {"detail": REVISION_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND
            )
        return Response(RevisionSerializer(revision).data, status=status.HTTP_200_OK)


class RevisionDiffView(APIView):
    """2 リビジョンの行単位差分（design 5.5）。view 権限。指定子は number。"""

    def get(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        denied = require_page_permission(request, path, "view")
        if denied is not None:
            return denied
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        # from は Python 予約語のため query_params.get("from") で取得し from_num に束縛。
        from_num = _revision_number(request.query_params.get("from"))
        to_num = _revision_number(request.query_params.get("to"))
        from_rev = (
            Revision.objects.filter(page=page, number=from_num).first()
            if from_num is not None
            else None
        )
        to_rev = (
            Revision.objects.filter(page=page, number=to_num).first()
            if to_num is not None
            else None
        )
        if from_rev is None or to_rev is None:
            return Response(
                {"detail": REVISION_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND
            )
        diff = _diff_lines(from_rev.body, to_rev.body)
        return Response(diff, status=status.HTTP_200_OK)


def _diff_lines(a_body, b_body):
    """行単位差分を [{op, line}] に展開（design 5.5）。replace は del 群+add 群に分解。"""
    a_lines = a_body.splitlines()
    b_lines = b_body.splitlines()
    result = []
    matcher = difflib.SequenceMatcher(None, a_lines, b_lines)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for line in a_lines[i1:i2]:
                result.append({"op": "equal", "line": line})
        elif tag == "delete":
            for line in a_lines[i1:i2]:
                result.append({"op": "del", "line": line})
        elif tag == "insert":
            for line in b_lines[j1:j2]:
                result.append({"op": "add", "line": line})
        elif tag == "replace":
            # replace は削除行群（del）→追加行群（add）に分解（op:"change" は使わない）。
            for line in a_lines[i1:i2]:
                result.append({"op": "del", "line": line})
            for line in b_lines[j1:j2]:
                result.append({"op": "add", "line": line})
    return result


class RevisionRestoreView(APIView):
    """指定リビジョンへ復元（新リビジョン化、design 5.5）。edit 権限。"""

    def post(self, request, *args, **kwargs):
        path = normalize_path(request.data.get("path"))
        # restore の判定順序（design 5.5）: (1) Page 取得・不在 404 →
        # (2) edit 権限（403/404）→ (3) number 存在（404）→ (4) save_page_body。
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        denied = require_page_permission(request, path, "edit")
        if denied is not None:
            return denied
        number = _revision_number(request.data.get("number"))
        revision = (
            Revision.objects.filter(page=page, number=number).first()
            if number is not None
            else None
        )
        if revision is None:
            return Response(
                {"detail": REVISION_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND
            )
        page, _created = save_page_body(
            page, title=revision.title, body=revision.body, author=request.user
        )
        return Response(PageSerializer(page).data, status=status.HTTP_200_OK)


COMMENT_NOT_FOUND_DETAIL = "指定されたコメントが見つかりません。"


class CommentListCreateView(APIView):
    """コメント一覧取得・投稿（design 3.1）。いずれもページ view 権限。"""

    def get(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        # 権限 → 存在の順（design 3.1 / 5.2）。view 拒否は実在を参照せず 403/404。
        denied = require_page_permission(request, path, "view")
        if denied is not None:
            return denied
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        # 全件・作成日時昇順（Meta.ordering=["created_at", "id"]、ページングは将来課題）。
        comments = page.comments.all()
        return Response(
            CommentSerializer(comments, many=True).data,
            status=status.HTTP_200_OK,
        )

    def post(self, request, *args, **kwargs):
        path = normalize_path(request.data.get("path"))
        denied = require_page_permission(request, path, "view")
        if denied is not None:
            return denied
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # author=request.user を注入して作成（body 以外は read-only）。
        comment = serializer.save(page=page, author=request.user)
        return Response(
            CommentSerializer(comment).data, status=status.HTTP_201_CREATED
        )


class CommentDetailView(APIView):
    """コメント本文編集・削除（design 3.1 / 3.2）。拒否は常に固定 403。"""

    def _get_comment(self, pk):
        return Comment.objects.filter(pk=pk).first()

    def patch(self, request, pk, *args, **kwargs):
        # ①コメント取得（無ければ 404）②編集権限判定（can_modify_comment）
        # ③body のみ更新。require_page_permission は使わず拒否は固定 403（design 3.2）。
        comment = self._get_comment(pk)
        if comment is None:
            return Response(
                {"detail": COMMENT_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND
            )
        if not can_modify_comment(request, comment):
            return Response(
                {"detail": PERMISSION_DENIED_DETAIL}, status=status.HTTP_403_FORBIDDEN
            )
        serializer = CommentSerializer(
            comment, data={"body": request.data.get("body")}, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(CommentSerializer(comment).data, status=status.HTTP_200_OK)

    def delete(self, request, pk, *args, **kwargs):
        comment = self._get_comment(pk)
        if comment is None:
            return Response(
                {"detail": COMMENT_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND
            )
        if not can_modify_comment(request, comment):
            return Response(
                {"detail": PERMISSION_DENIED_DETAIL}, status=status.HTTP_403_FORBIDDEN
            )
        comment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


ASSET_NOT_FOUND_DETAIL = "指定されたアセットが見つかりません。"
FOLDER_NOT_FOUND_DETAIL = "指定されたフォルダが見つかりません。"
DUPLICATE_FOLDER_DETAIL = "同一階層に同名のフォルダが既に存在します。"
DUPLICATE_ASSET_DETAIL = "同一フォルダ内に同名のファイルまたは別名が既に存在します。"
ASSET_FILE_REQUIRED_DETAIL = "ファイル(file)が指定されていません。"


def _folder_id(value):
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return -1


def _folder_or_none(folder_id):
    if folder_id is None:
        return None
    return Folder.objects.filter(pk=folder_id).first()


def _safe_filename(name):
    base_name = os.path.basename(name or "")
    return "".join(ch for ch in base_name if ch >= " " and ch != "\x7f")[:255]


class FolderListCreateView(APIView):
    def get(self, request, *args, **kwargs):
        folder_id = _folder_id(request.query_params.get("parent"))
        parent = _folder_or_none(folder_id)
        if folder_id == -1 or (folder_id is not None and parent is None):
            return Response({"detail": FOLDER_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        folders = Folder.objects.filter(parent=parent).order_by("name")
        return Response(FolderSerializer(folders, many=True).data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        serializer = FolderSerializer(data={"name": request.data.get("name")})
        serializer.is_valid(raise_exception=True)
        parent_id = _folder_id(request.data.get("parentId"))
        parent = _folder_or_none(parent_id)
        if parent_id == -1 or (parent_id is not None and parent is None):
            return Response({"detail": FOLDER_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        if Folder.objects.filter(parent=parent, name=serializer.validated_data["name"]).exists():
            return Response({"detail": DUPLICATE_FOLDER_DETAIL}, status=status.HTTP_409_CONFLICT)
        try:
            with transaction.atomic():
                folder = Folder.objects.create(parent=parent, **serializer.validated_data)
        except IntegrityError:
            return Response({"detail": DUPLICATE_FOLDER_DETAIL}, status=status.HTTP_409_CONFLICT)
        return Response(FolderSerializer(folder).data, status=status.HTTP_201_CREATED)


class AssetListCreateView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def _folder(self, request):
        folder_id = _folder_id(request.query_params.get("folder"))
        folder = _folder_or_none(folder_id)
        if folder_id == -1 or (folder_id is not None and folder is None):
            return False, None
        return True, folder

    def get(self, request, *args, **kwargs):
        valid, folder = self._folder(request)
        if not valid:
            return Response({"detail": FOLDER_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        assets = Asset.objects.filter(folder=folder).order_by("created_at")
        return Response(
            AssetSerializer(assets, many=True, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def post(self, request, *args, **kwargs):
        valid, folder = self._folder(request)
        if not valid:
            return Response({"detail": FOLDER_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        uploaded = request.FILES.get("file")
        if uploaded is None:
            return Response({"detail": ASSET_FILE_REQUIRED_DETAIL}, status=status.HTTP_400_BAD_REQUEST)
        filename = _safe_filename(uploaded.name)
        if not filename:
            return Response({"detail": ASSET_FILE_REQUIRED_DETAIL}, status=status.HTTP_400_BAD_REQUEST)
        alias = request.data.get("alias", "") or ""
        if not isinstance(alias, str):
            return Response({"alias": ["有効な文字列を指定してください。"]}, status=status.HTTP_400_BAD_REQUEST)
        alias = "".join(ch for ch in alias if ch >= " " and ch != "\x7f")[:255]
        if Asset.objects.filter(folder=folder).filter(
            Q(filename=filename) | (Q(alias=alias) if alias else Q(pk__isnull=True))
        ).exists():
            return Response({"detail": DUPLICATE_ASSET_DETAIL}, status=status.HTTP_409_CONFLICT)
        asset = Asset(
            folder=folder,
            filename=filename,
            alias=alias,
            file=uploaded,
            content_type=getattr(uploaded, "content_type", "") or "",
        )
        try:
            with transaction.atomic():
                asset.save()
        except IntegrityError:
            # FileFieldはDB INSERTより先に物理ファイルを保存するため、
            # 競合でロールバックした場合も孤児ファイルを残さない。
            if asset.file.name:
                asset.file.delete(save=False)
            return Response({"detail": DUPLICATE_ASSET_DETAIL}, status=status.HTTP_409_CONFLICT)
        return Response(
            AssetSerializer(asset, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class AssetMoveView(APIView):
    def patch(self, request, pk, *args, **kwargs):
        asset = Asset.objects.filter(pk=pk).first()
        if asset is None:
            return Response({"detail": ASSET_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        if "folderId" not in request.data:
            return Response({"folderId": ["このフィールドは必須です。"]}, status=status.HTTP_400_BAD_REQUEST)
        folder_id = _folder_id(request.data.get("folderId"))
        folder = _folder_or_none(folder_id)
        if folder_id == -1 or (folder_id is not None and folder is None):
            return Response({"detail": FOLDER_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        if Asset.objects.filter(folder=folder).exclude(pk=asset.pk).filter(
            Q(filename=asset.filename) | (Q(alias=asset.alias) if asset.alias else Q(pk__isnull=True))
        ).exists():
            return Response({"detail": DUPLICATE_ASSET_DETAIL}, status=status.HTTP_409_CONFLICT)
        try:
            with transaction.atomic():
                asset.folder = folder
                asset.save(update_fields=["folder", "updated_at"])
        except IntegrityError:
            return Response({"detail": DUPLICATE_ASSET_DETAIL}, status=status.HTTP_409_CONFLICT)
        return Response(
            AssetSerializer(asset, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class AssetFileView(APIView):
    def get(self, request, pk, *args, **kwargs):
        asset = Asset.objects.filter(pk=pk).first()
        if asset is None or not asset.file:
            return Response({"detail": ASSET_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        return FileResponse(
            asset.file.open("rb"),
            content_type=asset.content_type or "application/octet-stream",
        )
