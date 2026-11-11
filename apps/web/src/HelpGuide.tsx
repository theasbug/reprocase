import { useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import type { Lang } from './i18n.ts';

// Keep the manual in the source tree: no remote content or tracking is loaded.
type Chapter = [string, string, string, string[], string[]];
export const guide: Chapter[] = [
  ['start', '1. ReproCase ne işe yarar?', '1. What is ReproCase?', [
    'Bir güvenlik açığı bulduğunu düşün. Sadece “bu adreste açık var” demek yerine, başka bir kişinin kendi test hesaplarıyla aynı durumu kontrol edebilmesini istiyorsun. ReproCase bu deneyi bir vakaya dönüştürür: hesaplar, kaynaklar, istekler, hazırlık ve kanıt birlikte tanımlanır.',
    'Örnek: Ayşe bir not oluşturur. Normalde yalnızca Ayşe okuyabilmelidir. Mehmet kendi hesabıyla bu notu okuyabiliyorsa, uygulamada erişim kontrolü sorunu olabilir. ReproCase yeni bir not ve yeni hesaplarla bu iddiayı sınar. HTTP 200 gelmesi tek başına kanıt değildir; yeni notun ayırt edici içeriği de görülmelidir.',
    'AI Assistant bu çalışma alanındaki yardımcı agent’tır. Dosya okuyabilir, kod yazabilir, komut çalıştırabilir ve Windows uygulamalarını kullanabilir. Güvenlik sonucunu ise vaka kuralları hesaplar. Önce yerel demoyu denemek öğrenmenin en kolay yoludur.'
  ], [
    'Imagine finding a security issue. You want another person to check it with their own test accounts. ReproCase turns that experiment into a case containing accounts, resources, requests, setup steps and evidence.',
    'Example: Alice creates a private note. Bob should not be able to read it. If Bob reads the unique content of a newly created note, there may be an access control issue. HTTP 200 alone is not proof. ReproCase repeats the experiment with fresh accounts and resources.',
    'AI Assistant is your agent in this workspace. It can read files, edit code, run commands and use Windows applications. Explicit case rules determine the security verdict. Start with the local demo to learn the workflow.'
  ]],
  ['install', '2. ZIP’i aç ve ilk kez çalıştır', '2. Extract and start', [
    'Windows ZIP dosyasına sağ tıkla ve Tümünü ayıkla seçeneğini kullan. ReproCase.exe’yi ZIP’in içinden çalıştırma. Çıkartılan klasördeki exe’yi aç. Node.js, Python veya Docker kurman gerekmez; bu sürüm gerekli çalışma ortamını ve Chromium’u içerir.',
    'Uygulama yerel bilgisayarında çalışır. ReproCase-data klasörü exe’nin yanında oluşur. Vakalar, sohbetler, ayarlar ve yedekler buradadır. Klasörü silersen kayıtlarını kaybedersin. Yeni sürüme geçerken uygulamayı kapatıp bu klasörün yedeğini al; eski sürümü ayrı tut.',
    'Arayüzün üstündeki dil düğmesiyle Türkçe ve İngilizce arasında geçebilirsin. Tema düğmesi görünümü değiştirir. AI Assistant düğmesi sohbeti açar; Çalışma alanı düğmesi vakalara döndürür.'
  ], [
    'Right-click the Windows ZIP and choose Extract All. Run ReproCase.exe from the extracted folder, rather than inside the archive. You do not need Node.js, Python or Docker for the bundled app. Its runtime and Chromium are included.',
    'ReproCase runs locally. ReproCase-data appears beside the executable and contains cases, chats, settings and backups. Keep this folder. Before upgrading, close the app and back it up; retain the previous version separately.',
    'Use the language button at the top for Turkish or English, and the theme button to change appearance. AI Assistant opens chat. Workbench returns to your cases.'
  ]],
  ['provider', '3. Sağlayıcı ve API anahtarı', '3. Provider and API key', [
    'Sağlayıcı, modeli çalıştıran hizmettir. AI Assistant → Sağlayıcılar ve API anahtarları bölümüne gir. Normal modda sadece sağlayıcıyı seç ve API anahtarını yapıştır. Kaydet ve modelleri bul düğmesine bas. API anahtarı bir şifre gibidir: herkese açık GitHub dosyalarına, ekran görüntülerine veya raporlara ekleme.',
    'OpenAI, Anthropic, Gemini, DeepSeek, OpenCode Go/Zen ve listelenen diğer hizmetlerin adresleri hazırdır. Kendi sunucun, Ollama veya farklı bir uç noktan varsa gelişmiş/özel sağlayıcı modunu seç. Burada Base URL ve API protokolü de belirtilir. Base URL genellikle /v1 ile biter; /chat/completions kısmını ayrıca ekleme.',
    'Model bulunması, modelin her isteğe cevap verebileceği anlamına gelmez. Ücret, kota, bölge ve erişim hesabına bağlıdır. Windows sürümünde kaydedilen anahtarlar Windows şifrelemesiyle saklanır. Bu şifreleme mevcut Windows kullanıcısına bağlıdır; başka bilgisayara taşırken anahtarı yeniden girmen gerekebilir.'
  ], [
    'A provider runs the model. Open AI Assistant → Providers & API keys. In normal mode, choose a provider and paste its API key. Save and discover models. Treat an API key like a password: keep it out of public repositories, screenshots and reports.',
    'Presets include OpenAI, Anthropic, Gemini, DeepSeek and OpenCode Go/Zen. Choose the advanced/custom mode for your own server or another endpoint. That mode also asks for a Base URL and protocol. Usually the Base URL ends in /v1; do not append /chat/completions yourself.',
    'Discovering a model does not guarantee inference access. Pricing, quota, region and permissions depend on your provider account. On Windows, saved keys use Windows encryption tied to the current user. You may need to enter keys again on another computer.'
  ]],
  ['models', '4. Model, akıl yürütme ve görme', '4. Models, reasoning and vision', [
    'Mesaj kutusunun altındaki Model düğmesine bas. Sağlayıcı ve model adları arasında arama yapabilirsin. İstediğin modele tıkla. Akıl yürütme kutusu model seçme düğmesinden farklıdır. Model bu ayarı desteklemiyorsa kutunun pasif görünmesi normaldir.',
    'Otomatik, sağlayıcının varsayılanını kullanır. Desteklenen düşük/yüksek gibi seviyeler modelin harcadığı çabayı etkileyebilir; süre ve maliyet değişebilir. Çalışma sürerken model değiştirilmez. Önce işi durdur veya tamamlanmasını bekle.',
    'Ekran görüntülerini anlayabilmek için görüntü girdisi destekleyen bir model gerekir. Metin modeli yine pencere listesi, erişilebilirlik ağacı, terminal ve dosyaları kullanabilir; çekilen resim kullanıcıya gösterilir. Sağlayıcı keşfi görme yeteneğini bildirmiyorsa modelleri yenilemeyi dene. Araç çağırma desteği de modelden modele değişir.'
  ], [
    'Click Model below the message box. Search by provider or model name, then select an entry. Reasoning is a separate control. A disabled reasoning control simply means the selected model does not advertise adjustable effort.',
    'Auto uses the provider default. Supported effort levels can affect time and cost. The model stays fixed during a running task. Stop the task or wait for it to finish before switching.',
    'Understanding screenshots requires a model with image input. Text models can still use window lists, accessibility trees, terminal and files; captured images remain visible to you. Refresh discovery if vision capabilities are missing. Tool-calling support also varies by model.'
  ]],
  ['firstchat', '5. İlk sohbet ve basit bir deneme', '5. Your first conversation', [
    'Yeni oturum aç. “Selam, bu çalışma ortamında hangi araçların var?” yaz. Sonra “Çalışma klasörünü listele ve burada bir plan.md dosyası varsa oku” diyebilirsin. Dosya okumak için dosya adını bilmek yeterlidir; başka klasördeyse tam yolu belirt.',
    'Windows’ta “Notepad’i aç” dediğinde agent gerçek uygulama açma aracını kullanabilir. “Notepad penceresini bul, içini incele ve boş belgeye Merhaba yaz” bilgisayar kontrolünü dener. Gelen işlem kartında ne istendiğini görüp izin ver. Önce deneme için boş bir belge kullan.',
    'Ataş düğmesi bir metin dosyasının içeriğini mesaja ekler; dosyanın tamamı modele gönderilir. Vaka ekle seçeneği mevcut vaka tanımını bağlama ekler. Bir dosyanın adını yazmak otomatik ek yapmak değildir; agent dosya aracını kullanmalıdır.'
  ], [
    'Start a new session and ask: “Hello, which tools do you have in this environment?” Then try: “List the working directory and read plan.md if it exists.” Give a full path for files outside that directory.',
    'On Windows, “Open Notepad” can launch the real app. “Find the Notepad window, inspect it and type Hello into the blank document” exercises computer control. Review the requested action card and allow it. Start with a blank test document.',
    'The paperclip attaches a text file’s contents to your message, which sends those contents to the model. Add case includes the current case definition. Mentioning a filename alone does not attach it; the agent needs to read it with a tool.'
  ]],
  ['workspace', '6. Çalışma klasörü, dosyalar ve yedekler', '6. Working directory and files', [
    'Araçlar ve ortam bölümündeki Klasör seç düğmesi agent’ın çalışma klasörünü değiştirir. Başlangıçta ReproCase-data/projects kullanılır. Bir proje üzerinde çalışacaksan o projenin klasörünü seç. /workspace aynı bölümü açar.',
    'Agent klasör listeleyebilir, metin okuyabilir, metin arayabilir ve dosya yazabilir. Mevcut dosyayı değiştirmeden önce okur; yazma aracı içerik özetini kontrol ederek arada değişmiş dosyanın üstüne yazmayı engeller. Değiştirilen mevcut dosyanın önceki hali ReproCase-data/backups altında tutulur.',
    'Çalışma klasörü dışındaki dosyalara erişim ayrıca izin ister. Yalnızca seçtiğin klasörün agent için anlamlı bir sınır olmasını bekle; terminal ve bilgisayar araçlarına izin verirsen bunlar daha geniş işlem yapabilir. Yedek, geri alma düğmesi değildir: geri yükleme için dosyayı inceleyip önceki içeriği açıkça geri yazdır.'
  ], [
    'Choose folder under Tools & environment to set the agent working directory. The default is ReproCase-data/projects. Select your project folder before working on it. /workspace opens the same panel.',
    'The agent can list, read, search and write text files. It reads an existing file before editing; a content hash prevents overwriting a file that changed meanwhile. Previous contents are backed up under ReproCase-data/backups.',
    'Access outside the working directory requests permission. Terminal and computer permissions can allow broader actions. A backup is not an automatic undo: inspect it and explicitly restore the earlier contents when needed.'
  ]],
  ['permissions', '7. İşlem kartları ve izinler', '7. Actions and permissions', [
    'AI bir işlem yaptığında sohbette araç kartı görünür. Kartı açınca kullanılan araç, girdiler ve gerçek sonuç görünür. Hata kartı, işlemin başarılı olduğu anlamına gelmez. Agent’ın yazdığı özetten önce araç çıktısını kontrol edebilirsin.',
    'İzin gerektiren kartlarda Bir kez izin ver, Bu araç: oturum boyunca ve Reddet seçenekleri vardır. Bilgisayar araçlarında Bilgisayar: oturum boyunca seçeneği bütün desktop_ araçlarına aynı sohbet için izin verir. Agent bu düğmelere kendi adına basamaz.',
    'Terminal komutunu ve MCP aracı girdisini çalışmadan önce incele. Oturumluk izinleri yalnızca amaçladığın çalışma sırasında ver. Yeni sohbet ayrı bir izin kapsamıdır. Stop işlemi bekleyen izinleri de kapatır.'
  ], [
    'Each action appears as a tool card. Expand it to inspect the tool, arguments and actual output. An error card is not a successful action. You can check tool evidence before trusting a written summary.',
    'Permission cards offer Allow once, This tool: for this session, and Deny. Computer tools also offer Computer: for this session, covering desktop_ tools in that chat. The agent cannot approve its own request.',
    'Review terminal commands and MCP arguments before execution. Grant session permissions for the work you intend. A new chat has separate permissions. Stop also dismisses pending requests.'
  ]],
  ['computer', '8. Bilgisayar kontrolü nasıl çalışır?', '8. Computer control', [
    'Windows sürümünde pencere ve ekran listesi, ekran görüntüsü, pencere odaklama/taşıma/boyutlandırma, küçültme/büyütme, fare hareketi/tıklama/sürükleme/kaydırma, klavye ve metin panosu araçları bulunur. Erişilebilirlik aracı uygulamanın düğme ve alanlarını metin olarak okuyabilir; desteklenen öğeleri çalıştırabilir veya değer yazabilir.',
    'Fare işlemleri yeni çekilmiş ekran görüntüsüne bağlanır. Agent resimdeki piksel koordinatlarını verir, uygulama bunları gerçek ekran koordinatına çevirir. Pencere taşındıysa veya görüntü eskidiyse tekrar görüntü gerekir. Agent mümkün olduğunda tüm ekran yerine ilgili pencereyi yakalar.',
    'Bilgisayar kullanılırken fareyi ve klavyeyi aynı anda başka amaçla kullanmak odağı değiştirebilir. Acil durdurma: Ctrl + Alt + Esc. UAC onay ekranı veya daha yüksek yetkili uygulamalar Windows tarafından engellenebilir. Bu sürüm bu engelleri aşmaz. Linux bilgisayar kontrolü henüz uygulanmadı.',
    'Ekran görüntüsü görebilen model, yakalanan görüntüyü sağlayıcısına gönderir. İlgisiz özel pencereleri kapat veya yalnızca deneme penceresini hedef göster. Görüntüler ReproCase-data/screenshots içinde ve sohbetin araç kartında tutulur.'
  ], [
    'Windows tools cover windows and monitors, screenshots, focus/move/resize/minimize/maximize, pointer movement/click/drag/scroll, Unicode typing, key chords and the text clipboard. Accessibility can inspect controls and invoke, select, toggle or set values on supported elements.',
    'Mouse actions reference a recent screenshot. Image pixels are translated to physical screen coordinates. Moving a window or using an old image requires a new capture. Prefer the relevant window over a full-screen capture.',
    'Using the mouse and keyboard yourself at the same time may change focus. Emergency stop: Ctrl + Alt + Esc. Windows may reject input to UAC or elevated applications. This release does not bypass those boundaries. Linux computer control is not implemented yet.',
    'For image-capable models, a captured image is sent to the chosen provider. Close unrelated private windows or target a specific test window. Images are kept in ReproCase-data/screenshots and shown in the tool card.'
  ]],
  ['terminal', '9. Terminal ve program çalıştırma', '9. Terminal and applications', [
    'terminal_run Windows’ta PowerShell kullanır ve çalışma klasöründe başlar. Agent örneğin proje dosyalarını inceleyebilir veya test komutu çalıştırabilir. Komut izin kartında görünür. Kopyalanan her komutun ne yapacağını anlamaya çalış.',
    'Komutların süre sınırı vardır. İptal, bu araç tarafından başlatılan süreç ağacını durdurmayı dener. Daha önce yazılmış dosyalar, gönderilmiş istekler veya başlatılıp bağımsızlaşmış uygulamalar otomatik geri alınmaz. Başarısı belirsiz bir değişiklik komutu kendiliğinden tekrarlanmaz.',
    'Notepad ve Hesap Makinesi için doğrudan uygulama açma aracı vardır. Başka programlar terminalle, erişilebilirlikle veya bilgisayar araçlarıyla kullanılabilir. Harici MCP sunucusunun Python/Node gibi gereksinimleri varsa bunlar ayrıca kurulmalıdır.'
  ], [
    'terminal_run uses PowerShell on Windows and starts in the working directory. The agent can inspect a project or run tests. The command appears in a permission card. Read it before allowing it.',
    'Commands have a time limit. Cancellation attempts to stop the process tree created by the tool. Files already written, requests already sent, and detached applications are not rolled back. An uncertain changing action is not automatically repeated.',
    'There are direct launch shortcuts for Notepad and Calculator. Other applications can be used through terminal, accessibility or computer tools. External MCP servers may require separately installed runtimes such as Python or Node.'
  ]],
  ['steering', '10. Çalışırken mesaj gönder ve durdur', '10. Steer and stop a running agent', [
    'Agent çalışırken mesaj yazıp Gönder’e basabilirsin. Mesaj “Sırada” olarak görünür. Agent mevcut model yanıtını veya başlamış aracı tamamladıktan sonraki işlem sınırında mesajı alır. Yeni yönlendirme bekleyen izinleri kapatır ve henüz başlamamış eylemler yeniden planlanır.',
    'Örneğin “Dosyayı silme, yalnızca içeriğini göster” yazabilirsin. Ancak çoktan başlamış bir işlemi mesaj göndermek geri almaz. Acil durumda kare Durdur düğmesine veya Ctrl + Alt + Esc’ye bas. Sıraya alınmış mesajlar da iptal edilir.',
    'Aynı anda farklı oturumlar açık olabilir. Fakat bilgisayar tek fare ve tek klavyedir; fiziksel masaüstünde agent görevlerini sırayla yürüt. Uzun bir görevde geçmişten ilgili oturumu açarak durumunu izleyebilirsin.'
  ], [
    'You can send another message while the agent works. It appears as Queued. The agent receives it at the next action boundary after the current model reply or tool finishes. New steering dismisses pending permissions and replans actions that have not started.',
    'For example, send “Do not delete the file; only show its contents.” A message cannot undo an action already started. Use the square Stop button or Ctrl + Alt + Esc for an urgent stop. Queued messages are cancelled too.',
    'Sessions can run independently, but the desktop has one pointer and keyboard. Run physical desktop tasks sequentially. Open a session from history to inspect a longer task.'
  ]],
  ['thinking', '11. Düşünme, token ve hız', '11. Reasoning, tokens and speed', [
    'Sağlayıcı modelin düşünme metnini veya reasoning özetini döndürürse Düşünme bölümünde görürsün. Bazı sağlayıcılar yalnızca kısa özet döndürür; bazıları hiçbir düşünme alanı göndermez. Uygulama eksik metni üretmez ve şifreli iç düşünceyi çözmeye çalışmaz.',
    'Yanıtın altındaki istatistikler fareyle üzerine gelince belirginleşir; klavyeyle de odaklanabilir. Girdi/çıktı token sayısı, toplam süre ve tok/s gösterilir. Token, metnin model tarafından işlenen küçük parçasıdır; bir token her zaman bir kelime değildir.',
    'Hız, sağlayıcının bildirdiği çıktı tokenlarının model isteği süresine bölünmesiyle hesaplanır. Araç ve izin bekleme süresi paydadan çıkarılır; ilk yanıt beklemesi dahildir. Sağlayıcı kullanım sayısı göndermezse tahmini sayı gösterilmez. Birden çok araç turunun kullanımı birleştirilir.'
  ], [
    'If the provider returns reasoning text or a summary, it appears under Reasoning. Some providers return a short summary; others return none. The app does not invent missing text or decode encrypted internal reasoning.',
    'Hover over a reply footer or focus it with the keyboard to inspect input/output tokens, elapsed time and tok/s. A token is a small unit processed by the model; it is not always a whole word.',
    'Speed is provider-reported output tokens divided by model request time. Tool execution and permission waits are excluded; initial response latency is included. Missing usage is shown as unreported rather than estimated. Usage from multiple tool rounds is combined.'
  ]],
  ['commands', '12. / komutları', '12. Slash commands', [
    'Mesaj kutusuna / yazınca komut menüsü açılır. /help bu kılavuzu, /mcp bağlantıları, /model model seçimini, /workspace ve /tools ortamı açar. /new yeni sohbet başlatır; /stop mevcut işi durdurur.',
    '/plan araştırma planı, /scope hedef kapsamı, /case vaka taslağı, /repro yeniden üretim adımları, /compare karşılaştırma, /report rapor taslağı için mesaj başlangıcı hazırlar. /read dosya okuma, /terminal komut çalıştırma ve /computer masaüstü görevi için örnek istek hazırlar. Boş yerleri doldurup Gönder’e bas.',
    'Komut menüsü bir kısayoldur; yazdığın görev normal agent araçlarına ve izinlere gider. /report sonucu otomatik yayımlamaz. /scope çalıştırma hedeflerini otomatik genişletmez. Vaka hedefleri ayrıca seçilir ve çalışma planında onaylanır.'
  ], [
    'Type / in the composer to open the command menu. /help opens this guide; /mcp opens connections; /model opens models; /workspace and /tools open the environment. /new starts a chat; /stop cancels the current task.',
    '/plan, /scope, /case, /repro, /compare and /report prepare prompts for research plans, scope, cases, reproduction, comparisons and reports. /read, /terminal and /computer prepare file, command and desktop tasks. Fill in the details and send.',
    'Commands are shortcuts to normal agent tasks and permissions. /report does not publish a report. /scope does not expand run targets automatically. Choose targets separately and approve them in the run plan.'
  ]],
  ['mcp', '13. MCP ekle ve yönet', '13. Add and manage MCP', [
    'MCP, agent’a başka programların araçlarını bağlayan ortak bir bağlantı biçimidir. /mcp yaz veya MCP düğmesini aç. Sunucu adı ver. Yerel program için stdio seçip komutu ve her satıra bir argüman yaz. Uzak hizmet için HTTP seçip MCP uç noktasını gir.',
    'Örnek yerel komut: npx. Argümanlar ayrı satırlarda olabilir: -y, @modelcontextprotocol/server-filesystem ve izin vereceğin klasörün tam yolu. Bu örnek harici paketi indirip çalıştırır; önce kaynağını incele. Kaydet bağlantıyı kaydeder; programı başlatmak için ayrıca Bağlan’a basmalısın.',
    'Gerekirse ortam değişkenlerini veya HTTP başlıklarını JSON olarak gir: {"API_KEY":"..."} veya {"Authorization":"Bearer ..."}. Windows’ta yapılandırma şifrelenir. Kaydedilen gizli değerler yönetim ekranından geri okunmaz. Sunucuyu değiştirmek için bağlantısını kes; sonra yeniden tanımla.',
    'Bağlanınca araç adlarını ve durumunu görürsün. Agent bu araçları mevcut araçlarıyla birlikte seçebilir. Harici araç çağrıları da işlem kartı ve izin mekanizmasını kullanır. Bağlantıyı kes sunucuyu durdurur; Sil kaydı da kaldırır. Bu sürüm stdio ve Streamable HTTP içindir; eski SSE ve OAuth akışları bu ekranda desteklenmez.'
  ], [
    'MCP is a standard way to connect other programs’ tools to the agent. Type /mcp or open MCP. Name the server. For a local program choose stdio, enter its command and one argument per line. For a remote service choose HTTP and enter its MCP endpoint.',
    'Example command: npx. Separate argument lines might be -y, @modelcontextprotocol/server-filesystem, and the full directory you want to allow. This example downloads and runs an external package; inspect its source first. Save stores a configuration. Connect is a separate, explicit action that starts it.',
    'If needed, enter environment variables or HTTP headers as JSON, such as {"API_KEY":"..."} or {"Authorization":"Bearer ..."}. Windows encrypts the configuration. Saved secret values are not returned to this screen. Disconnect before changing or replacing a server.',
    'Connected tools appear with status and names. The agent can choose them alongside built-in tools; calls use the same action cards and permission system. Disconnect stops the connection, and Remove deletes its configuration. This release supports stdio and Streamable HTTP, not legacy SSE or OAuth setup.'
  ]],
  ['demo', '14. Yerel demo: ilk güvenlik deneyi', '14. Local demo: first experiment', [
    'Çalışma alanına dön ve yerel demoyu başlat. Demo kendi bilgisayarında açılır; gerçek bir müşteri sistemi gerekmez. Demodaki test hesaplarını rollerine bağla. Hesapların birbirinden farklı olduğunu ve kimin hangi kaynağa sahip olduğunu kontrol et.',
    'Yeni çalışma planını aç. Hedefin yerel demo adresi olduğuna bak. Hazırlık adımları yeni kaynak oluşturur; test başka hesapla erişim dener; doğrulama ayırt edici içeriği kontrol eder. Planı onayla ve çalıştır. Zaman çizelgesinde her adımı incele.',
    'Demoyu güvenli moda alıp tekrar çalıştır. Hazırlık doğruysa aynı paket bu kez Yeniden üretilemedi sonucu vermelidir. Bu, güvenli davranış ile bozuk hazırlığı ayırmayı öğretir. Sonuçları Karşılaştır görünümünde yan yana incele.'
  ], [
    'Return to Workbench and start the local demo. It runs on your computer without a customer system. Bind the test accounts to the case roles. Check that identities are distinct and ownership is correct.',
    'Open a fresh run plan and verify its target is the local demo. Setup creates a new resource, the test tries access as another account, and verification checks its unique content. Approve the plan, run it and inspect each timeline step.',
    'Switch the demo to secure mode and repeat. With correct setup, the same package should report Not reproduced. Compare the runs to understand the difference between a fixed issue and invalid preparation.'
  ]],
  ['cases', '15. Kendi vakanı oluştur veya içe aktar', '15. Create or import a case', [
    'Yeni vaka sihirbazında vakaya ad ver, hedef API kaynağını belirt, hesap rollerini ve beklenen erişim kuralını yaz. Rol bir insan adı olmak zorunda değildir: owner ve other gibi isimler kullanabilirsin. Senaryo yeni hesaplara geçince de aynı ilişkiyi korumalıdır.',
    'HAR, ham HTTP veya seçili Chromium trafiğini içe aktarabilirsin. İçe aktarma tek başına ağ isteği çalıştırmaz. Kaydedilen eski cookie, token ve nesne ID’lerini paylaşılacak paket için bağımlılıklara dönüştür. AI önerilerini uygulamadan önce incele.',
    'Hazırlık, test, doğrulama ve temizlik ayrı adımlardır. Yeni kaynağın ID’sini JSON Pointer ile yanıttan çıkar. Değişkeni URL yolu, başlık veya JSON gövdesindeki açık konuma bağla. Rastgele metin değişimi veya paket içine JavaScript/shell eklemek desteklenmez.'
  ], [
    'Use the new case wizard to name the case, set its API origin, describe account roles and state the expected access policy. Roles can be owner and other. The relationships should retain their meaning with new accounts.',
    'Import HAR, raw HTTP or selected Chromium traffic. Importing alone sends no network requests. Replace old cookies, tokens and object IDs with explicit dependencies before sharing. Review AI suggestions before applying them.',
    'Separate setup, test, verification and cleanup. Extract a fresh resource ID from JSON with a JSON Pointer, then bind it to an explicit path, header or JSON-body location. Arbitrary text substitution and executable JavaScript or shell inside packages are unsupported.'
  ]],
  ['accounts', '16. Hesap, kurum, MFA ve CSRF', '16. Accounts, organizations, MFA and CSRF', [
    'Her rol kendi bağımsız Chromium bağlamını kullanır. Kullanıcı girişi açarak kendin giriş yapabilirsin. Giriş yardımı seçersen MFA veya CAPTCHA gerektiğinde kontrol sana geçer; tamamladıktan sonra aynı oturumla devam edilir.',
    'Doğrudan bağlantı deneysel seçenektir: cookie, Bearer token veya tanımlı HTTP giriş tarifi kullanılır. Başarılı bağlantı tek başına doğru rol demek değildir. Kimlik uç noktasının gözlediği kullanıcı, rol ve kurum ile beklenen koşulları karşılaştır.',
    'İki ayrı role aynı hesabı bağlamak veya yanlış kurumu seçmek bulgunun sonucunu bozar. Önkoşullar bu durumu ayırır. CSRF gibi dinamik değerleri eski kayıttan kopyalama; hazırlık yanıtından çıkarıp ilgili başlığa/gövdeye bağla. Oturum yenilenince kimlik değişirse çalışma durmalıdır.'
  ], [
    'Each role has its own isolated Chromium context. Open a login window and sign in yourself. Assisted login hands control back for MFA or CAPTCHA and continues in the same session afterwards.',
    'Direct binding is experimental and supports cookies, Bearer tokens or a defined HTTP login recipe. A connected session is not necessarily the correct role. Compare observed user, role and organization against the case requirements.',
    'Binding the same account twice or selecting a wrong organization invalidates the experiment. Preconditions separate those failures. Extract fresh CSRF values from setup responses rather than copying old values. A changed identity after session refresh must stop the run.'
  ]],
  ['verdicts', '17. Sonuçları doğru oku', '17. Read the verdict correctly', [
    'Yeniden üretildi: gerekli önkoşullar sağlandı ve senaryoda tanımlanmış ihlal göstergesi gözlendi. Örnek: diğer hesap yeni oluşturulan özel notun benzersiz içeriğini okudu.',
    'Yeniden üretilemedi: önkoşullar sağlandı, test tamamlandı ve ihlal göstergesi oluşmadı. Bu sonuç yalnızca tanımladığın deneyi kapsar; uygulamanın tamamının güvenli olduğuna dair genel garanti değildir.',
    'Sonuç belirsiz: yanlış hesap, eksik hazırlık, zaman aşımı, ağ hatası veya eksik kanıt değerlendirmeyi engelledi. Bunu “açık kapandı” diye raporlama. Zaman çizelgesindeki ilk başarısız önkoşulu düzeltip yeni çalışma başlat.',
    'Değişiklik yapan istek belirsiz bir ağ hatasıyla kesilirse uygulama onu otomatik tekrarlamaz. Önce kaynak oluşmuş mu kontrol et; sonra nasıl devam edeceğine karar ver. Temizlik adımlarını da çıktılarıyla incele.'
  ], [
    'Reproduced means required preconditions passed and the defined violation witness was observed, for example another account reading the unique contents of the new private note.',
    'Not reproduced means setup was valid, the test completed, and its witness was absent. It describes this experiment, not a guarantee that the entire application is secure.',
    'Inconclusive means a wrong account, missing setup, timeout, network failure or insufficient evidence blocked evaluation. Do not report this as a fix. Resolve the first failing precondition and start a new run.',
    'A changing request interrupted by an uncertain network error is not automatically retried. Check whether its resource was created before choosing the next action. Inspect cleanup outputs too.'
  ]],
  ['export', '18. Rapor, paylaşım ve karşılaştırma', '18. Reports, sharing and comparison', [
    'İki çalışmayı Karşılaştır bölümünde seç. Aynı vaka sürümü ve farklı hesaplarla tekrarları incelemek, eski ID’lere bağlı kalmadığını göstermeye yardımcı olur. Güvenli sürümle yapılan karşılaştırma ihlal göstergesinin yanlış pozitif üretip üretmediğini sınar.',
    'Dışa aktar bölümünde temizlenmiş .reprocase.json paketini ve HTML/Markdown raporunu incele. Bilinen sırlar temizlenir; yine de tanınmayan özel veriler olabilir. Paylaşmadan önce içeriği kendin kontrol et. Yerel hesap bağlantıları paylaşılabilir pakete dahil edilmez.',
    'AI sohbeti veya masaüstü ekran görüntüsü otomatik olarak güvenlik kanıtı sayılmaz. Vaka çalışmasının gözlemlerini rapora bağla. Raporu araştırma programının istediği kanaldan kendin paylaş; uygulama senin adına otomatik gönderim yapmaz.'
  ], [
    'Choose two runs under Compare. Repeats with different accounts help demonstrate independence from old object IDs. A secure-version comparison tests whether the witness incorrectly produces a positive result.',
    'Preview the sanitized .reprocase.json package and HTML/Markdown report under Export. Known secrets are removed, but unknown private data can remain; review the contents yourself. Local account bindings stay outside the shareable package.',
    'AI chat or a desktop screenshot is not automatically security proof. Connect report claims to observations from the case run. Share through your research program’s chosen channel yourself; the app does not automatically send it.'
  ]],
  ['prompt', '19. Agent bağlamı ve görevi', '19. Agent context and mission', [
    'Agent’ın temel görev tanımı prompts/AGENT.md dosyasındadır. Araçlar ve ortam bölümünde kullanılan promptu görebilir ve yerel bir kopyasını düzenleyebilirsin. Varsayılana dön kaydedilmiş düzenlemeyi sıfırlar. Değişiklik yeni başlayan model isteklerine uygulanır; mevcut çalışmayı durdurup yeni mesajla denemek daha anlaşılırdır.',
    'Prompt, ReproCase’i ve bug bounty/yazılım geliştirme görevini tanıtır; gerçek işletim sistemi, çalışma klasörü ve araç listesi de her çalışma başında eklenir. Dosya veya program erişimi olan bir agent olduğunu bilir. Sağlayıcının ve seçilen modelin kendi davranış kuralları ayrıca geçerlidir.',
    'Okunan dosyalar, web sayfaları ve araç çıktıları veri olarak değerlendirilir. Bir belgenin içinde “önceki talimatları unut” yazması kullanıcı talimatı değildir. Agent yine de hata yapabilir; önemli işlemlerin girdisini ve çıktısını incele.'
  ], [
    'The agent mission lives in prompts/AGENT.md. Tools & environment shows the active prompt and lets you save a local override. Reset to default removes that override. For a clear test of changes, stop a running task and send a new message.',
    'The prompt introduces ReproCase, bug bounty research and software development. Actual OS, working directory and available tools are added for each task. The agent knows it has file and application tools. The chosen provider and model retain their own behavior rules.',
    'Files, pages and tool outputs are treated as data. A document saying “ignore previous instructions” is not a user instruction. Models can still make mistakes; inspect important action inputs and outputs.'
  ]],
  ['errors', '20. Yaygın hatalar ve çözümü', '20. Common errors', [
    '401: API anahtarını ve doğru sağlayıcıyı kontrol et. 403: model/hesap yetkisi veya bölge sınırı olabilir. 429: kota, bakiye veya hız sınırı; sağlayıcı panelini kontrol et ve bekle. 400: protokol veya desteklenmeyen model ayarı olabilir. OpenCode yönlendirme için oturum başlığı uygulama tarafından eklenir.',
    'Provider connection failed / fetch failed: interneti, VPN/proxy’yi ve sertifika ayarlarını kontrol et. Windows masaüstü sürümü sağlayıcı isteklerinde Electron’un ağ katmanını kullanır. Sertifika doğrulaması kapatılmaz. Aynı hata yalnızca tek sağlayıcıdaysa hizmet tarafını da kontrol et.',
    'Yerel servise bağlanılamadı: uygulamanın açık olduğuna bak; kapatıp yeniden aç ve aynı oturumu geçmişten seç. Kesilmiş yanıt tamamlandı diye gösterilmez. Kısmi çıktı kalır; mesaj üretimi veya değişiklik yapan araç otomatik yeniden denenmez.',
    'Araç yok / araç çağırma başarısız: modelin araç desteğini Bağlantıyı test et ile kontrol et. MCP aracı yoksa Bağlandı durumuna ve sunucu çıktılarına bak. Windows odağı reddederse hedef pencereyi görünür yapıp tekrar dene. Hata raporuna anahtar ekleme; sürüm, araç adı ve temizlenmiş hata yeterlidir.'
  ], [
    '401: check the key and provider. 403: check model permissions or regional access. 429: inspect quota, balance and rate limits in the provider dashboard. 400: check the protocol and supported model settings. OpenCode session routing headers are added by the app.',
    'Provider connection failed / fetch failed: check internet, VPN/proxy and certificates. The Windows desktop app uses Electron networking for provider requests. Certificate validation remains enabled. If only one provider fails, check that service too.',
    'Local service unavailable: verify the app is open, restart it if necessary, and reopen the session from history. A truncated reply stays incomplete. Partial output is retained; generation and changing actions are not automatically retried.',
    'Missing or failing tools: use Test connection to check model tool support. For MCP, verify Connected status and server requirements. If Windows refuses focus, make the target window visible and retry. Share version, tool name and sanitized errors in a bug report, without keys.'
  ]],
  ['recipes', '21. Kopyalayıp deneyebileceğin görevler', '21. Tasks to try', [
    'Dosya: “Çalışma klasöründeki plan.md dosyasını oku. İlk üç adımı açıkla. Henüz dosya değiştirme.” Kod: “Bu projede test komutunu bul, komutu göster ve izin verdiğimde çalıştır.”',
    'Masaüstü: “Notepad’i aç. Penceresini bul ve erişilebilirlik ağacını oku. Boş belgeye ReproCase denemesi yaz; kaydetme.” Görsel: “Yalnızca bu deneme penceresinin ekran görüntüsünü al ve hangi düğmeleri gördüğünü söyle.”',
    'Güvenlik: “Mevcut vakanın rollerini, sahiplik ilişkilerini ve kanıt kuralını açıkla. Eksik önkoşulları listele.” Rapor: “Son çalışmayı özetle; gözlenen sonuçlarla varsayımları ayrı belirt. Henüz dışarı gönderme.”',
    'Bir seferde tek küçük görevle başla. Araç çıktılarını gördükçe bir sonraki adımı ekle. Modelin yapabildikleri seçilen sağlayıcıya, araç desteğine ve verdiğin yerel izinlere bağlıdır.'
  ], [
    'Files: “Read plan.md in the working directory and explain its first three steps. Do not edit files yet.” Code: “Find this project’s test command, show it and run it after I allow it.”',
    'Desktop: “Open Notepad, find its window and inspect its accessibility tree. Type ReproCase test in the blank document without saving.” Vision: “Capture only this test window and describe its buttons.”',
    'Security: “Explain this case’s roles, ownership relationships and witness rule. List missing preconditions.” Reporting: “Summarize the last run, separating observed results from assumptions. Do not send it anywhere.”',
    'Start with one small task and extend it after checking the outputs. Capabilities depend on the provider, model tool support and the local permissions you grant.'
  ]],
["program-safety","22. Program kapsamı, hız ve durdurma","22. Program scope, rate and cancellation",["Bug Bounty Center → Program & Scope bölümünde programı adlandır. Host kuralı örneği: *.example.com. Bu uygulamada bu kural example.com alanını da kapsar. URL kuralı örneği: https://api.example.com/v2/*. Bu kural yalnız belirtilen protokol, port ve yol içindir; /admin veya başka porta izin vermez. Hariç tutulan kurallar önce uygulanır.","En fazla istek/saniye değeri aynı programın yönetilen taramalarında paylaşılır. Kapsam dışı istek gönderilmez; yönlendirme otomatik takip edilmez. Yol kapsamlı programda kök origin taraması engellenebilir; bu durumda kapsamı genişletmek yerine uygun vaka adımlarını kullan.","Oturumluk HTTP başlıkları JSON ile eklenebilir. Bunlar bellekte kalır; model çıktısına veya yeni program veritabanı kayıtlarına yazılmaz. Uygulamayı yeniden açınca tekrar girmen gerekir. Eski yedeklerde daha önce kaydedilmiş bilgiler kalabilir.","Ağ taramalarını durdur düğmesi yönetilen keşfi iptal eder. Ctrl+Alt+Esc agent ve taramaları durdurur. Başlamış sunucu değişiklikleri geri alınmaz. Terminal ve dış MCP araçları bu hedef politikalarından bağımsız işlem yapabilir. Sınırsız modu seçmek bilgisayarı izole etmez."],["In Bug Bounty Center → Program & Scope, name the program. A host rule such as *.example.com also includes example.com in this app. A URL rule such as https://api.example.com/v2/* keeps its exact scheme, port and path boundary. It does not allow /admin or another port. Exclusions win.","Maximum requests per second is shared across managed scans for a program. Out-of-scope requests are blocked and redirects are not followed. A root-origin scan can be blocked by path-only scope; use appropriate case steps instead of broadening the rules.","Optional HTTP headers are entered as JSON and held in memory. Their values stay out of model output and new program database records. Enter them again after restarting. Historical backups from older releases may still hold legacy data.","Stop network scans cancels managed reconnaissance. Ctrl+Alt+Esc stops agent tasks and scans. Already-started server changes are not undone. Terminal and external MCP tools can act outside these target policies. Autonomous mode is not computer isolation."]],
["export-proof","23. Kanıt testi ile istek taslağını ayır","23. Proof tests and request drafts",["Asıl taşınabilir kanıt .reprocase.json paketidir. Alıcı kendi hesaplarını bağlar ve aynı çekirdekte yeni kaynaklarla çalıştırır. Yanlış hesap veya başarısız hazırlık sonuç belirsizdir; açık yeniden üretildi diye gösterilmez.","Playwright export dosyasını ReproCase kaynak kurulumundaki tests/e2e klasörüne koy. npm ci sonrasında REPROCASE_APPROVE_REVISION değerini incelenen vaka sürümüne ayarla; test hesabı token/cookie değerlerini ortam değişkenlerinden ver. Dosyanın başındaki açıklama ve docs/EXPORTS.md ayrıntıları gösterir. Varsayılan beklenen sonuç reproduced; güvenli sürüm için REPROCASE_EXPECT_VERDICT=not_reproduced seç.","Bütün cevapların 403 olması tek başına başarılı test değildir. Kimlik veya hazırlık eksikse test hata verir. Hurl çıktısı ise yalnız HTTP istek taslağıdır; güvenlik doğrulaması içermez. Hurl yeşil çıkışını kanıt sayma."],["The primary portable proof is .reprocase.json. The recipient binds their own accounts and creates fresh resources through the same core. Wrong accounts or failed setup are inconclusive, not reproduction.","Place a Playwright export under tests/e2e in a ReproCase source checkout. After npm ci, set REPROCASE_APPROVE_REVISION to the reviewed revision and provide account token/cookie environment variables. The file header and docs/EXPORTS.md explain the details. Expected verdict defaults to reproduced; set REPROCASE_EXPECT_VERDICT=not_reproduced for a secure application.","All responses being 403 is not a successful proof test. Missing identity or setup fails the test. Hurl output is an HTTP request draft without security verdict assertions; a green Hurl exit is not evidence."]],
];

export function HelpGuide({lang}:{lang:Lang}) {
  const [query,setQuery]=useState('');const tr=lang==='tr';
  const matches=guide.filter(c=>[c[tr?1:2],...c[tr?3:4]].join(' ').toLocaleLowerCase(tr?'tr':'en').includes(query.toLocaleLowerCase(tr?'tr':'en')));
  return <div className="help-guide"><div className="guide-intro"><BookOpen size={26}/><h2>{tr?'ReproCase kullanım kılavuzu':'ReproCase user guide'}</h2><p>{tr?'İlk açılıştan kendi kanıt paketine, adım adım. Bölüm seç veya bir kelime ara.':'From first launch to your own evidence package, step by step. Choose a chapter or search.'}</p><label className="guide-search"><Search size={16}/><input aria-label={tr?'Kılavuzda ara':'Search guide'} placeholder={tr?'Örnek: model, Notepad, MCP, hata…':'Try: model, Notepad, MCP, errors…'} value={query} onChange={e=>setQuery(e.target.value)}/></label></div><div className="guide-layout"><nav aria-label={tr?'Kılavuz bölümleri':'Guide chapters'}>{matches.map(c=><a key={c[0]} href={`#guide-${c[0]}`} onClick={e=>{e.preventDefault();document.getElementById(`guide-${c[0]}`)?.scrollIntoView({behavior:'smooth'});}}>{c[tr?1:2]}</a>)}</nav><div className="guide-chapters">{matches.map(c=><section id={`guide-${c[0]}`} key={c[0]}><h3>{c[tr?1:2]}</h3>{c[tr?3:4].map((p,i)=><p key={i}>{p}</p>)}</section>)}{!matches.length&&<p>{tr?'Bu aramayla bölüm bulunamadı. Başka bir kelime dene.':'No chapters match. Try another word.'}</p>}</div></div></div>;
}
