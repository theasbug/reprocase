# Quick proof: yazma, rol ve CORS

Normal yazma akışı beş bilgiyle çalışır: hedef adresi, A hesabı, B hesabı, oluşturma isteği ve şüpheli değiştirme isteği. JSON Pointer yazılmaz. Uygulama eşlemeyi kuramazsa yalnızca eksik okuma isteğini veya alan seçimini gösterir.

## Hesaplar arası yazma

Quick proof'ta **Hesaplar arası erişim** seç. A nesnenin sahibi, B erişim deneyecek hesaptır. Örneğin:

```http
POST /documents HTTP/1.1
Content-Type: application/json

{"text":"ilk değer"}
```

```http
PATCH /documents/42 HTTP/1.1
Content-Type: application/json

{"text":"yeni değer"}
```

`PATCH`, `PUT`, `POST`, JSON/form ve yol/query/gövde nesne kimlikleri desteklenir. Örnekteki nesne değiştirilmez: kimliği yeni oluşturulan nesneye bağlanır. Birden fazla farklı nesne kimliği belirsizse otomatik değişiklik yapılmaz.

Öğrenme sırasında bir geçici nesnede A'nın aynı değişikliği yapabildiği gözlenir. Asıl çalıştırmada ayrı bir yetkili kontrol nesnesi ve yeni bir test nesnesi oluşturulur. **A önce okur → B bir kez değiştirmeyi dener → A tekrar okur.** Metinlerde benzersiz işaret, sayı/boolean/sabit değerlerde birebir durum geçişi kullanılır. `200` tek başına kanıt değildir. Hata cevabına rağmen gerçek değişiklik varsa sahibin bağımsız okuması bunu gösterebilir; kaybolan değiştirme isteği otomatik tekrarlanmaz.

Temizlik yalnızca bu çalışmanın oluşturduğu nesneleri hedefler. Kalan nesneler hata/temizlik ayrıntılarında gösterilir. Durdurduktan sonra yeni HTTP isteği, temizlik isteği dahil, gönderilmez; varsa kalan nesneleri gözden geçir.

## Rol / işlem yetkisi

**Rol / işlem yetkisi** seç. A izinli, B izin verilmemesi gereken hesaptır. Uygulama canlı kimlik cevaplarından rol alanını bulur; gerekirse doğru alanı listeden seç. Rol adları arasında otomatik hiyerarşi kurulmaz: beklenen erişim politikasını sen gözden geçirirsin.

- Salt okuma için oluşturma isteğini boş bırak ve örneğin `GET /admin/report` yapıştır. Canlı A cevabı, anonim kontrol ve B cevabı karşılaştırılır. B'nin anonim kullanıcıya verilmeyen aynı özel alanı okuması gerekir.
- Yazma için oluşturma isteği ile yeni test nesnesine bağlı işlemi yapıştır. Yazma akışındaki bağımsız durum geçişi kullanılır.
- Aynı hesap, aynı/değişen roller veya farklı organizasyonlar doğrulanmış rol ihlali sayılmaz. Bu sürüm sistem genelindeki geri alınamaz yönetim işlemlerini otomatik denemez.

## CORS

**CORS** seç, tek hesabın tarayıcı penceresinde giriş yap ve örneğin `GET /private` yapıştır. Uygulama, anonim cevaptan ayrılan bir özel alanı bulur. Asıl çalıştırma aynı origin'den oturumlu kontrol, anonim kontrol, `https://reprocase-probe.invalid` sanal origin'i ve sandbox `null` origin'i üzerinden gerçek tarayıcı `fetch` denemeleri yapar; sonrasında kimlik ve kontrol tekrar doğrulanır.

Yalnızca saldırgan sayfasının JavaScript'inin okuyabildiği veri kanıt olur. Başlıkların uygun görünmesi veya ayrıcalıklı HTTP istemcisinin veriyi alabilmesi yeterli değildir. Sanal saldırgan sayfası yerel olarak sağlanır; hedef cevapları gerçek ağdan gelir. Cookie `SameSite` özellikleri, CORS, TLS ve tarayıcı güvenliği kapatılmaz. Çapraz isteğe Bearer token eklenmez.

İlk sürüm gerçek tarayıcıda giriş yapılmış cookie oturumları içindir. Salt Bearer/header veya ham Cookie bağlantısı yeterli değildir. Yerel ağ izni, üçüncü taraf cookie politikası, geçersiz oturum ve ağ sorunu testi sınırlayabilir. Belirsiz ağ hatası bir düzeltme kanıtı sayılmaz. Negatif sonuç, rapordaki test origin'leri ve Chromium bağlamıyla sınırlıdır. Yerel laboratuvar testleri için gereken yerel ağ izni uygulamada otomatik verilmez.

## Paylaşım, CLI ve MCP

Yeni türler v2 `.reprocase.json` paketi kullanır. Mevcut v1 vakaları dönüştürülmeden çalışır. İçe aktarılan paketin erişim politikası yeniden gözden geçirilir; alıcı kendi hesaplarını bağlar.

CLI `run`, `plan`, `validate`, `compare`, `export` aynı motoru kullanır. CORS için yerel Playwright storage-state dosyası bağlantı profilinde `browserState` olarak verilebilir; `env:REPROCASE_SECRET_STATE` ile yol ortamdan alınabilir. Dosya bir oturum sırrıdır ve paylaşılan pakete eklenmez. Playwright dışa aktarımında `REPROCASE_BROWSER_STATE_OWNER` kullanılır. Programın scope/exclusion ve hız sınırı korunur; alıcı kendi gözden geçirdiği politikayı `REPROCASE_PROGRAM` JSON ile verebilir. Oturumluk program kimlik doğrulama başlıkları betiğe gömülmez. Hurl tarayıcı CORS kanıtı üretemediği için CORS'ta sunulmaz.

MCP'de `quickproof_start`, `quickproof_open_browser`, `quickproof_identity`, `quickproof_observe` ve `actor_restore_browser_state` araçları bulunur. Gözlem sonucu `ready` veya `needs_input` döner. Gözlem, son kanıt çalıştırması değildir; politika ve sürüm onayı yine gerekir.

Örnekler: `templates/quick-write-v2.reprocase.json`, `templates/quick-role-read-v2.reprocase.json`, `templates/quick-cors-read-v2.reprocase.json`.
