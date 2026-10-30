# مرجع pey.filesystem

## هدف

افزونه پلتفرمی Pey برای دسترسی به فایل و پوشهٔ دستگاه کاربر. منطق قابل‌حمل اینجاست (فیلتر Markdown، BOM، شکل خطاها، انبار سایه)؛ پایه‌های خام پلتفرم (pickerها، چرخهٔ permission، پیمایش) پشت آداپتور محیطی است و افزونه هرگز به DOM دست نمی‌زند.

## آداپتور محیط

آداپتور داخلی افزونه است و در مانیفست `adapterType` ندارد (قاعدهٔ بنیان: `adapterType` فقط برای infrastructure). انتخاب با پیکربندی:

```json
{ "adapter": "BrowserEnvironmentAdapter", "adapterConfig": {} }
```

- **`BrowserEnvironmentAdapter`** — File System Access API + مسیر جایگزین ورودی دایرکتوری؛ `adapterConfig.scope` برای تست جایگزین global می‌شود.
- آداپتور تازه (Capacitor، Tauri و…) همین مجموعه را پیاده می‌کند: `capabilities`، `pickDirectory`، `pickFile`، `listEntries`، `readEntry`، `writeEntry` (+ `collectEntries` در مرورگر). آداپتور ناشناخته/ناقص خطای startup می‌دهد (`FILESYSTEM_ADAPTER_NOT_FOUND` / `_INVALID` / `_INITIALIZATION_FAILED`).

## شکل ورودی (Entry)

```text
{ name: string, path: string, handle?: FileSystemFileHandle, file?: File-like }
```

- `pickDirectory`/`pickFile` ورودی handleدار برمی‌گردانند (`path` همان نام ریشه است).
- `listDirectory` ورودی‌های handleدار با مسیر نسبی (`sub/note.md`) برمی‌گرداند.
- `collectEntries` ورودی‌های fileدار با مسیر `webkitRelativePath` (یا نام) برمی‌گرداند.

نام Markdown یعنی پسوند یکی از `.md` / `.markdown` / `.mdown` / `.txt` (غیرحساس به حروف).

## API عمومی

- `getCapabilities()` → `{ directoryPicker, filePicker, writable }` — `writable` یعنی ورودی‌های انتخاب‌شده قابل بازنویسی‌اند (فقط handleها).
- `pickDirectory()` / `pickFile()` — از آداپتور محیط؛ `null` وقتی picker نیست یا کاربر لغو کرد (AbortError) — نتیجه، نه خطا.
- `listDirectory(directory)` — ورودی پوشهٔ انتخاب‌شده یا هندل خام؛ پیمایش بازگشتی در آداپتور، فیلتر Markdown در سرویس؛ لیست تخت با مسیر نسبی.
- `collectEntries(files)` — فیلتر لیست تخت؛ خالص.
- `readEntry(entry)` — از handle (با round-trip اجازهٔ `read` در آداپتور) یا فایل ساده؛ BOM ابتدایی در سرویس حذف می‌شود.
- `writeEntry(entry, content)` — از handle (با round-trip اجازهٔ `readwrite` در آداپتور)؛ وقتی ورودی handle نوشتنی ندارد ‏`null` برمی‌گرداند تا فراخوان fallback کند (مثلاً دانلود)؛ ‏`{ name, path }` در موفقیت.
- `saveShadow(root, path, base, draft)` — ذخیرهٔ پیش‌نویس سایه (انبار `disk-drafts` روی `pey.storage.service`): مبنای دیسک + draft جاری؛ ‏`{ root, path, updatedAt }` برمی‌گرداند.
- `readShadow(root, path)` — خواندن سایه یا ‏`null`؛ `clearShadow(root, path)` — حذف سایه (مثلاً بعد از ذخیرهٔ صریح روی دیسک).

## خطاها (ساختار استاندارد بنیان)

- `FILESYSTEM_PICK_FAILED` — picker پرتاب غیرلغوی داشت.
- `FILESYSTEM_READ_FAILED` — پیمایش/خواندن ناممکن (یا ورودی چیزی برای خواندن ندارد).
- `FILESYSTEM_WRITE_FAILED` — نوشتن ناممکن (یا محتوا متن نیست).
- `FILESYSTEM_PERMISSION_DENIED` — کاربر اجازه را نداد.
- `FILESYSTEM_STORAGE_UNAVAILABLE` — سرویس ذخیره در دسترس نیست (سایه‌ها).
- startup آداپتور: `FILESYSTEM_ADAPTER_NOT_FOUND` / `FILESYSTEM_ADAPTER_INVALID` / `FILESYSTEM_ADAPTER_INITIALIZATION_FAILED`.

## وابستگی‌ها

- **لازم:** `pey.storage.service` — پیش‌نویس‌های سایه. **اختیاری:** هیچ‌کدام. آداپتور محیط داخلی است و `adapterType` در مانیفست اعلام نمی‌شود.
