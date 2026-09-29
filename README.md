# PhotoDelivery

Сайт-визитка для просмотра фото и видео из публичного бакета rustfs/S3 + админ-панель для загрузки и управления фотосетами. Material You, системная тема (светлая/тёмная), прямые ссылки на сеты. Общего списка сетов на публичном сайте нет: фотосет открывается только по прямой ссылке, и из одного сета через интерфейс нельзя перейти в другой.

## Структура проекта

| Каталог | Что это |
|---|---|
| `front/` | Публичный сайт (Vite + React + TS), читает бакет напрямую и анонимно |
| `admin-panel/` | Админ-панель (Vite + React + TS), работает только через API бэкенда |
| `backend/` | Express API: загрузка, превью, удаление, сессии. В проде отдаёт и оба dist |

## Как это работает

Схема бакета:

```
photos/{setId}/{filename}                      исходный файл (без изменений)
photos/{setId}/thumb/{filename}                превью фото, имя совпадает с оригиналом
photos/{setId}/thumb/{basename}.jpg            превью видео (video.mp4 -> thumb/video.jpg)
```

- **Публичный сайт** читает префикс `photos/{setId}/` анонимно: S3-ключи в браузер не попадают. Ссылка на сет: `https://ваш-домен/#/{setId}`. Роутинг хешевый, сервер о маршрутах ничего не знает.
- **Админ-панель** ходит в API бэкенда с логином/паролем. Бэкенд работает с S3 по access keys, сохраняет оригинал байт-в-байт и тут же генерирует превью (sharp для фото, ffmpeg для видео).
- **Бэкенд** без базы и ORM: файлы и метаданные — сами объекты в бакете, сессия — подписанная cookie, данные для входа — из окружения.

## Быстрый старт

```bash
npm install
cp front/.env.example front/.env
cp backend/.env.example backend/.env
```

Заполните `backend/.env`: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` и `ADMIN_PASSWORD` обязательны — без них сервер не стартует.

```bash
npm run dev   # front :5173, админка :5174, API :8080
```

В dev админка проксирует `/api` на бэкенд; публичный сайт ходит в S3 напрямую по `VITE_S3_ENDPOINT` из `front/.env` (по умолчанию `http://localhost:9000`).

| Переменная `front/.env` | Что это | По умолчанию |
|---|---|---|
| `VITE_S3_ENDPOINT` | URL S3 API rustfs, с портом | `http://localhost:9000` |
| `VITE_S3_BUCKET` | имя бакета | `photos` |
| `VITE_SITE_TITLE` | заголовок сайта, необязательно | `Фото` |

### Переменные `backend/.env`

| Переменная | Что это |
|---|---|
| `PORT` | порт HTTP-сервера, в проде единственный публичный порт |
| `S3_ENDPOINT` | URL S3 API (rustfs/MinIO), forcePathStyle |
| `S3_REGION` | регион, у большинства self-hosted — `us-east-1` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | ключи доступа к бакету |
| `S3_BUCKET` | имя бакета |
| `ADMIN_LOGIN` / `ADMIN_PASSWORD` | единственный пользователь админки |
| `SESSION_SECRET` | секрет подписи сессионной cookie; пусто — детерминированный ключ от логина и пароля |
| `MAX_UPLOAD_MB` | лимит одного файла, МБ, по умолчанию 512 |
| `THUMB_SIZE` / `THUMB_QUALITY` | сторона превью (px) и качество JPEG (1..100) |
| `COOKIE_SECURE` | `true` только за HTTPS |

## Сборка и запуск

```bash
npm run build   # tsc --noEmit + vite build для front и admin-panel, tsc --noEmit для backend
npm start       # бэкенд на :8080 отдаёт API + front (/) + админку (/admin/)
npm test        # vitest во всех воркспейсах
```

Админка в проде живёт под `/admin/` на том же порту, что и API: `https://ваш-домен/admin/`, вход — `ADMIN_LOGIN`/`ADMIN_PASSWORD` из окружения. Сессия — HttpOnly cookie на 7 дней, при пяти неудачных попытках входа адрес блокируется на 15 минут.

### API бэкенда

```
POST   /api/admin/login                     {login, password}
POST   /api/admin/logout
GET    /api/admin/me
GET    /api/admin/sets                      список сетов: id, files, size, lastModified
GET    /api/admin/sets/:id/files            файлы одного сета
POST   /api/admin/uploads                   multipart: setId + files[] (поле files)
DELETE /api/admin/sets/:id                  удалить сет целиком
DELETE /api/admin/sets/:id/files?name=...   удалить один файл вместе с превью

GET    /api/sets/:id/archive                ZIP всех медиафайлов сета, публично
         ?quality=original|compressed       оригиналы или пережатые (фото JPEG q80, видео 720p h264)
         &names=a.jpg,b.mp4                 только перечисленные файлы
GET    /api/sets/:id/file/:name             один файл, публично; quality — как выше
```

## Запуск в Docker

Весь проект поднимается одной командой с единым `.env` в корне репозитория:

```bash
cp .env.example .env    # затем обязательно заполните ADMIN_PASSWORD
docker compose up -d --build
```

Стек: `minio` (S3, порты `S3_PORT`/`S3_CONSOLE_PORT`), `s3-init` (создаёт бакет и политику анонимного чтения, завершается сам), `app` (бэкенд + оба фронтенда, `HOST_PORT`).

- сайт: `http://localhost:8080/`
- админка: `http://localhost:8080/admin/` (вход — `ADMIN_LOGIN`/`ADMIN_PASSWORD`)
- консоль MinIO: `http://localhost:9001` (логин/пароль — S3-ключи)

Полезно: `docker compose logs -f app` — логи бэкенда, `docker compose down` — остановить, `docker compose down -v` — остановить и удалить данные MinIO.

После правки `VITE_*` переменных (`VITE_S3_ENDPOINT`, `VITE_S3_BUCKET`, `VITE_SITE_TITLE`) они попадают в сборку только при пересборке: `docker compose up -d --build`. `VITE_S3_ENDPOINT` — это адрес S3 **из браузера пользователя** (по умолчанию `http://localhost:9000`); поменяли `S3_PORT` — поменяйте и его.

Для внешнего rustfs/MinIO вместо встроенного: задайте `S3_ENDPOINT` (адрес из контейнеров), ключи и бакет в `.env`, при желании уберите сервис `minio` и запускайте только `docker compose up -d --build app` — `s3-init` создаст бакет и политику на внешнем S3.

## Настройка rustfs

### 1. Анонимное чтение бакета

Без этого публичный сайт получит `AccessDenied` на любой запрос. Пример bucket policy в формате AWS:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:ListBucket", "s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::photos",
        "arn:aws:s3:::photos/*"
      ]
    }
  ]
}
```

`ListBucket` нужен на сам бакет (перечисление объектов по префиксу), `GetObject` на объекты (загрузка файлов). Имя бакета в `arn` должно совпадать с `VITE_S3_BUCKET`.

Точный синтаксис зависит от версии rustfs. В консоли rustfs (порт `9001`): раздел Buckets, выбрать бакет, открыть политику (Policy) и вставить JSON там.

### 2. CORS

Браузер блокирует кросс-доменные запросы даже при публичном чтении. Без CORS-правила список файлов не загрузится, а в консоли браузера появится ошибка «blocked by CORS policy» (проверять во вкладке Console и Network).

```json
{
  "CORSRules": [
    {
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedOrigins": [
        "https://ваш-домен",
        "http://localhost:5173"
      ],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["Content-Length", "ETag", "x-amz-request-id"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

`http://localhost:5173` обязателен для локальной разработки, прод-домен обязательно со схемой `https://` и без слэша на конце. После правки правил дождитесь применения, затем обновите страницу (правила CORS кэшируются браузером, см. `MaxAgeSeconds`). Теги `<img>`/`<video>` CORS не требуют — правило нужно для запроса списка файлов.

### 3. Предупреждение о безопасности

Публичный бакет означает, что любой, кто знает endpoint, выгрузит всё через S3 API (`ListBucket`/`GetObject` без авторизации). Отсутствие списка сетов в интерфейсе сайта скрывает ссылки от людей, но не защищает бакет: endpoint и структура префиксов угадываются.

Если нужна приватность: держите rustfs в приватной сети или за VPN, а публичным делайте только сайт. Публичный бакет годится для выдачи контента, который и так можно показывать всем.

## Превью

Превью генерируются автоматически при загрузке через админ-панель:

- фото — sharp, поворот по EXIF, вписывается в `THUMB_SIZE`; для поддерживаемых форматов имя совпадает с оригиналом, иначе `thumb/{basename}.jpg`;
- видео — первый кадр через ffmpeg, `thumb/{basename}.jpg`;
- если превью сделать не удалось, файл всё равно сохраняется (в ответе загрузки появится `thumb: failed`), а сайт покажет оригинал.

Файлы, залитые в бакет мимо админки, превью не имеют — сайт подхватит оригинал или покажет заглушку. Ручная генерация, если нужно:

```bash
cd photos/my-set && mkdir -p thumb
for f in *.jpg *.png; do [ -e "$f" ] && magick "$f" -resize 512x512 "thumb/$f"; done
for f in *.mp4 *.mov *.webm; do [ -e "$f" ] && ffmpeg -y -i "$f" -frames:v 1 -vf scale=512:-1 "thumb/${f%.*}.jpg"; done
```

Для ImageMagick 6 замените `magick` на `convert`.

## Траблшутинг

**«Альбом не найден» / «Фотосет не найден или пуст»**
- Проверьте префикс: файлы должны лежать в `photos/{setId}/`, а не в бакете напрямую.
- Имена сетов чувствительны к регистру, ссылка `#/My-Set` не найдёт `my-set`.
- В сете должны быть файлы с известными расширениями. Изображения: `jpg jpeg png gif webp avif bmp tif tiff heic heif`. Видео: `mp4 webm mov m4v ogv mkv avi`.

**AccessDenied**
- Не назначена политика анонимного чтения, или в `Resource` не тот `arn:aws:s3:::photos`.
- Проверьте `VITE_S3_BUCKET`: имя в policy и в `front/.env` должны совпадать.

**blocked by CORS policy**
- Нет правила CORS или не указан ваш origin. Для dev нужен `http://localhost:5173`, для прода `https://ваш-домен`.
- `AllowedMethods` должен содержать `GET` и `HEAD`.

**Mixed Content**
- Сайт на `https://` не может обращаться к `http://` endpoint: браузер блокирует запрос. Поднимите rustfs за https-прокси или публикуйте сайт по http (только для теста).

**Бэкенд не стартует с «не заданы обязательные переменные окружения»**
- Заполните `backend/.env`: как минимум `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `ADMIN_PASSWORD`.

**«Слишком много попыток» при входе в админку**
- Пять неудачных входов с одного адреса блокируются на 15 минут. Перезапустите бэкенд, если нужно сбросить локально.
