# ReproCase 1.1 beta

## 1. ReproCase ne işe yarar?

Bir güvenlik açığı bulduğunu düşün. Sadece “bu adreste açık var” demek yerine, başka bir kişinin kendi test hesaplarıyla aynı durumu kontrol edebilmesini istiyorsun. ReproCase bu deneyi bir vakaya dönüştürür: hesaplar, kaynaklar, istekler, hazırlık ve kanıt birlikte tanımlanır.

Örnek: Ayşe bir not oluşturur. Normalde yalnızca Ayşe okuyabilmelidir. Mehmet kendi hesabıyla bu notu okuyabiliyorsa, uygulamada erişim kontrolü sorunu olabilir. ReproCase yeni bir not ve yeni hesaplarla bu iddiayı sınar. HTTP 200 gelmesi tek başına kanıt değildir; yeni notun ayırt edici içeriği de görülmelidir.

AI Assistant bu çalışma alanındaki yardımcı agent’tır. Dosya okuyabilir, kod yazabilir, komut çalıştırabilir ve Windows uygulamalarını kullanabilir. Güvenlik sonucunu ise vaka kuralları hesaplar. Önce yerel demoyu denemek öğrenmenin en kolay yoludur.

## 2. ZIP’i aç ve ilk kez çalıştır

Windows ZIP dosyasına sağ tıkla ve Tümünü ayıkla seçeneğini kullan. ReproCase.exe’yi ZIP’in içinden çalıştırma. Çıkartılan klasördeki exe’yi aç. Node.js, Python veya Docker kurman gerekmez; bu sürüm gerekli çalışma ortamını ve Chromium’u içerir.

Uygulama yerel bilgisayarında çalışır. ReproCase-data klasörü exe’nin yanında oluşur. Vakalar, sohbetler, ayarlar ve yedekler buradadır. Klasörü silersen kayıtlarını kaybedersin. Yeni sürüme geçerken uygulamayı kapatıp bu klasörün yedeğini al; eski sürümü ayrı tut.

Arayüzün üstündeki dil düğmesiyle Türkçe ve İngilizce arasında geçebilirsin. Tema düğmesi görünümü değiştirir. AI Assistant düğmesi sohbeti açar; Çalışma alanı düğmesi vakalara döndürür.

## 3. Sağlayıcı ve API anahtarı

Sağlayıcı, modeli çalıştıran hizmettir. AI Assistant → Sağlayıcılar ve API anahtarları bölümüne gir. Normal modda sadece sağlayıcıyı seç ve API anahtarını yapıştır. Kaydet ve modelleri bul düğmesine bas. API anahtarı bir şifre gibidir: herkese açık GitHub dosyalarına, ekran görüntülerine veya raporlara ekleme.

OpenAI, Anthropic, Gemini, DeepSeek, OpenCode Go/Zen ve listelenen diğer hizmetlerin adresleri hazırdır. Kendi sunucun, Ollama veya farklı bir uç noktan varsa gelişmiş/özel sağlayıcı modunu seç. Burada Base URL ve API protokolü de belirtilir. Base URL genellikle /v1 ile biter; /chat/completions kısmını ayrıca ekleme.

Model bulunması, modelin her isteğe cevap verebileceği anlamına gelmez. Ücret, kota, bölge ve erişim hesabına bağlıdır. Windows sürümünde kaydedilen anahtarlar Windows şifrelemesiyle saklanır. Bu şifreleme mevcut Windows kullanıcısına bağlıdır; başka bilgisayara taşırken anahtarı yeniden girmen gerekebilir.

## 4. Model, akıl yürütme ve görme

Mesaj kutusunun altındaki Model düğmesine bas. Sağlayıcı ve model adları arasında arama yapabilirsin. İstediğin modele tıkla. Akıl yürütme kutusu model seçme düğmesinden farklıdır. Model bu ayarı desteklemiyorsa kutunun pasif görünmesi normaldir.

Otomatik, sağlayıcının varsayılanını kullanır. Desteklenen düşük/yüksek gibi seviyeler modelin harcadığı çabayı etkileyebilir; süre ve maliyet değişebilir. Çalışma sürerken model değiştirilmez. Önce işi durdur veya tamamlanmasını bekle.

Ekran görüntülerini anlayabilmek için görüntü girdisi destekleyen bir model gerekir. Metin modeli yine pencere listesi, erişilebilirlik ağacı, terminal ve dosyaları kullanabilir; çekilen resim kullanıcıya gösterilir. Sağlayıcı keşfi görme yeteneğini bildirmiyorsa modelleri yenilemeyi dene. Araç çağırma desteği de modelden modele değişir.

## 5. İlk sohbet ve basit bir deneme

Yeni oturum aç. “Selam, bu çalışma ortamında hangi araçların var?” yaz. Sonra “Çalışma klasörünü listele ve burada bir plan.md dosyası varsa oku” diyebilirsin. Dosya okumak için dosya adını bilmek yeterlidir; başka klasördeyse tam yolu belirt.

Windows’ta “Notepad’i aç” dediğinde agent gerçek uygulama açma aracını kullanabilir. “Notepad penceresini bul, içini incele ve boş belgeye Merhaba yaz” bilgisayar kontrolünü dener. Gelen işlem kartında ne istendiğini görüp izin ver. Önce deneme için boş bir belge kullan.

Ataş düğmesi bir metin dosyasının içeriğini mesaja ekler; dosyanın tamamı modele gönderilir. Vaka ekle seçeneği mevcut vaka tanımını bağlama ekler. Bir dosyanın adını yazmak otomatik ek yapmak değildir; agent dosya aracını kullanmalıdır.

## 6. Çalışma klasörü, dosyalar ve yedekler

Araçlar ve ortam bölümündeki Klasör seç düğmesi agent’ın çalışma klasörünü değiştirir. Başlangıçta ReproCase-data/projects kullanılır. Bir proje üzerinde çalışacaksan o projenin klasörünü seç. /workspace aynı bölümü açar.

Agent klasör listeleyebilir, metin okuyabilir, metin arayabilir ve dosya yazabilir. Mevcut dosyayı değiştirmeden önce okur; yazma aracı içerik özetini kontrol ederek arada değişmiş dosyanın üstüne yazmayı engeller. Değiştirilen mevcut dosyanın önceki hali ReproCase-data/backups altında tutulur.

Çalışma klasörü dışındaki dosyalara erişim ayrıca izin ister. Yalnızca seçtiğin klasörün agent için anlamlı bir sınır olmasını bekle; terminal ve bilgisayar araçlarına izin verirsen bunlar daha geniş işlem yapabilir. Yedek, geri alma düğmesi değildir: geri yükleme için dosyayı inceleyip önceki içeriği açıkça geri yazdır.

## 7. İşlem kartları ve izinler

AI bir işlem yaptığında sohbette araç kartı görünür. Kartı açınca kullanılan araç, girdiler ve gerçek sonuç görünür. Hata kartı, işlemin başarılı olduğu anlamına gelmez. Agent’ın yazdığı özetten önce araç çıktısını kontrol edebilirsin.

İzin gerektiren kartlarda Bir kez izin ver, Bu araç: oturum boyunca ve Reddet seçenekleri vardır. Bilgisayar araçlarında Bilgisayar: oturum boyunca seçeneği bütün desktop_ araçlarına aynı sohbet için izin verir. Agent bu düğmelere kendi adına basamaz.

Terminal komutunu ve MCP aracı girdisini çalışmadan önce incele. Oturumluk izinleri yalnızca amaçladığın çalışma sırasında ver. Yeni sohbet ayrı bir izin kapsamıdır. Stop işlemi bekleyen izinleri de kapatır.

## 8. Bilgisayar kontrolü nasıl çalışır?

Windows sürümünde pencere ve ekran listesi, ekran görüntüsü, pencere odaklama/taşıma/boyutlandırma, küçültme/büyütme, fare hareketi/tıklama/sürükleme/kaydırma, klavye ve metin panosu araçları bulunur. Erişilebilirlik aracı uygulamanın düğme ve alanlarını metin olarak okuyabilir; desteklenen öğeleri çalıştırabilir veya değer yazabilir.

Fare işlemleri yeni çekilmiş ekran görüntüsüne bağlanır. Agent resimdeki piksel koordinatlarını verir, uygulama bunları gerçek ekran koordinatına çevirir. Pencere taşındıysa veya görüntü eskidiyse tekrar görüntü gerekir. Agent mümkün olduğunda tüm ekran yerine ilgili pencereyi yakalar.

Bilgisayar kullanılırken fareyi ve klavyeyi aynı anda başka amaçla kullanmak odağı değiştirebilir. Acil durdurma: Ctrl + Alt + Esc. UAC onay ekranı veya daha yüksek yetkili uygulamalar Windows tarafından engellenebilir. Bu sürüm bu engelleri aşmaz. Linux bilgisayar kontrolü henüz uygulanmadı.

Ekran görüntüsü görebilen model, yakalanan görüntüyü sağlayıcısına gönderir. İlgisiz özel pencereleri kapat veya yalnızca deneme penceresini hedef göster. Görüntüler ReproCase-data/screenshots içinde ve sohbetin araç kartında tutulur.

## 9. Terminal ve program çalıştırma

terminal_run Windows’ta PowerShell kullanır ve çalışma klasöründe başlar. Agent örneğin proje dosyalarını inceleyebilir veya test komutu çalıştırabilir. Komut izin kartında görünür. Kopyalanan her komutun ne yapacağını anlamaya çalış.

Komutların süre sınırı vardır. İptal, bu araç tarafından başlatılan süreç ağacını durdurmayı dener. Daha önce yazılmış dosyalar, gönderilmiş istekler veya başlatılıp bağımsızlaşmış uygulamalar otomatik geri alınmaz. Başarısı belirsiz bir değişiklik komutu kendiliğinden tekrarlanmaz.

Notepad ve Hesap Makinesi için doğrudan uygulama açma aracı vardır. Başka programlar terminalle, erişilebilirlikle veya bilgisayar araçlarıyla kullanılabilir. Harici MCP sunucusunun Python/Node gibi gereksinimleri varsa bunlar ayrıca kurulmalıdır.

## 10. Çalışırken mesaj gönder ve durdur

Agent çalışırken mesaj yazıp Gönder’e basabilirsin. Mesaj “Sırada” olarak görünür. Agent mevcut model yanıtını veya başlamış aracı tamamladıktan sonraki işlem sınırında mesajı alır. Yeni yönlendirme bekleyen izinleri kapatır ve henüz başlamamış eylemler yeniden planlanır.

Örneğin “Dosyayı silme, yalnızca içeriğini göster” yazabilirsin. Ancak çoktan başlamış bir işlemi mesaj göndermek geri almaz. Acil durumda kare Durdur düğmesine veya Ctrl + Alt + Esc’ye bas. Sıraya alınmış mesajlar da iptal edilir.

Aynı anda farklı oturumlar açık olabilir. Fakat bilgisayar tek fare ve tek klavyedir; fiziksel masaüstünde agent görevlerini sırayla yürüt. Uzun bir görevde geçmişten ilgili oturumu açarak durumunu izleyebilirsin.

## 11. Düşünme, token ve hız

Sağlayıcı modelin düşünme metnini veya reasoning özetini döndürürse Düşünme bölümünde görürsün. Bazı sağlayıcılar yalnızca kısa özet döndürür; bazıları hiçbir düşünme alanı göndermez. Uygulama eksik metni üretmez ve şifreli iç düşünceyi çözmeye çalışmaz.

Yanıtın altındaki istatistikler fareyle üzerine gelince belirginleşir; klavyeyle de odaklanabilir. Girdi/çıktı token sayısı, toplam süre ve tok/s gösterilir. Token, metnin model tarafından işlenen küçük parçasıdır; bir token her zaman bir kelime değildir.

Hız, sağlayıcının bildirdiği çıktı tokenlarının model isteği süresine bölünmesiyle hesaplanır. Araç ve izin bekleme süresi paydadan çıkarılır; ilk yanıt beklemesi dahildir. Sağlayıcı kullanım sayısı göndermezse tahmini sayı gösterilmez. Birden çok araç turunun kullanımı birleştirilir.

## 12. / komutları

Mesaj kutusuna / yazınca komut menüsü açılır. /help bu kılavuzu, /mcp bağlantıları, /model model seçimini, /workspace ve /tools ortamı açar. /new yeni sohbet başlatır; /stop mevcut işi durdurur.

/plan araştırma planı, /scope hedef kapsamı, /case vaka taslağı, /repro yeniden üretim adımları, /compare karşılaştırma, /report rapor taslağı için mesaj başlangıcı hazırlar. /read dosya okuma, /terminal komut çalıştırma ve /computer masaüstü görevi için örnek istek hazırlar. Boş yerleri doldurup Gönder’e bas.

Komut menüsü bir kısayoldur; yazdığın görev normal agent araçlarına ve izinlere gider. /report sonucu otomatik yayımlamaz. /scope çalıştırma hedeflerini otomatik genişletmez. Vaka hedefleri ayrıca seçilir ve çalışma planında onaylanır.

## 13. MCP ekle ve yönet

MCP, agent’a başka programların araçlarını bağlayan ortak bir bağlantı biçimidir. /mcp yaz veya MCP düğmesini aç. Sunucu adı ver. Yerel program için stdio seçip komutu ve her satıra bir argüman yaz. Uzak hizmet için HTTP seçip MCP uç noktasını gir.

Örnek yerel komut: npx. Argümanlar ayrı satırlarda olabilir: -y, @modelcontextprotocol/server-filesystem ve izin vereceğin klasörün tam yolu. Bu örnek harici paketi indirip çalıştırır; önce kaynağını incele. Kaydet bağlantıyı kaydeder; programı başlatmak için ayrıca Bağlan’a basmalısın.

Gerekirse ortam değişkenlerini veya HTTP başlıklarını JSON olarak gir: {"API_KEY":"..."} veya {"Authorization":"Bearer ..."}. Windows’ta yapılandırma şifrelenir. Kaydedilen gizli değerler yönetim ekranından geri okunmaz. Sunucuyu değiştirmek için bağlantısını kes; sonra yeniden tanımla.

Bağlanınca araç adlarını ve durumunu görürsün. Agent bu araçları mevcut araçlarıyla birlikte seçebilir. Harici araç çağrıları da işlem kartı ve izin mekanizmasını kullanır. Bağlantıyı kes sunucuyu durdurur; Sil kaydı da kaldırır. Bu sürüm stdio ve Streamable HTTP içindir; eski SSE ve OAuth akışları bu ekranda desteklenmez.

## 14. Yerel demo: ilk güvenlik deneyi

Çalışma alanına dön ve yerel demoyu başlat. Demo kendi bilgisayarında açılır; gerçek bir müşteri sistemi gerekmez. Demodaki test hesaplarını rollerine bağla. Hesapların birbirinden farklı olduğunu ve kimin hangi kaynağa sahip olduğunu kontrol et.

Yeni çalışma planını aç. Hedefin yerel demo adresi olduğuna bak. Hazırlık adımları yeni kaynak oluşturur; test başka hesapla erişim dener; doğrulama ayırt edici içeriği kontrol eder. Planı onayla ve çalıştır. Zaman çizelgesinde her adımı incele.

Demoyu güvenli moda alıp tekrar çalıştır. Hazırlık doğruysa aynı paket bu kez Yeniden üretilemedi sonucu vermelidir. Bu, güvenli davranış ile bozuk hazırlığı ayırmayı öğretir. Sonuçları Karşılaştır görünümünde yan yana incele.

## 15. Kendi vakanı oluştur veya içe aktar

Yeni vaka sihirbazında vakaya ad ver, hedef API kaynağını belirt, hesap rollerini ve beklenen erişim kuralını yaz. Rol bir insan adı olmak zorunda değildir: owner ve other gibi isimler kullanabilirsin. Senaryo yeni hesaplara geçince de aynı ilişkiyi korumalıdır.

HAR, ham HTTP veya seçili Chromium trafiğini içe aktarabilirsin. İçe aktarma tek başına ağ isteği çalıştırmaz. Kaydedilen eski cookie, token ve nesne ID’lerini paylaşılacak paket için bağımlılıklara dönüştür. AI önerilerini uygulamadan önce incele.

Hazırlık, test, doğrulama ve temizlik ayrı adımlardır. Yeni kaynağın ID’sini JSON Pointer ile yanıttan çıkar. Değişkeni URL yolu, başlık veya JSON gövdesindeki açık konuma bağla. Rastgele metin değişimi veya paket içine JavaScript/shell eklemek desteklenmez.

## 16. Hesap, kurum, MFA ve CSRF

Her rol kendi bağımsız Chromium bağlamını kullanır. Kullanıcı girişi açarak kendin giriş yapabilirsin. Giriş yardımı seçersen MFA veya CAPTCHA gerektiğinde kontrol sana geçer; tamamladıktan sonra aynı oturumla devam edilir.

Doğrudan bağlantı deneysel seçenektir: cookie, Bearer token veya tanımlı HTTP giriş tarifi kullanılır. Başarılı bağlantı tek başına doğru rol demek değildir. Kimlik uç noktasının gözlediği kullanıcı, rol ve kurum ile beklenen koşulları karşılaştır.

İki ayrı role aynı hesabı bağlamak veya yanlış kurumu seçmek bulgunun sonucunu bozar. Önkoşullar bu durumu ayırır. CSRF gibi dinamik değerleri eski kayıttan kopyalama; hazırlık yanıtından çıkarıp ilgili başlığa/gövdeye bağla. Oturum yenilenince kimlik değişirse çalışma durmalıdır.

## 17. Sonuçları doğru oku

Yeniden üretildi: gerekli önkoşullar sağlandı ve senaryoda tanımlanmış ihlal göstergesi gözlendi. Örnek: diğer hesap yeni oluşturulan özel notun benzersiz içeriğini okudu.

Yeniden üretilemedi: önkoşullar sağlandı, test tamamlandı ve ihlal göstergesi oluşmadı. Bu sonuç yalnızca tanımladığın deneyi kapsar; uygulamanın tamamının güvenli olduğuna dair genel garanti değildir.

Sonuç belirsiz: yanlış hesap, eksik hazırlık, zaman aşımı, ağ hatası veya eksik kanıt değerlendirmeyi engelledi. Bunu “açık kapandı” diye raporlama. Zaman çizelgesindeki ilk başarısız önkoşulu düzeltip yeni çalışma başlat.

Değişiklik yapan istek belirsiz bir ağ hatasıyla kesilirse uygulama onu otomatik tekrarlamaz. Önce kaynak oluşmuş mu kontrol et; sonra nasıl devam edeceğine karar ver. Temizlik adımlarını da çıktılarıyla incele.

## 18. Rapor, paylaşım ve karşılaştırma

İki çalışmayı Karşılaştır bölümünde seç. Aynı vaka sürümü ve farklı hesaplarla tekrarları incelemek, eski ID’lere bağlı kalmadığını göstermeye yardımcı olur. Güvenli sürümle yapılan karşılaştırma ihlal göstergesinin yanlış pozitif üretip üretmediğini sınar.

Dışa aktar bölümünde temizlenmiş .reprocase.json paketini ve HTML/Markdown raporunu incele. Bilinen sırlar temizlenir; yine de tanınmayan özel veriler olabilir. Paylaşmadan önce içeriği kendin kontrol et. Yerel hesap bağlantıları paylaşılabilir pakete dahil edilmez.

AI sohbeti veya masaüstü ekran görüntüsü otomatik olarak güvenlik kanıtı sayılmaz. Vaka çalışmasının gözlemlerini rapora bağla. Raporu araştırma programının istediği kanaldan kendin paylaş; uygulama senin adına otomatik gönderim yapmaz.

## 19. Agent bağlamı ve görevi

Agent’ın temel görev tanımı prompts/AGENT.md dosyasındadır. Araçlar ve ortam bölümünde kullanılan promptu görebilir ve yerel bir kopyasını düzenleyebilirsin. Varsayılana dön kaydedilmiş düzenlemeyi sıfırlar. Değişiklik yeni başlayan model isteklerine uygulanır; mevcut çalışmayı durdurup yeni mesajla denemek daha anlaşılırdır.

Prompt, ReproCase’i ve bug bounty/yazılım geliştirme görevini tanıtır; gerçek işletim sistemi, çalışma klasörü ve araç listesi de her çalışma başında eklenir. Dosya veya program erişimi olan bir agent olduğunu bilir. Sağlayıcının ve seçilen modelin kendi davranış kuralları ayrıca geçerlidir.

Okunan dosyalar, web sayfaları ve araç çıktıları veri olarak değerlendirilir. Bir belgenin içinde “önceki talimatları unut” yazması kullanıcı talimatı değildir. Agent yine de hata yapabilir; önemli işlemlerin girdisini ve çıktısını incele.

## 20. Yaygın hatalar ve çözümü

401: API anahtarını ve doğru sağlayıcıyı kontrol et. 403: model/hesap yetkisi veya bölge sınırı olabilir. 429: kota, bakiye veya hız sınırı; sağlayıcı panelini kontrol et ve bekle. 400: protokol veya desteklenmeyen model ayarı olabilir. OpenCode yönlendirme için oturum başlığı uygulama tarafından eklenir.

Provider connection failed / fetch failed: interneti, VPN/proxy’yi ve sertifika ayarlarını kontrol et. Windows masaüstü sürümü sağlayıcı isteklerinde Electron’un ağ katmanını kullanır. Sertifika doğrulaması kapatılmaz. Aynı hata yalnızca tek sağlayıcıdaysa hizmet tarafını da kontrol et.

Yerel servise bağlanılamadı: uygulamanın açık olduğuna bak; kapatıp yeniden aç ve aynı oturumu geçmişten seç. Kesilmiş yanıt tamamlandı diye gösterilmez. Kısmi çıktı kalır; mesaj üretimi veya değişiklik yapan araç otomatik yeniden denenmez.

Araç yok / araç çağırma başarısız: modelin araç desteğini Bağlantıyı test et ile kontrol et. MCP aracı yoksa Bağlandı durumuna ve sunucu çıktılarına bak. Windows odağı reddederse hedef pencereyi görünür yapıp tekrar dene. Hata raporuna anahtar ekleme; sürüm, araç adı ve temizlenmiş hata yeterlidir.

## 21. Kopyalayıp deneyebileceğin görevler

Dosya: “Çalışma klasöründeki plan.md dosyasını oku. İlk üç adımı açıkla. Henüz dosya değiştirme.” Kod: “Bu projede test komutunu bul, komutu göster ve izin verdiğimde çalıştır.”

Masaüstü: “Notepad’i aç. Penceresini bul ve erişilebilirlik ağacını oku. Boş belgeye ReproCase denemesi yaz; kaydetme.” Görsel: “Yalnızca bu deneme penceresinin ekran görüntüsünü al ve hangi düğmeleri gördüğünü söyle.”

Güvenlik: “Mevcut vakanın rollerini, sahiplik ilişkilerini ve kanıt kuralını açıkla. Eksik önkoşulları listele.” Rapor: “Son çalışmayı özetle; gözlenen sonuçlarla varsayımları ayrı belirt. Henüz dışarı gönderme.”

Bir seferde tek küçük görevle başla. Araç çıktılarını gördükçe bir sonraki adımı ekle. Modelin yapabildikleri seçilen sağlayıcıya, araç desteğine ve verdiğin yerel izinlere bağlıdır.

## 22. Program kapsamı, hız ve durdurma

Bug Bounty Center → Program & Scope bölümünde programı adlandır. Host kuralı örneği: *.example.com. Bu uygulamada bu kural example.com alanını da kapsar. URL kuralı örneği: https://api.example.com/v2/*. Bu kural yalnız belirtilen protokol, port ve yol içindir; /admin veya başka porta izin vermez. Hariç tutulan kurallar önce uygulanır.

En fazla istek/saniye değeri aynı programın yönetilen taramalarında paylaşılır. Kapsam dışı istek gönderilmez; yönlendirme otomatik takip edilmez. Yol kapsamlı programda kök origin taraması engellenebilir; bu durumda kapsamı genişletmek yerine uygun vaka adımlarını kullan.

Oturumluk HTTP başlıkları JSON ile eklenebilir. Bunlar bellekte kalır; model çıktısına veya yeni program veritabanı kayıtlarına yazılmaz. Uygulamayı yeniden açınca tekrar girmen gerekir. Eski yedeklerde daha önce kaydedilmiş bilgiler kalabilir.

Ağ taramalarını durdur düğmesi yönetilen keşfi iptal eder. Ctrl+Alt+Esc agent ve taramaları durdurur. Başlamış sunucu değişiklikleri geri alınmaz. Terminal ve dış MCP araçları bu hedef politikalarından bağımsız işlem yapabilir. Sınırsız modu seçmek bilgisayarı izole etmez.

## 23. Kanıt testi ile istek taslağını ayır

Asıl taşınabilir kanıt .reprocase.json paketidir. Alıcı kendi hesaplarını bağlar ve aynı çekirdekte yeni kaynaklarla çalıştırır. Yanlış hesap veya başarısız hazırlık sonuç belirsizdir; açık yeniden üretildi diye gösterilmez.

Playwright export dosyasını ReproCase kaynak kurulumundaki tests/e2e klasörüne koy. npm ci sonrasında REPROCASE_APPROVE_REVISION değerini incelenen vaka sürümüne ayarla; test hesabı token/cookie değerlerini ortam değişkenlerinden ver. Dosyanın başındaki açıklama ve docs/EXPORTS.md ayrıntıları gösterir. Varsayılan beklenen sonuç reproduced; güvenli sürüm için REPROCASE_EXPECT_VERDICT=not_reproduced seç.

Bütün cevapların 403 olması tek başına başarılı test değildir. Kimlik veya hazırlık eksikse test hata verir. Hurl çıktısı ise yalnız HTTP istek taslağıdır; güvenlik doğrulaması içermez. Hurl yeşil çıkışını kanıt sayma.