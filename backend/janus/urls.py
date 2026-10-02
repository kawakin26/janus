"""
URL configuration for janus project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    # /api/ 配下は api アプリに委譲する（認証エンドポイント等）。
    path('api/', include('api.urls')),
]

# DEBUG 時のみ MEDIA_URL 直下を素の静的配信する（開発補助）。
# これは listAssets が返す file の URL（/media/...）をブラウザで直接確認するための
# もので権限制御は無い。権限制御付きの実体配信は /api/assets/<id>（AssetDetailView）
# が別口で担い、本番のメディア配信は Web サーバー（nginx 等）に委ねる。役割は別。
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
