# WTCHP — Video Streaming Platform

Cloudflare'in edge altyapısı üzerinde çalışan, modern ve yüksek performanslı video izleme platformu.

**Stack:** Cloudflare Workers (Hono) · D1 (SQLite) · R2 (Video/Thumbnail Storage) · Durable Objects · React + Vite

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wtchp/wtchp)

---

## Özellikler

- 🎬 HLS + MP4 video oynatma (adaptive bitrate)
- 🔐 Kullanıcı kayıt/giriş sistemi (JWT)
- 👍 Like / Dislike / Favori / Yorum
- 🔍 Video arama + autocomplete
- 🏷 Kategori ve etiket sistemi
- 👤 Model profilleri (videolara atanabilir)
- 📊 Admin panel (dashboard, video/kategori/model yönetimi)
- 💾 İçerik ingest (dış URL'lerden video + thumbnail indirme → R2)
- 🌗 Dark / Light tema desteği
- 🔞 Yaş doğrulama gate
- 📱 Responsive tasarım

---

## Kurulum (Web Setup Wizard)

Platform ilk açıldığında **otomatik Setup Wizard** çalışır — terminal komutu gerektirmez.

### Adım 1: Cloudflare Kaynakları Oluştur

[Cloudflare Dashboard](https://dash.cloudflare.com)'a giriş yap ve şu kaynakları oluştur:

| Kaynak | Nereden | Not |
|--------|---------|-----|
| **D1 Database** | Workers & Pages → D1 → Create | İsim: `wtchp-db` |
| **R2 Bucket** | R2 → Create bucket | İsim: `wtchp-storage` |
| **KV Namespace** | Workers & Pages → KV → Create | İsim: `wtchp-sessions` |

### Adım 2: Deploy Et

**Seçenek A — One-Click Deploy (Önerilen)**

Yukarıdaki **"Deploy to Cloudflare Workers"** butonuna tıkla. Bu otomatik olarak:
1. Repo'yu GitHub hesabına fork'lar
2. Worker'ı oluşturur ve deploy eder
3. GitHub Actions CI/CD kurar

Deploy sonrası Cloudflare Dashboard'dan Worker'ın Settings → Bindings bölümünden D1, R2 ve KV binding'lerini ekle.

**Seçenek B — Manuel Deploy**

```bash
git clone <repo-url> wtchp && cd wtchp
npm install
```

`wrangler.jsonc` dosyasında `database_id` ve KV `id` alanlarına Dashboard'dan aldığın ID'leri yaz, sonra:

```bash
npm run build && npx wrangler deploy
```

### Adım 3: Web Setup Wizard

Siteyi tarayıcıda aç. İlk ziyarette **Setup Wizard** otomatik olarak görünecek:

1. **🗃 Initialize Database** — Tek tıkla tüm tabloları oluşturur (migration gerekmez)
2. **👤 Create Admin** — Admin kullanıcı adı, email ve şifre belirle
3. **✅ Hazır!** — Site kullanıma açılır

> Terminal, CLI veya SQL komutu gerekmez. Her şey tarayıcıdan yapılır.

### Adım 4: Konfigürasyon (Opsiyonel)

Cloudflare Dashboard → Workers → wtchp → Settings → Variables:

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `SITE_NAME` | Site başlığı | `WTCHP` |
| `SITE_URL` | Public URL | `https://wtchp.workers.dev` |
| `JWT_SECRET` | JWT anahtarı (32+ karakter) | `change-this-in-production` |
| `R2_PUBLIC_URL` | R2 CDN URL'i | — |

> ⚠ **Production'da `JWT_SECRET`'ı mutlaka değiştirin!**

### Adım 5: Custom Domain (Opsiyonel)

Cloudflare Dashboard → Workers & Pages → wtchp → Settings → Domains & Routes → **Add Custom Domain**

---

## Lokal Geliştirme

```bash
git clone <repo-url> wtchp && cd wtchp
npm install
npm run dev
```

Tarayıcıda `http://localhost:5173` adresine git. Setup Wizard otomatik çalışacak.

> Lokal geliştirmede D1/R2/KV otomatik olarak `.wrangler/` klasöründe simüle edilir.

---

## Video Ekleme

### Yöntem 1: Admin Panel (Manuel)

1. Admin panele git → **➕ Add Video**
2. Title, Video URL (HLS veya MP4), Thumbnail URL gir
3. Kategorileri ve modelleri seç → **Add Video**

> Thumbnail otomatik olarak R2'ye indirilir. Video URL'i dış kaynak olarak kalır — R2'ye indirmek için video listesinde **💾 Ingest** butonuna tıkla.

### Yöntem 2: API ile Toplu Ekleme

```bash
curl -X POST https://yourdomain.com/api/admin/videos/bulk \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "videos": [
      {
        "title": "Video Title",
        "video_url": "https://example.com/video.mp4",
        "thumbnail_url": "https://example.com/thumb.jpg",
        "duration": 300,
        "resolution": "720p",
        "tags": ["tag1", "tag2"],
        "categories": [1, 2]
      }
    ]
  }'
```

### Yöntem 3: Lokal Transcode + R2 Upload

```bash
# Videoyu HLS formatına dönüştür (720p / 480p / 360p)
./scripts/transcode.sh input.mp4 ./output my-video-slug

# R2'ye yükle
for file in ./output/my-video-slug/**/*; do
  key="videos/my-video-slug/${file#./output/my-video-slug/}"
  npx wrangler r2 object put wtchp-storage/$key --file=$file
done
```

### İçerik Ingest (Dış kaynak → R2)

Dış URL'deki videoyu otomatik olarak R2'ye indirmek için:

```bash
# Tek video ingest (thumbnail + video)
curl -X POST https://yourdomain.com/api/admin/ingest/<VIDEO_ID> \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

Bu endpoint:
- **Thumbnail**: Dış URL'den indirir → `thumbnails/{slug}.jpg` olarak R2'ye kaydeder
- **MP4**: Stream olarak R2'ye yükler (>100MB multipart upload)
- **HLS**: Master manifest + variant playlist'ler + tüm segment'leri indirir, manifest'leri yeniden yazar

---

## Proje Yapısı

```
wtchp/
├── db/
│   ├── schema.sql            # Ana veritabanı şeması
│   ├── seed.sql              # Örnek veriler
│   └── migrations/           # Migration dosyaları
│       └── 001_models.sql
├── scripts/
│   └── transcode.sh          # FFmpeg HLS transcode script
├── src/
│   ├── client/               # React SPA (Frontend)
│   │   ├── components/       # Header, Sidebar, VideoCard
│   │   ├── hooks/            # useAuth, useApi, useTheme, useAgeGate
│   │   ├── pages/            # Home, VideoPlayer, Search, Admin, ModelPage...
│   │   ├── App.tsx           # Router & layout
│   │   ├── main.tsx          # Entry point
│   │   └── index.css         # Design system (dark + light theme)
│   ├── worker/               # Cloudflare Worker (Backend)
│   │   ├── routes/           # API route handlers
│   │   │   ├── auth.ts       # Kayıt, giriş, JWT
│   │   │   ├── videos.ts     # Video listeleme, detay
│   │   │   ├── categories.ts # Kategori CRUD
│   │   │   ├── models.ts     # Model listeleme
│   │   │   ├── search.ts     # Arama + öneriler
│   │   │   ├── user.ts       # Favoriler, like, yorum, geçmiş
│   │   │   ├── admin.ts      # Admin CRUD + ingest
│   │   │   └── stream.ts     # R2'den video/thumbnail serve
│   │   ├── middleware/
│   │   │   └── auth.ts       # JWT doğrulama, admin kontrolü
│   │   ├── services/
│   │   │   └── ingest.ts     # Thumbnail/Video indirme servisi
│   │   ├── durable/
│   │   │   └── viewCounter.ts # Durable Object (izlenme sayacı)
│   │   ├── types.ts          # Type tanımları
│   │   └── index.ts          # Worker entry point
│   └── shared/               # Paylaşılan tipler
├── wrangler.jsonc            # Cloudflare ayarları
├── vite.config.ts            # Vite build config
├── tsconfig.json             # TypeScript config
├── package.json
└── .gitignore
```

---

## Konfigürasyon Referansı

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `SITE_NAME` | Site başlığı (header'da görünür) | `WTCHP` |
| `SITE_URL` | Sitenin public URL'i | `https://wtchp.workers.dev` |
| `JWT_SECRET` | JWT imzalama anahtarı | `change-this-in-production` |
| `ADMIN_SETUP_KEY` | İlk admin hesabını oluşturmak için tek kullanımlık anahtar | `change-this-setup-key` |
| `R2_PUBLIC_URL` | R2 bucket'ın public URL'i (custom domain ile) | — |

---

## API Endpoints

### Public
| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/videos` | Video listele (sort, filter, pagination) |
| GET | `/api/videos/trending` | Trend videolar |
| GET | `/api/videos/recent` | Son eklenen videolar |
| GET | `/api/videos/:slug` | Video detay |
| GET | `/api/categories` | Kategoriler |
| GET | `/api/models` | Modeller |
| GET | `/api/models/:slug` | Model profili + videoları |
| GET | `/api/search?q=...` | Video arama |
| GET | `/api/stream/:slug/*` | HLS/MP4 stream (R2) |

### Auth
| Method | Endpoint | Açıklama |
|--------|----------|----------|
| POST | `/api/auth/register` | Kayıt ol |
| POST | `/api/auth/login` | Giriş yap |
| GET | `/api/auth/me` | Mevcut kullanıcı bilgisi |
| POST | `/api/auth/setup-admin` | Admin hesabı oluştur |

### User (JWT gerekli)
| Method | Endpoint | Açıklama |
|--------|----------|----------|
| POST | `/api/user/favorites/:videoId` | Favoriye ekle/çıkar |
| POST | `/api/user/reactions/:videoId` | Like/Dislike |
| POST | `/api/user/comments/:videoId` | Yorum yaz |
| POST | `/api/user/history/:videoId` | İzleme geçmişi kaydet |

### Admin (Admin JWT gerekli)
| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/admin/stats` | Dashboard istatistikleri |
| POST | `/api/admin/videos` | Video ekle |
| POST | `/api/admin/videos/bulk` | Toplu video ekle |
| PUT | `/api/admin/videos/:id` | Video güncelle |
| DELETE | `/api/admin/videos/:id` | Video sil |
| POST | `/api/admin/ingest/:id` | Video+thumbnail → R2 indir |
| POST/PUT/DELETE | `/api/admin/models/:id` | Model CRUD |
| POST/PUT/DELETE | `/api/admin/categories/:id` | Kategori CRUD |

---

## Lisans

MIT
