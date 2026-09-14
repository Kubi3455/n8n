# Hızlı başlangıç

## 1. Node.js kurulu mu?

Terminalde (Windows'ta Komut İstemi) şunu yaz:

```
node -v
```

`v18` veya üstü bir sürüm görüyorsan hazırsın. Komut tanınmıyorsa
[nodejs.org](https://nodejs.org) adresinden **LTS** sürümünü kurup pencereyi kapatıp yeniden aç.

## 2. Uygulamayı başlat

Klasörü aç ve işletim sistemine göre ilgili dosyaya **çift tıkla**:

| İşletim sistemi | Dosya |
| --- | --- |
| Windows | `baslat.bat` |
| macOS | `baslat.command` |
| Linux | `baslat.sh` |

Terminalden başlatmayı tercih edersen: `npm start` ya da doğrudan `node server/index.js`.

Kurulum adımı **yok** — uygulamanın hiçbir dış paket bağımlılığı bulunmuyor, `npm install`
çalıştırmana gerek kalmadan açılır.

## 3. Kullan

Tarayıcı kendiliğinden açılır (açılmazsa terminaldeki adresi kopyala, genelde
http://localhost:3000 — port doluysa uygulama bir sonraki boş portu seçer ve onu yazar).

1. **Kayıt ol** sekmesinden e-posta ve en az 8 karakterlik bir şifreyle hesap aç.
2. Bir referans görsel yükle, video fikrini yaz, platformları seç.
3. **Otomasyonu başlat** de; beş adım canlı olarak ilerler.

API anahtarı girmediğin sürece tüm servisler sahte (mock) verilerle çalışır: hiçbir ücret
oluşmaz, hiçbir yere gerçek paylaşım yapılmaz. Üst çubuktaki rozetler hangi servisin mock
olduğunu gösterir.

## 4. Anahtarları sonra ekle

`.env.example` dosyasını `.env` adıyla kopyala ve elindeki anahtarları yaz:

```
OPENAI_API_KEY=...     # görsel analizi, prompt ajanları, caption
FAL_API_KEY=...        # NanoBanana görsel düzenleme
KIE_API_KEY=...        # VEO3 video render
BLOTATO_API_KEY=...    # sosyal medya paylaşımı
```

Anahtarı girilen servis canlıya geçer, girilmeyen mock kalmaya devam eder — yani teker teker
de ekleyebilirsin. Blotato hesap kimliklerini uygulama içindeki **Ayarlar** ekranından
girersin. Değişiklikten sonra uygulamayı kapatıp yeniden başlat.

## Durdurma ve veriler

Durdurmak için terminalde `Ctrl+C`. Hesaplar ve projeler `data/` klasöründe, yüklenen
görseller `uploads/` klasöründe tutulur; bu iki klasörü silersen uygulama sıfırdan başlar.
