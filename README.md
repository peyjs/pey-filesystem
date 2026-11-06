# pey.filesystem

[![AI](https://img.shields.io/badge/Built%20with-AI-blueviolet)](#)
[![version](https://img.shields.io/badge/version-1.1.1-blue.svg)](#)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Bonyan Architecture](https://img.shields.io/badge/bonyan-0.11-56c3bf)](https://github.com/barnevis/bonyan)

افزونه پلتفرمی Pey: دسترسی به فایل و پوشهٔ دستگاه کاربر از مسیر آداپتور محیط — انتخاب فایل/پوشه، فهرست بازگشتی ورودی‌های Markdown، خواندن و نوشتن (با پرچم قابلیت برای مسیرهای جایگزین)، و پیش‌نویس‌های سایهٔ مرورگری برای ویرایش‌های ذخیره‌نشده.

## پیکربندی لازم میزبان

روش‌های سایه به یک فروشگاه در `pey.storage` نیاز دارند؛ میزبان باید در `bootstrap.json` تعریف کند:

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

## ساختار

- `docs/requirements.md` — نیازمندی‌ها؛ منبع حقیقت ساخت افزونه.
- `manifest.json` — قرارداد معتبر افزونه.
- `index.js` — نقطه‌های ورود `prepare` و `activate` بنیان (لود آداپتور + سیم‌کشی).
- `lib/filesystem-service.js` — پیاده‌سازی سرویس (فیلتر Markdown، BOM، خطاها، سایه‌ها).
- `lib/environment-loader.js` — لودر و اعتبارسنج آداپتور محیط.
- `lib/shadow-identity.js` — هویت و کلیدهای سایه (کلید مدرن `(id, path)` و کلید قدیمی ۱.۱.۰).
- `lib/error.js` — خطای ساخت‌یافتهٔ مرز افزونه.
- `adapters/browser-environment-adapter.js` — آداپتور محیط مرورگر (File System Access + مسیر جایگزین).
- `tests/index.test.js` + `tests/filesystem-service.test.js` + `tests/environment-loader.test.js` + `tests/shadow-identity.test.js` + `tests/error.test.js` + `tests/adapters/browser-environment-adapter.test.js` + `tests/environment-adapter-contract.js` — تست‌های افزونه و سوئیت قرارداد مشترک آداپتور.
- `docs/reference.md` — مرجع کامل خودکفا.
- `CHANGELOG.md` — تاریخچه نسخه‌های این افزونه.

## وابستگی‌ها

- **لازم:** `pey.storage.service` — پیش‌نویس‌های سایه (انبار `disk-drafts`؛ پیکربندی بالا).
- **اختیاری:** هیچ‌کدام.

## همچنین ببینید

- `docs/requirements.md` برای «چه چیزی و چرا»، شامل قرارداد آداپتور محیط.
- `docs/reference.md` برای قرارداد کامل متد و خطاها.
