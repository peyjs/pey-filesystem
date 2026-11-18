# pey.filesystem

[![AI](https://img.shields.io/badge/Built%20with-AI-blueviolet)](#)
[![version](https://img.shields.io/badge/version-1.3.0-blue.svg)](#)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Bonyan Architecture](https://img.shields.io/badge/bonyan-0.11-56c3bf)](https://github.com/barnevis/bonyan)

## هدف

افزونه‌ی پلتفرمی از زیست‌بوم پی برای دسترسی به فایل و پوشهٔ دستگاه کاربر از مسیر آداپتور محیط: انتخاب فایل/پوشه، فهرست بازگشتی ورودی‌های Markdown، خواندن و نوشتن، و پیش‌نویس‌های سایهٔ مرورگری برای ویرایش‌های ذخیره‌نشده.

## ساختار

- `adapters/` — آداپتورهای محیط.
- `docs/` — سندهای پروژه.
- `lib/` — منطق سرویس.
- `tests/` — آزمون‌های افزونه و سوئیت قرارداد آداپتور.
- `index.js` — نقطه‌ی ورود.
- `manifest.json` — قرارداد افزونه.

## وابستگی‌ها

- **الزامی:** `pey.storage.service` — پیش‌نویس‌های سایه از انبار `disk-drafts` این سرویس می‌گذرند.
- **اختیاری:** ندارد.

## نصب و استفاده

افزونه با `manifest.json` و بستهٔ npm به برنامه‌ی میزبان افزوده می‌شود و پس از دو فاز آماده‌سازی و فعال‌سازی، سرویس `pey.filesystem.service` را عرضه می‌کند. میزبان برای پیش‌نویس‌های سایه باید انبار `disk-drafts` را در پیکربندی `pey.storage` تعریف کند (جزئیات در [مرجع](docs/reference.md)) و می‌تواند آداپتور محیط را با کلیدهای `adapter` و `adapterConfig` انتخاب کند.

## مجوز

این پروژه با مجوز MIT منتشر شده است؛ متن کامل در [LICENSE](LICENSE).

## سندهای مرتبط

- [معرفی](docs/introduction.md) — شناخت افزونه به زبان ساده.
- [مرجع](docs/reference.md) — API، رویدادها، خطاها و پیکربندی.
- [نیازمندی‌ها](docs/requirements.md) — سند ساخت افزونه، مکتوب پیش از پیاده‌سازی.
