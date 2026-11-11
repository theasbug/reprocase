# ReproCase — Türkçe X gönderileri

All entries after launch are drafts. Dates use Europe/Istanbul. Do not present a draft as already published.

## 2026-11-11 — launch (published)

Yeni hesaplar. Yeniden üretilebilir kanıtlar.

ReproCase ile aynı IDOR vakasını yeni hesaplarla çalıştırıp güvenli sürümle karşılaştırabiliyorsun.

Yerel demo API anahtarı istemiyor. Windows beta ve kaynak kod:
https://github.com/theasbug/reprocase

İlk 5 test kullanıcısını arıyorum.

## 2026-11-13 — http-200 (draft)

HTTP 200, tek başına IDOR kanıtı değil.

Kaynak kime ait? Hesaplar farklı mı? Diğer hesap bu çalışmada oluşturulan ayırt edici içeriği gerçekten okuyabildi mi?

Yerel demo üzerinden:
https://github.com/theasbug/reprocase/blob/main/docs/launch/why-200-is-not-proof.md

## 2026-11-15 — beta-feedback (draft)

ReproCase'i deniyorsan yerel demoyu çalıştır, hesapları yenile ve tekrar dene. Sonra Güvenli hedefe geç.

En çok hangi adımın kafa karıştırdığını öğrenmek istiyorum. API anahtarı veya özel hedef kaydı gerekmiyor.
https://github.com/theasbug/reprocase/issues/new/choose

## 2026-11-18 — resource (draft)

Yeni hesaplarla birlikte yeni kaynak da gerekiyor.

ReproCase kontrollü bir belge oluşturuyor, yeni ID'yi bağlıyor, sahipliği kontrol ediyor ve yeni içeriğin okunmasını sınayabiliyor.

https://github.com/theasbug/reprocase
#bugbounty

## 2026-11-20 — windows-fix (draft)

Beta testleri işe yarıyor: temiz Windows sunucusunda terminalin başlamaması sorunu bulundu ve giderildi.

Standart Windows ortamı korunuyor; ortam değişkenleri izin listesiyle aktarılıyor. Windows/Linux kontrolleri geçti.
https://github.com/theasbug/reprocase/actions

## 2026-11-22 — three-results (draft)

Başarısız giriş, erişimin güvenli biçimde reddedildiğini göstermiyor.

ReproCase üç ayrı sonuç gösteriyor: Yeniden üretildi, Yeniden üretilemedi, Sonuç belirsiz. Eksik oturum ve hazırlık değerlendirmeyi engelleyebilir.

https://github.com/theasbug/reprocase

## 2026-11-25 — sharing (draft)

Senaryoyu paylaş, kendi oturumlarınla yeniden çalıştır.

ReproCase vaka paketlerinde hesap ve kaynak bağlarını koruyor. Alıcı kendi hesaplarını bağlayıp yeni kanıt üretiyor. Paylaşmadan önce içeriği gözden geçir.
https://github.com/theasbug/reprocase

## 2026-11-27 — exports (draft)

Dışa aktarma ayrıntıları önemli.

ReproCase Playwright çıktısı kaynak kurulumundaki aynı çalıştırıcıyı kullanıyor. Eksik hazırlık testi başarısız kılıyor. Hurl çıktısı ise istek taslağı.

https://github.com/theasbug/reprocase/blob/main/docs/EXPORTS.md

## 2026-11-29 — case-policy (draft)

Yetkilendirme vakasının açık bir erişim politikası olmalı.

ReproCase tanımladığın kimlikleri, sahipliği ve ihlal göstergesini kontrol ediyor. Beklenen erişim sınırını araştırmacı gözden geçiriyor.

Yerel demo:
https://github.com/theasbug/reprocase

## 2026-12-02 — ai-core (draft)

ReproCase'te AI asistanı araştırmaya ve vaka taslağına yardımcı oluyor. Yeniden üretim kararı çekirdekteki açık kontrollerden çıkıyor.

Yerel kanıt akışını model sağlayıcısı bağlamadan deneyebilirsin.

https://github.com/theasbug/reprocase

## 2026-12-04 — sessions (draft)

Cookie ve Bearer oturumlarının doğru hesaba bağlandığını kontrol etmek gerekiyor. ReproCase Chromium hesap bağlamlarını ayrı tutuyor ve değerlendirmeden önce canlı kimlik kontrolü yapıyor.

Yerel test hesaplarıyla dene:
https://github.com/theasbug/reprocase

## 2026-12-06 — next-feedback (draft)

Yeni hesaplarla tekrar üretimde en çok hangi adım zor geliyor: hesap bağlama, kaynak hazırlığı veya kanıt inceleme?

ReproCase açık kaynak beta. Yerel örnekler ve kurulum geri bildirimleri bir sonraki sürümü şekillendiriyor.
https://github.com/theasbug/reprocase
