# تاریخچه نسخه‌های pey.filesystem

## [0.3.0] - 1405-08-08

- نوع افزونه `infrastructure` → `platform`: طبق بنیان، دسترسی به فایل‌سیستم توانایی محیط است و آداپتورش داخلی می‌ماند (بدون `adapterType`).
- آداپتور محیطی تازه: `BrowserEnvironmentAdapter` پشت لودر registry (`config.adapter` + `adapterConfig`)؛ پایه‌های خام پلتفرم (pickerها، چرخهٔ مجوز، پیمایش) به آداپتور منتقل شد و سرویس فقط تصمیم‌ها را نگه می‌دارد.
- تغییر قرارداد: `pickDirectory`/`pickFile` دیگر picker تزریقی نمی‌گیرند؛ `listDirectory` ورودی پوشهٔ انتخاب‌شده یا هندل خام می‌گیرد. آداپتور ناشناخته/ناقص خطای startup می‌دهد (`FILESYSTEM_ADAPTER_*`).
- `docs/requirements.md` — نیازمندی‌ها؛ منبع حقیقت ساخت افزونه (قالب شماره‌ای).
- تست‌ها به سه لایه رسیدند: آداپتور (scope فیک)، سرویس (روی آداپتور واقعی)، ورودی.

## [0.2.0] - 1405-07-17

- پیش‌نویس‌های سایه: `saveShadow`/`readShadow`/`clearShadow` روی `pey.storage.service` (انبار `disk-drafts`)؛ وابستگی لازم تازه.
- نسخهٔ نخست: `getCapabilities`، `pickDirectory`/`pickFile` با picker تزریقی، `listDirectory` بازگشتی، `collectEntries` برای لیست تخت، `readEntry`/`writeEntry` با چرخهٔ permission و خطاهای ساخت‌یافته.
