# Changelog — pey.filesystem

## [1.3.0] - 1405-08-25

### Fixed

- **Shadow drafts survive a re-pick and a page reload.** The picked root's identity used to be re-minted at every pick, so drafts saved under one pick were unreachable after re-selecting the same folder. The picked handle (structured-cloneable) is now persisted by folder name on storage; a re-pick of the same folder (`handle.isSameEntry`) reuses the minted root id instead of orphaning its drafts. Best-effort: without storage or a comparable handle, the pick falls back to a fresh id.
- **Same-named folders can no longer erase each other's legacy drafts.** The pre-1.1.0 key shapes are label-scoped (the 1.0.0 format could not tell same-named folders apart): an entry save or clear with a rootId now never deletes another same-named folder's old draft. Legacy migration deletes happen only in label mode.
- **Pre-1.1.0 webkitdirectory drafts are actually found.** The 1.0.0 format stored the full `webkitRelativePath` (label repeated as the first path segment); the read-only migration fallback now tries that key shape in addition to the 1.1.0 one — matching what the docs always promised.
- **Critical loss reports no longer break the core's delivery pass.** Reporting a lost storage service deactivates the plugin, which unsubscribed this listener mid-delivery — the core walks the live subscriber array, so the next subscriber was skipped and never heard `core:service-unavailable`. The report is now deferred to a microtask, after the whole pass has finished.
- **Malformed adapter pick output fails the pick.** A bare string or an array from the adapter used to be spread into a fabricated entry object; the pick result is now shaped to exactly `{ name, path, handle }` and a malformed shape fails with `FILESYSTEM_PICK_FAILED`.
- **Write/read outcomes are honest about permissions.** A handle without a permission API is an unwritable handle (`writeEntry` → null, the caller's fallback) instead of a permission denial; reads without a permission API are attempted directly. A permission revoked between the round-trip and the actual access (`NotAllowedError`) now maps to `FILESYSTEM_PERMISSION_DENIED` instead of `READ_FAILED`/`WRITE_FAILED`.
- **A broken `abort` can no longer mask the original write failure.** An abort that is missing, rejects, or throws synchronously is contained; the original error always surfaces with its cause.
- **Boundary validation with named reasons.** `listDirectory` rejects a non-object argument (`reason: 'not-walkable'`) and reasons walk failures (`reason: 'walk-failed'`); entries without a usable path are dropped instead of published with `undefined`; `collectEntries` keeps the name/path pair consistent and fails loudly (`reason: 'duplicate-path'`) when two entries land on the same path; `writeEntry` rejects a non-object entry (`reason: 'invalid-entry'`) and an adapter that omits the result (`reason: 'no-result'`) instead of masquerading as the "unwritable handle" null; the write result carries the entry's `rootId` so the freshly written file's shadow is addressable immediately.
- **Shadow paths are normalized.** Duplicate slashes, `.` segments and lexically-resolved `..` collapse, so one file cannot own two drafts under two spellings; a shadow entry without a name is rejected instead of storing an empty display root.
- **Depth cap pinned to the docs.** The walk limit is now stated precisely (folders up to depth 16, root = depth 0; deeper files are skipped without a signal) in the requirements and the reference.

## [1.2.0] - 1405-08-22

### Fixed

- A missing Event Bus in `prepare` reports the dedicated `FILESYSTEM_EVENT_BUS_UNAVAILABLE` (via `createFilesystemError`, `type: 'startup'`) instead of reusing an operational code.
- `prepare` ordering: the fallible adapter load runs BEFORE the `core:service-unavailable` subscription, and the failure path tears the safety net down with the stored context — a failed activate (missing storage service) releases the lost-dependency net too, so the "prepared but not activated" state can no longer leak a listener.
- The browser adapter's `FILESYSTEM_PICK_FAILED` keeps the original picker error in `detail.cause`, matching the documented policy and the `ensurePickable` pattern.
- `readShadow` output is shaped to exactly the manifest-declared fields (`{ root, path, base, draft, updatedAt }`); storage keys and internal ids never leak.
- `getCapabilities` output is shaped to exactly the three declared booleans (any non-`true` field reads as `false`) — a partial adapter report can no longer pass as capabilities.
- `getCapabilities` is normalized (no dynamic re-import), and the README/CHANGELOG match the behavior.

### Tests

- Startup tests for the missing Event Bus (code/type/detail), the adapter-load-failure ordering, `updatedAt` type pinning in the `readShadow` shape test, and the shared contract suite coverage (92 tests).

## [1.1.1] - 1405-08-15

### بازبینی دوم

- جست‌وجوی شناسهٔ آداپتور با `Object.hasOwn` انجام می‌شود — شناسه‌هایی مثل `toString` دیگر به `Object.prototype` نمی‌رسند و همیشه `FILESYSTEM_ADAPTER_NOT_FOUND` می‌دهند.
- غیاب `events` در prepare با خطای startup ساخت‌یافته شکست می‌خورد، نه سکوت (شبکهٔ امن گم‌شدن وابستگی همیشه مسلح است).
- `tests/shadow-identity.test.js` (قواعد کلید/هویت، از جمله ابهام شناخته‌شدهٔ کلید legacy) و `tests/error.test.js` افزوده شدند؛ نام همهٔ آزمون‌ها به قالب `should_…_when_…` یکدست شد؛ اسکریپت آزمون به کشف بازگشتی (`node --test`) تغییر کرد تا زیرپوشه‌های تازه بی‌صدا از دروازه خارج نشوند.
- JSDoc توابع خصوصی لودر افزوده شد؛ README با 1.1.1 همگام شد (نشان نسخه، نام فایل آزمون، افزودن `shadow-identity` و سوئیت قرارداد).
- ردپای سه catch بی‌صدای best-effort (حذف مهاجرت، پاک‌سازی کلید قدیمی، abort جریان) در کامنت‌هایشان صریحاً «تصمیم ثبت‌شده» علامت‌گذاری شد؛ تفکیک بعدی متدهای سایه به ماژول جدا، بدهی ساختاری نسخه‌های بعد است.

### تغییر یافته

- سوئیت قرارداد مشترک و قابل‌استفادهٔ مجدد آداپتور (`tests/environment-adapter-contract.js` + فیکسچرهای مشترک) نوشته شد و علیه آداپتور مرورگر اجرا می‌شود؛ آداپتور آینده (Capacitor/Tauri) فقط فکتوری می‌دهد. آزمون‌های اختصاصی آداپتور مرورگر به مورد خاص خود (fallback به scope سراسری) محدود شد.
- بلوک هویت/کلید سایه به `lib/shadow-identity.js` منتقل شد (فایل سرویس از ~۴۵۰ خط به ~۳۸۰ خط).
- دسترسی به `config` در `prepare` گارد گرفت (config غایب دیگر TypeError خام نمی‌دهد).
- مستندات: حذف بی‌صدای ورودی‌های بی‌نام در `collectEntries` و کاربرد دوگانهٔ `FILESYSTEM_ADAPTER_INVALID` در `getCapabilities` (تفکیک با `type`) صریح شد.

### آزمون

- مسیرهای خطای واقعی pey.storage در `saveShadow`/`readShadow`/`clearShadow` پوشش داده شد (ردّ write/read/delete → `FILESYSTEM_STORAGE_UNAVAILABLE` با `detail.cause`، و عبور خطای کدشده بدون wrap دوم).
- `tests/filesystem.test.js` به `tests/index.test.js` تغییر نام یافت و زنجیرهٔ `.then` باقی‌مانده با await جایگزین شد (۷۷ آزمون).

## [1.1.0] - 1405-08-13

### تغییر یافته

- مستندات: بخش «پیکربندی لازم میزبان» (فروشگاه `disk-drafts` با `keyPath: "key"`) در reference و README؛ توضیح `writable` در capabilities صریح شد (تلاش نوشتن ممکن است با رد مجوز رد شود)؛ اسکریپت تست به گلوب سازگار با Node قدیمی‌تر تغییر کرد.

### برطرف شده

- سرویس پس از غیرفعال‌شدن/خاموشی واقعاً از کار می‌افتد: پرچم availability سراسری، هر متد (حتی getCapabilities و pickerها) با `SERVICE_UNAVAILABLE` رد می‌شود؛ پاک‌سازی idempotent است و اشتراک `core:service-unavailable` آزاد می‌شود.
- کلید پیش‌نویس سایه ضدتصادم شد: جفت `(هویت ریشه، مسیر)`؛ هنگام pick یک `rootId` یکتا روی entry ضرب می‌شود تا دو پوشهٔ هم‌نام پیش‌نویس جدا داشته باشند؛ پیش‌نویس‌های قدیمی (کلید برچسبی) هنگام خواندن پیدا و هنگام ذخیره مهاجرت می‌شوند؛ برچسب‌های حاوی نویسهٔ خط جدید دیگر تداخل ندارند.
- شکست `write` یا `close` در نوشتن فایل دیگر موفقیت کاذب نیست: جریان abort می‌شود تا نیمه‌نوشته‌ای commit نشود و خطای اصلی در `detail.cause` می‌ماند.
- `collectEntries` از قرارداد آداپتور به سرویس منتقل شد (شکل‌دهی دادهٔ خالص، بدون وابستگی محیط) و مسیرهایش به «نسبی به ریشهٔ انتخاب‌شده» نرمال شد تا با `listDirectory` هم‌ساز باشد؛ ورودی غیرآرایه خطای ساخت‌یافته می‌دهد.
- تشخیص لغو کاربر بر پایهٔ نام `AbortError` است (نه `instanceof Error`) — DOMException در بعضی موتورها دیگر لغو را به خطا تبدیل نمی‌کند.
- ورودی‌های نامعتبر متدهای سایه (root/path خالی، `base`/`draft` غیرمتنی) با کد جدید `FILESYSTEM_INVALID_ENTRY` رد می‌شوند و هرگز بی‌صدا به رشتهٔ خالی تبدیل نمی‌شوند.
- خروجی نامعتبر آداپتور (فهرست غیرآرایه، متن غیررشته‌ای، capabilities غایب) خطای ساخت‌یافته یا پیش‌فرض می‌دهد، نه TypeError خام؛ `getCapabilities`/pickerها هم در مرز سرویس نگاشت می‌شوند.
- `activate` بدون وابستگی خطای ساخت‌یافتهٔ startup می‌دهد، نه Error خام؛ `source` همهٔ خطاها نام افزونه (`pey.filesystem`) است و علت اصلی خطاهای نگاشت‌شده در `detail.cause` می‌ماند.
- `readShadow`/`writeEntry`/pickerها دیگر `undefined` برنمی‌گردانند (قرارداد `null`)؛ `clearShadow` روی رکورد ناموجود موفق بی‌اثر است و هر دو شکل کلید را پاک می‌کند؛ `readEntry` مقدار غیرمتنی را به متن خالی تبدیل نمی‌کند.
- پیمایش دایرکتوری محدود شد: عمق تا ۱۶، پرش از `.git` و `node_modules`، زیرپوشهٔ ناخوانا نادیده (ناخوانایی ریشه شکست است)، ترتیب پایدار مسیر.
- `scope` غیرآبجکت در آداپتور مرورگر به global برمی‌گردد؛ شکست query/request مجوز در `detail.cause` خطای رد مجوز حفظ می‌شود.


## [1.0.0] - 1405-08-08

انتشار نخست در پی: افزونهٔ پلتفرمی دسترسی به فایل و پوشهٔ دستگاه کاربر از مسیر آداپتور محیط قابل‌تعویض (`BrowserEnvironmentAdapter` امروز — pickerهای File System Access، چرخهٔ مجوز، پیمایش بازگشتی؛ انتخاب با `config.adapter`)، فهرست‌سازی/خواندن/نوشتن متمرکز بر Markdown (`.md`/`.markdown`/`.mdown`/`.txt`، خواندن بدون BOM)، پیش‌نویس‌های سایهٔ مرورگری روی `pey.storage.service` (انبار `disk-drafts`)، و `docs/requirements.md` به‌عنوان منبع حقیقت ساخت. کنسل کاربر و نبود picker نتیجه (`null`) است نه خطا؛ رد مجوز خطای ساخت‌یافتهٔ `FILESYSTEM_PERMISSION_DENIED` است.

> انکوباسیون در پارسی‌نگار با نسخه‌های 0.1.0–0.2.0 (طرح picker تزریقی) انجام شد؛ آن تاریخچه نزد پروژهٔ مبدأ می‌ماند — خط‌نسخهٔ انتشار پی از همین‌جا آغاز می‌شود.
