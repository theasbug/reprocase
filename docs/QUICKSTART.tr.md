# ReproCase 1.1 beta

ZIP'i tamamen çıkartıp ReproCase.exe'yi aç. AI Assistant'ta sağlayıcı ve API anahtarıyla bağlan; mesaj kutusundan model seç. /help kılavuzu, /mcp bağlantıları, /tools araçları ve izinleri açar.

Bug Bounty Center → Program & Scope altında izin verilen ve hariç tutulan hedefleri yaz. URL kuralı protokol, port ve yolu korur; host kuralı ayrı davranır. Yanlış program kimliği reddedilir. Hız sınırını gir; gerekirse HTTP başlıklarını JSON olarak ekle. Başlık değerleri yalnız bellekte kalır, uygulama kapanınca yeniden girilir.

Tarama hataları Sonuç belirsiz olarak gösterilir; sıfır aday açık bulunmadığı garantisi değildir. Ağ taramalarını durdur düğmesi ve Ctrl+Alt+Esc kullanılabilir. Terminal/MCP gibi dış araçlar bu hedef politikalarının dışında işlem yapabilir; Sınırsız mod bir sandbox değildir.

Gerçek kanıt için .reprocase.json paketini çalıştır. Playwright export'u aynı çekirdeği kullanır ve ReproCase kaynak kurulumunda çalışır; docs/EXPORTS.md'yi oku. Hurl çıktısı doğrulama içermeyen istek taslağıdır.

Eski v1.0 klasörünü koru; yeni paketi ayrı klasöre çıkar. ReproCase-data'yı yedekle ve herkese açık GitHub deposuna ekleme. Bu sürüm beta olarak hazırlanmıştır; GitHub'a otomatik yayımlanmaz.
