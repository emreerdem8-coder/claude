# Kreatif Stüdyo

Markaya özel, satış odaklı reklam kreatifleri üreten lokal uygulama. Senin üç promptun (`prompts/` klasörü) sistemin kalbidir:

| Dosya | Ne işe yarar |
|---|---|
| `prompts/strateji.txt` | 100 stratejinin ham hâli ve uyarlama kuralları. A–J, 001–100 ve ★ iskeleti **bu dosyadan okunur**, modelden değil. |
| `prompts/kreatif.txt` | Görev kartı (GÖREV ###) yapısı, kurallar, batch akışı. |
| `prompts/branding.txt` | Kimliği olmayan marka için yazılı kimlik taslağı. |

Bu dosyaları düzenlersen sistem bir sonraki üretimde yeni hâlini kullanır.

## Kurulum

Gerekli: [Node.js 20.6+](https://nodejs.org)

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
# .env dosyasını aç, OPENAI_API_KEY= satırına anahtarını yaz (istersen IDEOGRAM_API_KEY de)
npm start
```

Tarayıcıda **http://localhost:4747** adresini aç.

Anahtar bağlamadan önce arayüzü denemek için: `npm run demo` (yapay zekâ yanıtları sahte, ayrı bir `data-demo/` klasörü kullanır).
Uçtan uca otomatik test: `npm run check`.

## Akış

1. **Brif** — 100 Strateji promptundaki 18 soru. “Eksikleri sor” butonu, eksikleri tek kısa mesajda sorar; cevapları brife ekler.
2. **Kimlik** — Kimliğin varsa gir (renkler HEX, yazı tipleri, ton, fotoğraf stili, tasarım kuralları). Yoksa “Brifimden kimlik oluştur” Branding promptuyla taslak çıkarır; düzenleyip kaydedersin.
3. **Görseller** — Gerçek ürün fotoğrafları (görsel modeline referans gider, ürün birebir korunur), logo ve kalite referansları (beğendiğin onaylı kreatifler; kart yazarken kalite çıtası olarak kullanılır).
4. **Strateji** — 100 strateji markaya uyarlanır. İskelet sabit; model yalnızca markaya özgü fikri yazar. Eksik satırlar otomatik onarılır, `[… gerekli]` satırları işaretlenir. Satırı düzenleyebilir, tek satırı veya tüm grubu notla yeniden yazdırabilirsin. **Her grubu onaylarsın.**
5. **Kreatifler** — Onaylı grup = bir batch (10 kreatif). Akış:
   - 10 görev kartı yazılır (hook, satış açısı, funnel, başlık, kurgu, reklam metni…).
   - **Kalite kapısı:** kartlar ayrı bir “performans pazarlamacısı” modeliyle puanlanır. 9 altı olanlar ve birbirine benzeyenler otomatik yeniden yazılır (2 tura kadar).
   - Kartları onaylarsın veya “Revize” ile not verirsin. Gerçek veri gereken kartlar (`[GERÇEK FİYAT]` vb.) doldurulmadan üretilmez.
   - Görseller sırayla üretilir → formata kırpılır (4:5, 1:1, 9:16) → istersen gerçek logo bindirilir → görsel model kreatifi okuyup puanlar (yazı birebir mi, ürün aynı mı, strateji ve satış gücü) → 9 altıysa düzeltme talimatıyla otomatik yeniden üretilir (varsayılan 2 deneme), en yüksek puanlı sürüm seçilir.
   - Her görsel markanın önceki kreatifleriyle görsel benzerlik açısından karşılaştırılır; çok benzeyen kreatif reklam körlüğü riski olarak işaretlenir ve yeniden üretilir.

## Reklam körlüğüne karşı

Her kart bir **kurgu tipi** (14 seçenek: elde ürün, sahnedeki nesnenin üzerinde yazı, tipografik afiş, ekran arayüzü, makro detay, karşılaştırma…), **zemin** ve **yazı yerleşimi** seçer. Aynı batch’te aynı kurgu tipi iki kez kullanılamaz; zemin ve yazı yerleşimi en fazla 3 kez tekrar eder. Önceki batch’lerde çok kullanılan kurgular sonraki batch’lere bildirilir. Bu kontrol kodla yapılır, modele bırakılmaz.

## Ayarlar

Ayarlar sayfasından metin, kalite kontrol ve görsel modellerini, reasoning seviyesini, minimum kalite puanını ve otomatik deneme sayısını değiştirebilirsin. “OpenAI bağlantısını test et” butonu anahtarı ve seçtiğin modellerin hesabında açık olup olmadığını kontrol eder.

API anahtarları yalnızca `.env` dosyasında durur, tarayıcıya gönderilmez. `.env` ve `data/` git’e eklenmez.

## Üyelik modeline hazırlık

- Her yapay zekâ işlemi `server/services/credits.js` içindeki tarifeyle kredi defterine yazılır (Kullanım ve kredi sayfası).
- `CREDITS_UNLIMITED=false` yapıldığında bakiye kontrolü devreye girer (yetersizse 402 döner).
- Tüm kayıtlar kullanıcıya bağlıdır; şu an tek bir lokal kullanıcı var. Gerçek giriş sistemi `currentUser()` fonksiyonuna takılır.
- Veri katmanı `server/store.js` içinde tek bir modülde; Postgres/SQLite’a geçişte yalnızca bu dosya değişir.

## Klasör yapısı

```
prompts/            senin promptların (tek doğru kaynak)
server/
  index.js          API ve statik sunucu
  framework.js      100 strateji iskeletini prompt dosyasından okur, brif alanları
  services/         brand, strategy, cards (kalite kapısı + çeşitlilik), render (görsel hattı), credits
  ai/               OpenAI ve Ideogram istemcileri
public/             arayüz (build adımı yok). Renkler: public/css/tokens.css
data/               markalar, yüklemeler, üretilen kreatifler (git'e girmez)
```

## Notlar

- Görsel modeli Türkçe yazıyı her zaman kusursuz çizemeyebilir; kalite kontrol yazıyı okuyup karşılaştırır ve hatalıysa yeniden üretir. Yine de hatalı kalırsa “Prompt” butonundan düzenleyip tekrar üretebilir ya da tipografi ağırlıklı kreatiflerde Ideogram’ı seçebilirsin.
- Model adları zamanla değişir. Bir model hesabında yoksa Ayarlar’dan değiştir.
