"""API ビュー（認証・ページ・独立アセットライブラリ）。"""

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

from .models import Asset, Folder, Page
from .serializers import (
    AssetSerializer,
    FolderSerializer,
    PageSerializer,
    PageSummarySerializer,
    UserSerializer,
)
from .utils import normalize_path


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


class PageDetailView(APIView):
    def get(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        return Response(PageSerializer(page).data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        path = normalize_path(request.data.get("path"))
        if Page.objects.filter(path=path).exists():
            return Response({"detail": DUPLICATE_PATH_DETAIL}, status=status.HTTP_409_CONFLICT)
        serializer = PageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        try:
            page = Page.objects.create(
                path=path,
                title=validated.get("title", ""),
                body=validated.get("body", ""),
                created_by=request.user,
                updated_by=request.user,
            )
        except IntegrityError:
            return Response({"detail": DUPLICATE_PATH_DETAIL}, status=status.HTTP_409_CONFLICT)
        return Response(PageSerializer(page).data, status=status.HTTP_201_CREATED)

    def put(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
        page = Page.objects.filter(path=path).first()
        if page is None:
            return Response({"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND)
        serializer = PageSerializer(page, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        if "title" in validated:
            page.title = validated["title"]
        if "body" in validated:
            page.body = validated["body"]
        page.updated_by = request.user
        page.save()
        return Response(PageSerializer(page).data, status=status.HTTP_200_OK)

    def delete(self, request, *args, **kwargs):
        path = normalize_path(request.query_params.get("path"))
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
        return Response(PageSummarySerializer(children, many=True).data, status=status.HTTP_200_OK)


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
