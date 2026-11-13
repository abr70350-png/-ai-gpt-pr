-- ============================================================================
-- AI GPT PRO - مخطط قاعدة البيانات الحقيقية (Supabase PostgreSQL)
-- يدعم: المصادقة الحقيقية، حماية المالك على مستوى الخادم، المشاريع، المحادثات، المدفوعات
-- ============================================================================

-- 1. جدول الملفات الشخصية والصلاحيات (يُمنح OWNER تلقائياً فقط إذا تطابق البريد مع OWNER_EMAIL)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'OWNER')),
  subscription_plan TEXT NOT NULL DEFAULT 'FREE' CHECK (subscription_plan IN ('FREE', 'WEEKLY', 'MONTHLY', 'YEARLY')),
  subscription_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- تفعيل RLS لمنع أي مستخدم من تعديل دوره إلى OWNER من المتصفح
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- لا نسمح بتحديث profiles مباشرة من المتصفح.
-- الخادم فقط يستخدم Service Role لتغيير الدور والاشتراك بعد التحقق من الهوية والدفع.
-- تجنبنا سياسة UPDATE التي تقرأ الجدول نفسه وقد تسبب RLS recursion.

-- 2. جدول إعدادات الأسعار (قابل للتعديل من المالك فقط)
CREATE TABLE IF NOT EXISTS public.pricing_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  anime_base_price NUMERIC(10,2) NOT NULL DEFAULT 399.00,
  anime_per_episode NUMERIC(10,2) NOT NULL DEFAULT 150.00,
  anime_quality_4k_fee NUMERIC(10,2) NOT NULL DEFAULT 250.00,
  anime_duration_multiplier NUMERIC(10,2) NOT NULL DEFAULT 1.50,
  plan_weekly NUMERIC(10,2) NOT NULL DEFAULT 9.99,
  plan_monthly NUMERIC(10,2) NOT NULL DEFAULT 29.99,
  plan_yearly NUMERIC(10,2) NOT NULL DEFAULT 249.99,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

INSERT INTO public.pricing_settings (id, anime_base_price, anime_per_episode, anime_quality_4k_fee, anime_duration_multiplier, plan_weekly, plan_monthly, plan_yearly)
VALUES (1, 399.00, 150.00, 250.00, 1.50, 9.99, 29.99, 249.99)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pricing settings"
  ON public.pricing_settings FOR SELECT
  USING (true);

-- 3. جدول المحادثات الذكية
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT 'محادثة جديدة',
  mode TEXT NOT NULL DEFAULT 'general',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own conversations"
  ON public.conversations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. جدول مشاريع استوديو الأنمي
CREATE TABLE IF NOT EXISTS public.anime_projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  genre TEXT,
  episodes_count INT NOT NULL DEFAULT 1,
  quality TEXT NOT NULL DEFAULT '1080p',
  story_outline TEXT,
  characters JSONB NOT NULL DEFAULT '[]'::jsonb,
  backgrounds JSONB NOT NULL DEFAULT '[]'::jsonb,
  scenes JSONB NOT NULL DEFAULT '[]'::jsonb,
  script_text TEXT,
  estimated_cost_sar NUMERIC(10,2) NOT NULL DEFAULT 399.00,
  payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PAID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.anime_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own anime projects"
  ON public.anime_projects FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. جدول المدفوعات الفعلية (يُكتب فقط من الخادم عبر Service Role بعد التحقق من Moyasar Webhook/API)
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  moyasar_payment_id TEXT UNIQUE NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('SUBSCRIPTION', 'ANIME_PROJECT')),
  plan_or_project_id TEXT NOT NULL,
  amount_sar NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  status TEXT NOT NULL CHECK (status IN ('paid', 'failed', 'refunded')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_gateway_response JSONB
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own payments"
  ON public.payments FOR SELECT
  USING (auth.uid() = user_id);

-- 6. جدول المصروفات التشغيلية الفعلية (تكاليف APIs، الخوادم، توليد الفيديو) للمالك فقط
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_sar NUMERIC(10,2) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- لا توجد سياسات قراءة/كتابة عامة للمصروفات؛ الوصول يتم من الخادم بعد تحقق OWNER.
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON public.conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_user_created ON public.anime_projects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user_verified ON public.payments(user_id, verified_at DESC);
