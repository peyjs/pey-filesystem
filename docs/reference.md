# مرجع pey.filesystem

## هدف

افزونه پلتفرمی Pey برای دسترسی به فایل و پوشهٔ دستگاه کاربر. منطق قابل‌حمل اینجاست (فیلتر Markdown، BOM، شکل خطاها، انبار سایه)؛ پایه‌های خام پلتفرم (pickerها، چرخهٔ permission، پیمایش) پشت آداپتور محیطی است و افزونه هرگز به DOM دست نمی‌زند.

## چرخهٔ عمر

پس از غیرفعال‌شدن یا خاموشی، هر متد سرویس (حتی `getCapabilities` و pickerها) خطای `SERVICE_UNAVAILABLE` می‌دهد؛ هیچ عملیاتی پس از پایان عمر افزونه اجرا نمی‌شود. پاک‌سازی idempotent است: اشتراک رویداد `core:service-unavailable` آزاد می‌شود و گزارش خطای بحرانی پس از خاموشی ممکن نیست.

## پیکربندی لازم میزبان

روش‌های سایه (`saveShadow`/`readShadow`/`clearShadow`) روی سرویس `pey.storage.service` کار می‌کنند و آن سرویس فقط فروشگاه‌های اعلام‌شده در پیکربندی‌اش را می‌پذیرد. میزبان باید در `bootstrap.json` این فروشگاه را تعریف کند:

```json
{
  "config": {
    "pey.storage": {
      "stores": [
        { "name": "disk-drafts", "keyPath": "key" }
      ]
    }
  }
}
```

بدون این فروشگاه، `saveShadow` با `FILESYSTEM_STORAGE_UNAVAILABLE` شکست می‌خورد (علت اصلی — پیام `STORE_NOT_FOUND` از pey.storage — در `detail.cause` می‌ماند). اگر فروشگاه با `keyPath` دیگری ساخته شود، نوشتن ظاهراً موفق است اما رکورد هرگز با کلید «key» خوانده نمی‌شود — پس `keyPath` باید دقیقاً `key` باشد.

## آداپتور محیط

آداپتور داخلی افزونه است و در مانیفست `adapterType` ندارد (قاعدهٔ بنیان: `adapterType` فقط برای infrastructure). انتخاب با پیکربندی:

```json
{ "adapter": "BrowserEnvironmentAdapter", "adapterConfig": {} }
```

- **`BrowserEnvironmentAdapter`** — File System Access API + مسیر جایگزین ورودی دایرکتوری؛ `adapterConfig.scope` برای تست جایگزین global می‌شود (مقدار غیرآبجکت به global برمی‌گردد).
- آداپتور تازه (Capacitor، Tauri و…) همین شش متد را پیاده می‌کند: `capabilities`، `pickDirectory`، `pickFile`، `listEntries`، `readEntry`، `writeEntry`. (جمع‌آوری لیست تختِ فایل‌ها شکل‌دهی دادهٔ خالص است و در سرویس انجام می‌شود، نه آداپتور.) آداپتور ناشناخته/ناقص خطای startup می‌دهد (`FILESYSTEM_ADAPTER_NOT_FOUND` / `_INVALID` / `_INITIALIZATION_FAILED`).
- پیمایش `listEntries` محدود است: عمق تا ۱۶، پرش از `.git` و `node_modules`، زیرپوشهٔ ناخوانا نادیده گرفته می‌شود (ناخوانایی ریشه شکست است) و خروجی به‌ترتیب پایدار مسیر مرتب می‌شود.

## شکل ورودی (Entry)

```text
{ name: string, path: string, handle?: FileSystemFileHandle, file?: File-like, rootId?: string }
```

- `pickDirectory`/`pickFile` ورودی handleدار برمی‌گردانند (`path` همان نام ریشه است) و یک `rootId` یکتا (ویژهٔ همان انتخاب) روی آن ضرب می‌شود.
- `listDirectory` ورودی‌های handleدار با مسیر نسبی (`sub/note.md`) برمی‌گرداند.
- `collectEntries` ورودی‌های fileدار با مسیر نسبی به ریشه برمی‌گرداند: سگمنت اولِ `webkitRelativePath` (نام پوشهٔ ریشه) حذف می‌شود تا مسیرها با `listDirectory` هم‌ساز باشند.

نام Markdown یعنی پسوند یکی از `.md` / `.markdown` / `.mdown` / `.txt` (غیرحساس به حروف).

## API عمومی

- `getCapabilities()` → `{ directoryPicker, filePicker, writable }` — `writable` یعنی ورودی‌های انتخاب‌شده «می‌توانند» بازنویسی شوند؛ تلاش نوشتن ممکن است با `FILESYSTEM_PERMISSION_DENIED` رد شود.
- `pickDirectory()` / `pickFile()` — از آداپتور محیط؛ `null` وقتی picker نیست یا کاربر لغو کرد (لغو بر پایهٔ نام `AbortError` تشخیص داده می‌شود، نه نوع کلاس) — نتیجه، نه خطا.
- `listDirectory(directory)` — ورودی پوشهٔ انتخاب‌شده یا هندل خام؛ پیمایش بازگشتی در آداپتور، فیلتر Markdown در سرویس؛ لیست تخت با مسیر نسبی.
- `collectEntries(files)` — شکل‌دهی لیست تخت در سرویس؛ ورودی غیرآرایه `FILESYSTEM_READ_FAILED` می‌دهد. ورودی‌های بدون `name` بی‌صدا کنار گذاشته می‌شوند (هم‌سو با فیلتر «فقط Markdown»).
- `readEntry(entry)` — از handle (با round-trip اجازهٔ `read` در آداپتور) یا فایل ساده؛ BOM ابتدایی در سرویس حذف می‌شود؛ خروجی غیرمتنی آداپتور خطای ساختاریافته می‌دهد.
- `writeEntry(entry, content)` — از handle (با round-trip اجازهٔ `readwrite` در آداپتور). شکست `write` یا `close` شکست عملیات است و جریان abort می‌شود تا هیچ نیمه‌نوشته‌ای commit نشود؛ خطای اصلی در `detail.cause` می‌ماند. وقتی ورودی handle نوشتنی ندارد ‏`null` برمی‌گرداند تا فراخوان fallback کند (مثلاً دانلود)؛ ‏`{ name, path }` در موفقیت.
- `saveShadow(rootOrEntry, path, base, draft)` — ذخیرهٔ پیش‌نویس سایه (انبار `disk-drafts` روی `pey.storage.service`): مبنای دیسک + draft جاری؛ ‏`{ root, path, updatedAt }` برمی‌گرداند. آرگومان اول ترجیحاً همان entry انتخاب‌شده است (rootId ضرب‌شده دو پوشهٔ هم‌نام را جدا می‌کند)؛ رشتهٔ برچسب هم پذیرفته می‌شود. `base` و `draft` باید رشته باشند (`FILESYSTEM_INVALID_ENTRY`) و هرگز بی‌صدا به رشتهٔ خالی تبدیل نمی‌شوند.
- `readShadow(rootOrEntry, path)` — خواندن سایه یا ‏`null`؛ پیش‌نویس‌های پیش از ۱.۱.۰ (کلید قدیمی برچسبی) هم پیدا می‌شوند و ذخیرهٔ تازه آن‌ها را به کلید تازه مهاجرت می‌دهد.
- `clearShadow(rootOrEntry, path)` — حذف سایه (مثلاً بعد از ذخیرهٔ صریح روی دیسک)؛ حذف سایهٔ ناموجود بی‌اثر و موفق است؛ هر دو شکل کلید پاک می‌شوند.

## هویت سایه

کلید پیش‌نویس جفت `(هویت ریشه، مسیر)` به‌صورت ضدتصادم ساخته می‌شود، پس برچسب‌های حاوی نویسهٔ خط جدید یا هم‌نام دیگر تداخل کلیدی ندارند. چون پلتفرم File System Access شناسهٔ پایدار به پوشه نمی‌دهد، هویت یکتا هنگام pick ضرب می‌شود (`rootId`) و با همان entry به متدهای سایه برده می‌شود؛ برچسب متنی فقط هویت نمایشی است و استفاده از آن یعنی فضای سایهٔ مشترک میان هم‌نام‌ها (مستند به همین معنا).

## خطاها (ساختار استاندارد بنیان)

`source` همهٔ خطاها نام افزونه (`pey.filesystem`) است و خطاهای نگاشت‌شده علت اصلی را در `detail.cause` نگه می‌دارند.

- `FILESYSTEM_PICK_FAILED` — picker پرتاب غیرلغوی داشت.
- `FILESYSTEM_READ_FAILED` — پیمایش/خواندن/جمع‌آوری ناممکن (یا ورودی چیزی برای خواندن ندارد یا خروجی آداپتور فهرست/متن نیست).
- `FILESYSTEM_WRITE_FAILED` — نوشتن ناممکن (محتوا متن نیست، یا `write`/`close` شکست خورد).
- `FILESYSTEM_PERMISSION_DENIED` — کاربر اجازه را نداد (علت شکست query/request در `detail.cause`).
- `FILESYSTEM_INVALID_ENTRY` — ورودی نامعتبر متدهای سایه (root/path خالی، `base`/`draft` غیرمتنی، entry بدون rootId).
- `FILESYSTEM_STORAGE_UNAVAILABLE` — سرویس ذخیره در دسترس نیست یا فروشگاه `disk-drafts` پیکربندی نشده (سایه‌ها).
- `SERVICE_UNAVAILABLE` — فراخوانی پس از غیرفعال‌شدن/خاموشی.
- startup آداپتور: `FILESYSTEM_ADAPTER_NOT_FOUND` / `FILESYSTEM_ADAPTER_INVALID` / `FILESYSTEM_ADAPTER_INITIALIZATION_FAILED`.
- startup زمینه: `FILESYSTEM_EVENT_BUS_UNAVAILABLE` — زمینهٔ prepare رویداد `core:service-unavailable` را پشتیبانی نمی‌کند (`detail.reason: 'missing-event-bus'`)؛ شکست سیم‌کشی میزبان است، نه آداپتور.
- نکتهٔ دوکاربردی: `FILESYSTEM_ADAPTER_INVALID` در `getCapabilities` با `type: 'operational'` هم به‌کار می‌رود (شکست زمان‌اجراِ گزارش قابلیت‌ها)؛ خانوادهٔ کد مشترک است، تفکیک با `type` انجام می‌شود.

## وابستگی‌ها

- **لازم:** `pey.storage.service` — پیش‌نویس‌های سایه (با پیکربندی فروشگاهِ بالا). **اختیاری:** هیچ‌کدام. آداپتور محیط داخلی است و `adapterType` در مانیفست اعلام نمی‌شود.
