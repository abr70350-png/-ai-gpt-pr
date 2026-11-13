# AI GPT PRO — إصدار الإصلاح 2.2

واجهة عربية RTL مع خادم Node.js وSupabase وموفري الذكاء الاصطناعي والدفع. هذا المشروع يحتاج خادماً Node.js؛ رفع ملف HTML وحده أو نشره كموقع Netlify ثابت لن يشغّل واجهات API.

## الملفات
- `frontend/index.html`: الواجهة.
- `backend/server.js`: خادم API والمصادقة والمحادثة والوسائط والدفع.
- `backend/.env.example`: أسماء الإعدادات المطلوبة.
- `supabase/schema.sql`: الجداول وسياسات RLS.
- `render.yaml`: إعداد نشر مبدئي على Render.

## تشغيل الخدمات
1. أنشئ مشروع Supabase أو استخدم مشروعك الحالي.
2. افتح SQL Editor وشغّل كامل ملف `supabase/schema.sql`.
3. انشر المشروع على Render من مستودع GitHub يحتوي مجلد `ai-gpt-pro`، وسيقرأ Render ملف `render.yaml`.
4. في Render > Environment أضف القيم المطلوبة:
   - `OWNER_EMAIL`: بريد حساب المالك.
   - `SUPABASE_URL`: رابط مشروع Supabase.
   - `SUPABASE_ANON_KEY`: مفتاح Supabase العام (publishable/anon).
   - `SUPABASE_SERVICE_ROLE_KEY`: مفتاح الخدمة السري من Supabase. يوضع في Render فقط ولا ترسله لأحد ولا تضعه في الواجهة.
   - `GEMINI_API_KEY` أو `OPENAI_API_KEY`: واحد على الأقل لتشغيل المحادثة.
   - `REPLICATE_API_TOKEN`: لتوليد الصور والفيديو.
   - مفاتيح Moyasar اختيارية إلى أن تريد تفعيل الدفع.
5. بعد نجاح النشر، افتح رابط Render. افحص `/api/status` للتأكد من ظهور الخدمات المتصلة.

## ملاحظات مهمة
- لا توجد مفاتيح API مضمّنة في الملفات؛ لا بد من إضافتها في إعدادات الخادم.
- لا تضع `SUPABASE_SERVICE_ROLE_KEY` أو مفاتيح OpenAI/Gemini/Replicate/Moyasar السرية في HTML أو ترسلها في المحادثة.
- عند ترك `ALLOWED_ORIGINS` فارغاً يسمح الخادم بطلبات CORS؛ إذا فصلت الواجهة عن الخادم، ضع نطاق الواجهة في `ALLOWED_ORIGINS`.
- الدفع يحتاج حساب Moyasar ومفاتيح اختبار أولاً، ولا تعتبر الأسعار أو الاشتراكات مفعّلة قبل اختبارها.
- نجاح نشر الخادم لا يعني أن مزودي الذكاء الاصطناعي أو الدفع متصلون؛ حالة كل خدمة تظهر في `/api/status`.

## فحص محلي
يتطلب Node.js 20 أو أحدث:
```bash
cd backend
cp .env.example .env
npm install
npm start
```
ثم افتح `http://localhost:3000`.
