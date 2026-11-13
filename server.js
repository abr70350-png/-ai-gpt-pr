import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('هذا النطاق غير مسموح له بالاتصال بالخادم.'));
  },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.resolve(__dirname, '../frontend')));

// ============================================================================
// التحقق من متغيرات البيئة (لا توجد مفاتيح في الواجهة الأمامية مطلقاً)
// ============================================================================
const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';
const MOYASAR_SECRET_KEY = process.env.MOYASAR_SECRET_KEY || '';
const MOYASAR_PUBLISHABLE_KEY = process.env.MOYASAR_PUBLISHABLE_KEY || '';
const ADSENSE_CLIENT_ID = process.env.ADSENSE_CLIENT_ID || '';
const MAX_PROMPT_LENGTH = 8000;

// عميل Supabase بصلاحيات الخادم (Service Role) للتحقق من الصلاحيات وتسجيل المدفوعات الفعلية
const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// ============================================================================
// نقطة فحص حالة الخدمات الحقيقية (Service Health Check)
// ============================================================================
app.get('/api/status', (req, res) => {
  res.json({
    services: {
      supabase: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY),
      ai_chat: Boolean(OPENAI_API_KEY || GEMINI_API_KEY),
      image_gen: Boolean(OPENAI_API_KEY || REPLICATE_API_TOKEN),
      video_gen: Boolean(REPLICATE_API_TOKEN),
      moyasar: Boolean(MOYASAR_SECRET_KEY && MOYASAR_PUBLISHABLE_KEY),
      ads: Boolean(ADSENSE_CLIENT_ID),
      owner_configured: Boolean(OWNER_EMAIL)
    },
    publicConfig: {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      moyasarPublishableKey: MOYASAR_PUBLISHABLE_KEY,
      adsenseClientId: ADSENSE_CLIENT_ID
    }
  });
});

// ============================================================================
// Middleware: التحقق من هوية المستخدم وصلاحية OWNER من الخادم فقط
// ============================================================================
async function requireAuth(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({
      error: 'خدمة المصادقة وقاعدة البيانات (Supabase) غير مربوطة في إعدادات الخادم (.env).'
    });
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'جلسة الدخول غير صالحة أو منتهية.' });
  }

  // التحقق من دور المالك بناءً على OWNER_EMAIL في الخادم فقط
  const isOwner = Boolean(OWNER_EMAIL && user.email && user.email.toLowerCase() === OWNER_EMAIL);
  const expectedRole = isOwner ? 'OWNER' : 'USER';

  // مزامنة سجل المستخدم في جدول profiles
  const { data: profile, error: profileReadError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (profileReadError) return res.status(500).json({ error: 'تعذر قراءة الملف الشخصي.' });

  if (!profile) {
    const { data: newProfile } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.email.split('@')[0],
        role: expectedRole
      })
      .select()
      .single();
    if (!newProfile) return res.status(500).json({ error: 'تعذر إنشاء الملف الشخصي.' });
    req.profile = newProfile;
  } else if (profile.role !== expectedRole) {
    const { data: updatedProfile } = await supabaseAdmin
      .from('profiles')
      .update({ role: expectedRole })
      .eq('id', user.id)
      .select()
      .single();
    req.profile = updatedProfile;
  } else {
    req.profile = profile;
  }

  req.user = user;
  req.isOwner = isOwner;
  next();
}

function requireOwner(req, res, next) {
  if (!req.isOwner || req.profile?.role !== 'OWNER') {
    return res.status(403).json({
      error: 'غير مصرح لك بالوصول. صلاحية OWNER تُمنح حصرياً للبريد المسجل في OWNER_EMAIL على الخادم.'
    });
  }
  next();
}

// ============================================================================
// 1. جلب بيانات الملف الشخصي والصلاحية المؤكدة من الخادم
// ============================================================================
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      full_name: req.profile.full_name,
      role: req.profile.role,
      isOwner: req.isOwner,
      subscription_plan: req.profile.subscription_plan,
      subscription_expires_at: req.profile.subscription_expires_at
    }
  });
});

// ============================================================================
// 2. المحادثة الذكية الحقيقية (OpenAI / Gemini) + حفظ السجل في Supabase
// ============================================================================
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { conversationId, message, mode = 'general', imageBase64 } = req.body;
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'الرسالة مطلوبة.' });
    }
    if (message.length > MAX_PROMPT_LENGTH) return res.status(413).json({ error: 'الرسالة طويلة جداً. الحد الأقصى 8000 حرف.' });
    if (!OPENAI_API_KEY && !GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'محرك الذكاء الاصطناعي غير مربوط. يرجى إضافة OPENAI_API_KEY أو GEMINI_API_KEY في ملف .env على الخادم.'
      });
    }

    const systemPrompts = {
      general: 'أنت مساعد ذكاء اصطناعي عربي متقدم في منصة AI GPT PRO. أجب بدقة ووضوح واحترافية باللغة العربية.',
      story: 'أنت روائي وكاتب قصص محترف باللغة العربية. اكتب حبكات متماسكة وشخصيات عميقة وأسلوباً أدبياً رفيعاً.',
      code: 'أنت مهندس برمجيات خبير. اكتب أكواداً نظيفة وآمنة وقابلة للتشغيل مع شرح موجز.',
      translate: 'أنت مترجم محترف. قدم ترجمة دقيقة تحافظ على المعنى والسياق، أو لخص النص بوضوح.',
      vision: 'أنت محلل صور وملفات خبير. صف وحلل المحتوى المرفق بدقة.'
    };

    let conv = null;
    if (conversationId) {
      const { data } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', req.user.id)
        .single();
      conv = data;
    }

    const history = conv?.messages || [];
    const updatedHistory = [...history, { role: 'user', content: message, timestamp: new Date().toISOString() }];
    let aiReply = '';

    if (OPENAI_API_KEY) {
      const apiMessages = [
        { role: 'system', content: systemPrompts[mode] || systemPrompts.general },
        ...updatedHistory.slice(-12).map(m => ({ role: m.role, content: m.content }))
      ];
      if (imageBase64) {
        apiMessages[apiMessages.length - 1] = {
          role: 'user',
          content: [
            { type: 'text', text: message },
            { type: 'image_url', image_url: { url: imageBase64 } }
          ]
        };
      }
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: apiMessages,
          temperature: 0.7
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'فشل الاتصال بخدمة OpenAI.');
      }
      aiReply = data.choices[0].message.content;
    } else if (GEMINI_API_KEY) {
      const contents = updatedHistory.slice(-12).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      if (imageBase64) {
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(imageBase64);
        if (!match) return res.status(400).json({ error: 'صيغة الصورة غير صحيحة؛ أرسل صورة بصيغة data URL.' });
        contents[contents.length - 1].parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompts[mode] || systemPrompts.general }] },
            contents
          })
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'فشل الاتصال بخدمة Gemini.');
      }
      aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    if (!aiReply) {
      throw new Error('لم يُرجع نموذج الذكاء الاصطناعي أي استجابة.');
    }

    const finalMessages = [...updatedHistory, { role: 'assistant', content: aiReply, timestamp: new Date().toISOString() }];
    let savedConv;
    if (conv) {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .update({ messages: finalMessages, updated_at: new Date().toISOString() })
        .eq('id', conv.id)
        .select()
        .single();
      if (error) throw error;
      savedConv = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .insert({
          user_id: req.user.id,
          title: message.slice(0, 45),
          mode,
          messages: finalMessages
        })
        .select()
        .single();
      if (error) throw error;
      savedConv = data;
    }

    res.json({ reply: aiReply, conversation: savedConv });
  } catch (err) {
    res.status(500).json({ error: err.message || 'حدث خطأ أثناء معالجة المحادثة.' });
  }
});

app.get('/api/conversations', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id, title, mode, messages, updated_at')
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversations: data || [] });
});

// ============================================================================
// 3. محرك توليد صور الأنمي الحقيقي (DALL-E 3 أو Replicate SDXL/Flux)
// ============================================================================
app.post('/api/anime/image', requireAuth, async (req, res) => {
  try {
    const { prompt, style = 'Modern High-Budget Anime', background = 'Tokyo Sunset', outfit = 'Traditional Samurai Armor', age = 'Teenager', personality = 'Determined Hero' } = req.body;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'يرجى كتابة وصف الصورة المطلوبة.' });
    }
    if (!OPENAI_API_KEY && !REPLICATE_API_TOKEN) {
      return res.status(503).json({
        error: 'خدمة توليد الصور غير مربوطة. يرجى إضافة OPENAI_API_KEY أو REPLICATE_API_TOKEN في إعدادات الخادم.'
      });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) return res.status(413).json({ error: 'وصف الصورة طويل جداً.' });
    const safe = value => String(value ?? '').slice(0, 500);
    const engineeredPrompt = `Masterpiece anime illustration, style: ${safe(style)}. Subject: ${safe(prompt)}. Character details: age ${safe(age)}, personality expression ${safe(personality)}, wearing ${safe(outfit)}. Background setting: ${safe(background)}. Crisp lineart, vibrant lighting, high detail, anime key visual, no watermarks.`;

    if (OPENAI_API_KEY) {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: engineeredPrompt,
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json'
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'فشل توليد الصورة من محرك DALL-E.');
      }
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new Error('لم يتم استلام بيانات الصورة من الخادم.');
      return res.json({
        imageUrl: `data:image/png;base64,${b64}`,
        engineeredPrompt
      });
    }

    // بديل Replicate Flux Schnell
    const repRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Prefer': 'wait'
      },
      body: JSON.stringify({ input: { prompt: engineeredPrompt, aspect_ratio: '1:1' } })
    });
    const repData = await repRes.json();
    if (!repRes.ok || !repData.output?.[0]) {
      throw new Error(repData.detail || 'فشل توليد الصورة عبر Replicate.');
    }
    res.json({ imageUrl: repData.output[0], engineeredPrompt });
  } catch (err) {
    res.status(500).json({ error: err.message || 'فشل توليد الصورة.' });
  }
});

// ============================================================================
// 4. محرك توليد فيديو الأنمي الحقيقي (تحويل الصورة إلى مشهد متحرك + تتبع التقدم)
// ============================================================================
app.post('/api/anime/video', requireAuth, async (req, res) => {
  try {
    const { imageUrl, motionPrompt = 'Smooth anime camera pan, wind blowing hair, cinematic lighting' } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: 'يجب توفير صورة لتوليد مشهد الفيديو المتحرك.' });
    }
    if (!REPLICATE_API_TOKEN) {
      return res.status(503).json({
        error: 'خدمة توليد الفيديو غير مربوطة. يرجى إضافة REPLICATE_API_TOKEN في ملف .env على الخادم.'
      });
    }

    if (typeof motionPrompt !== 'string' || !motionPrompt.trim()) {
      return res.status(400).json({ error: 'اكتب وصف الحركة المطلوبة للفيديو.' });
    }
    if (motionPrompt.length > 2000) return res.status(413).json({ error: 'وصف الحركة طويل جداً.' });
    // Minimax Video-01 يدعم وصف الحركة النصي مع صورة الإطار الأول.
    const response = await fetch('https://api.replicate.com/v1/models/minimax/video-01/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        input: { prompt: motionPrompt, first_frame_image: imageUrl }
      })
    });
    const prediction = await response.json();
    if (!response.ok) {
      throw new Error(prediction.detail || 'فشل بدء عملية توليد الفيديو.');
    }
    res.json({
      predictionId: prediction.id,
      status: prediction.status
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'خطأ في بدء توليد الفيديو.' });
  }
});

app.get('/api/anime/video/:id', requireAuth, async (req, res) => {
  try {
    if (!REPLICATE_API_TOKEN) {
      return res.status(503).json({ error: 'خدمة الفيديو غير مربوطة.' });
    }
    if (!/^[a-zA-Z0-9_-]{6,100}$/.test(req.params.id)) return res.status(400).json({ error: 'معرف عملية الفيديو غير صحيح.' });
    const response = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(req.params.id)}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
    });
    const prediction = await response.json();
    if (!response.ok) {
      throw new Error(prediction.detail || 'تعذر جلب حالة الفيديو.');
    }
    let progress = 10;
    if (prediction.status === 'processing') {
      const match = (prediction.logs || '').match(/(\d+)%/g);
      progress = match ? parseInt(match[match.length - 1], 10) : 55;
    } else if (prediction.status === 'succeeded') {
      progress = 100;
    } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
      progress = 0;
    }

    res.json({
      status: prediction.status,
      progress,
      videoUrl: Array.isArray(prediction.output) ? prediction.output[0] : prediction.output,
      error: prediction.error || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 5. استوديو الأنمي المتكامل (توليد القصة + الشخصيات + السيناريو بالذكاء الاصطناعي + الحفظ)
// ============================================================================
app.post('/api/anime/studio/generate', requireAuth, async (req, res) => {
  try {
    const { title, genre, idea, episodesCount = 1, quality = '1080p' } = req.body;
    if (typeof idea !== 'string' || !idea.trim()) {
      return res.status(400).json({ error: 'يرجى كتابة فكرة الأنمي أولاً.' });
    }
    if (idea.length > MAX_PROMPT_LENGTH) return res.status(413).json({ error: 'فكرة المشروع طويلة جداً.' });
    const safeEpisodes = Number(episodesCount);
    if (!Number.isInteger(safeEpisodes) || safeEpisodes < 1 || safeEpisodes > 100) return res.status(400).json({ error: 'عدد الحلقات يجب أن يكون بين 1 و100.' });
    if (!['720p', '1080p', '4K'].includes(quality)) return res.status(400).json({ error: 'جودة المشروع غير مدعومة.' });
    if (!OPENAI_API_KEY && !GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'خدمة الذكاء الاصطناعي غير مربوطة. أضف OPENAI_API_KEY أو GEMINI_API_KEY على الخادم.'
      });
    }

    const prompt = `أنت مخرج وكاتب أنمي محترف. أنشئ مشروع أنمي متكامل باللغة العربية بصيغة JSON حصراً بدون أي نص إضافي:
الفكرة: ${idea}
العنوان المقترح: ${title || 'غير محدد'}
التصنيف: ${genre || 'أكشن وخيال'}
عدد الحلقات: ${episodesCount}

أعد كائن JSON بالمفاتيح التالية فقط:
{
  "title": "عنوان الأنمي",
  "story_outline": "ملخص القصة الكاملة للموسم",
  "characters": [
    { "name": "اسم الشخصية", "role": "الدور", "abilities": "القدرات", "visual_prompt": "وصف إنجليزي دقيق لرسم الشخصية بأسلوب الأنمي" }
  ],
  "backgrounds": [
    { "name": "اسم الموقع", "description": "وصف المكان", "visual_prompt": "وصف إنجليزي دقيق لرسم الخلفية بأسلوب الأنمي" }
  ],
  "script_text": "سيناريو وحوار الحلقة الأولى كاملاً مع تقسيم المشاهد"
}`;

    let rawJsonText = '';
    if (OPENAI_API_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'فشل توليد المشروع.');
      rawJsonText = data.choices[0].message.content;
    } else {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'فشل توليد المشروع.');
      rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    }

    const generated = JSON.parse(rawJsonText);

    // حساب التكلفة من جدول الأسعار الحقيقي
    const { data: pricing } = await supabaseAdmin.from('pricing_settings').select('*').eq('id', 1).single();
    const base = Number(pricing?.anime_base_price || 399);
    const perEp = Number(pricing?.anime_per_episode || 150);
    const q4k = quality === '4K' ? Number(pricing?.anime_quality_4k_fee || 250) : 0;
    const estimatedCost = base + Math.max(0, safeEpisodes - 1) * perEp + q4k;

    const { data: savedProject, error } = await supabaseAdmin
      .from('anime_projects')
      .insert({
        user_id: req.user.id,
        title: generated.title || title || 'مشروع أنمي جديد',
        genre: genre || 'أكشن',
        episodes_count: safeEpisodes,
        quality,
        story_outline: generated.story_outline || '',
        characters: generated.characters || [],
        backgrounds: generated.backgrounds || [],
        script_text: generated.script_text || '',
        estimated_cost_sar: estimatedCost
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ project: savedProject });
  } catch (err) {
    res.status(500).json({ error: err.message || 'فشل إنشاء مشروع الأنمي.' });
  }
});

app.get('/api/anime/projects', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('anime_projects')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ projects: data || [] });
});

// ============================================================================
// 6. الأسعار وإدارة الأسعار من لوحة المالك
// ============================================================================
app.get('/api/pricing', async (req, res) => {
  if (!supabaseAdmin) {
    return res.json({
      pricing: {
        anime_base_price: 399,
        anime_per_episode: 150,
        anime_quality_4k_fee: 250,
        anime_duration_multiplier: 1.5,
        plan_weekly: 9.99,
        plan_monthly: 29.99,
        plan_yearly: 249.99
      },
      source: 'default_unconnected'
    });
  }
  const { data, error } = await supabaseAdmin.from('pricing_settings').select('*').eq('id', 1).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ pricing: data, source: 'database' });
});

app.put('/api/owner/pricing', requireAuth, requireOwner, async (req, res) => {
  const { anime_base_price, anime_per_episode, anime_quality_4k_fee, plan_weekly, plan_monthly, plan_yearly } = req.body;
  if (Number(anime_base_price) < 399) {
    return res.status(400).json({ error: 'الحد الأدنى لسعر إنشاء الأنمي هو 399 ريال سعودي.' });
  }
  const { data, error } = await supabaseAdmin
    .from('pricing_settings')
    .update({
      anime_base_price: Number(anime_base_price),
      anime_per_episode: Number(anime_per_episode),
      anime_quality_4k_fee: Number(anime_quality_4k_fee),
      plan_weekly: Number(plan_weekly),
      plan_monthly: Number(plan_monthly),
      plan_yearly: Number(plan_yearly),
      updated_at: new Date().toISOString(),
      updated_by: req.user.id
    })
    .eq('id', 1)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ pricing: data });
});

// ============================================================================
// 7. التحقق الحقيقي من الدفع عبر بوابة Moyasar (لا تفعيل بدون تحقق الخادم)
// ============================================================================
app.post('/api/payments/verify-moyasar', requireAuth, async (req, res) => {
  try {
    const { paymentId, paymentType, planOrProjectId } = req.body;
    if (!MOYASAR_SECRET_KEY) return res.status(503).json({ error: 'بوابة الدفع غير مربوطة في إعدادات الخادم.' });
    if (typeof paymentId !== 'string' || !/^[a-zA-Z0-9_-]{5,100}$/.test(paymentId)) return res.status(400).json({ error: 'معرف عملية الدفع غير صحيح.' });
    if (!['SUBSCRIPTION', 'ANIME_PROJECT'].includes(paymentType) || typeof planOrProjectId !== 'string') {
      return res.status(400).json({ error: 'نوع عملية الدفع أو معرفها غير صحيح.' });
    }

    let expectedAmount;
    let projectAlreadyPaid = false;
    if (paymentType === 'SUBSCRIPTION') {
      const { data: pricing, error } = await supabaseAdmin.from('pricing_settings').select('*').eq('id', 1).single();
      if (error || !pricing) return res.status(500).json({ error: 'تعذر التحقق من أسعار الاشتراكات.' });
      const plans = { WEEKLY: Number(pricing.plan_weekly), MONTHLY: Number(pricing.plan_monthly), YEARLY: Number(pricing.plan_yearly) };
      if (!Object.hasOwn(plans, planOrProjectId)) return res.status(400).json({ error: 'الباقة المطلوبة غير معروفة.' });
      expectedAmount = plans[planOrProjectId];
    } else {
      const { data: project, error } = await supabaseAdmin.from('anime_projects').select('id, user_id, estimated_cost_sar, payment_status').eq('id', planOrProjectId).eq('user_id', req.user.id).maybeSingle();
      if (error || !project) return res.status(404).json({ error: 'مشروع الأنمي غير موجود أو لا تملك صلاحية الوصول إليه.' });
      projectAlreadyPaid = project.payment_status === 'PAID';
      expectedAmount = Number(project.estimated_cost_sar);
    }

    const basicAuth = Buffer.from(`${MOYASAR_SECRET_KEY}:`).toString('base64');
    const gatewayRes = await fetch(`https://api.moyasar.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Basic ${basicAuth}` }
    });
    const paymentData = await gatewayRes.json();
    if (!gatewayRes.ok) return res.status(400).json({ error: paymentData.message || 'تعذر التحقق من العملية لدى Moyasar.' });
    if (paymentData.status !== 'paid' || paymentData.currency !== 'SAR') return res.status(402).json({ error: 'لم يكتمل الدفع بالريال السعودي؛ لم يتم تفعيل الخدمة.' });
    const paidAmount = Number(paymentData.amount) / 100;
    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.001) {
      return res.status(400).json({ error: 'المبلغ المدفوع لا يطابق السعر المعتمد. لم يتم تفعيل الخدمة.' });
    }

    const { data: existing } = await supabaseAdmin.from('payments').select('id, user_id, payment_type, plan_or_project_id, amount_sar, status').eq('moyasar_payment_id', paymentData.id).maybeSingle();
    if (existing) {
      const sameTransaction = existing.user_id === req.user.id && existing.payment_type === paymentType && existing.plan_or_project_id === planOrProjectId && Number(existing.amount_sar) === paidAmount && existing.status === 'paid';
      if (!sameTransaction) return res.status(409).json({ error: 'عملية الدفع هذه مرتبطة بطلب آخر ولا يمكن إعادة استخدامها.' });
      // إعادة تطبيق التفعيل بأمان إذا انقطع الاتصال بعد تسجيل الدفع وقبل تحديث الاشتراك/المشروع.
      if (paymentType === 'SUBSCRIPTION') {
        const days = planOrProjectId === 'YEARLY' ? 365 : planOrProjectId === 'MONTHLY' ? 30 : 7;
        const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
        const { error } = await supabaseAdmin.from('profiles').update({ subscription_plan: planOrProjectId, subscription_expires_at: expiresAt }).eq('id', req.user.id);
        if (error) throw error;
      } else {
        const { error } = await supabaseAdmin.from('anime_projects').update({ payment_status: 'PAID' }).eq('id', planOrProjectId).eq('user_id', req.user.id);
        if (error) throw error;
      }
      return res.json({ verified: true, amountSar: paidAmount, status: 'paid', alreadyVerified: true });
    }
    if (projectAlreadyPaid) return res.status(409).json({ error: 'هذا المشروع مدفوع مسبقاً ولا توجد عملية دفع مطابقة محفوظة.' });

    const { error: insertErr } = await supabaseAdmin.from('payments').insert({
      user_id: req.user.id,
      moyasar_payment_id: paymentData.id,
      payment_type: paymentType,
      plan_or_project_id: planOrProjectId,
      amount_sar: paidAmount,
      currency: 'SAR',
      status: 'paid',
      raw_gateway_response: paymentData
    });
    if (insertErr) throw insertErr;

    if (paymentType === 'SUBSCRIPTION') {
      const days = planOrProjectId === 'YEARLY' ? 365 : planOrProjectId === 'MONTHLY' ? 30 : 7;
      const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      const { error } = await supabaseAdmin.from('profiles').update({ subscription_plan: planOrProjectId, subscription_expires_at: expiresAt }).eq('id', req.user.id);
      if (error) throw error;
    } else {
      const { data: updated, error } = await supabaseAdmin.from('anime_projects').update({ payment_status: 'PAID' }).eq('id', planOrProjectId).eq('user_id', req.user.id).eq('payment_status', 'UNPAID').select('id').maybeSingle();
      if (error || !updated) throw error || new Error('تعذر تحديث حالة دفع المشروع.');
    }
    res.json({ verified: true, amountSar: paidAmount, status: 'paid' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'خطأ أثناء التحقق من الدفع.' });
  }
});

// ============================================================================
// 8. لوحة تحكم المالك: الأرباح الفعلية والمصروفات وصافي الربح وإدارة المستخدمين
// ============================================================================
app.get('/api/owner/dashboard', requireAuth, requireOwner, async (req, res) => {
  try {
    const [{ data: users }, { data: payments }, { data: expenses }, { count: convCount }, { count: projCount }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, email, full_name, role, subscription_plan, subscription_expires_at, created_at').order('created_at', { ascending: false }),
      supabaseAdmin.from('payments').select('*').eq('status', 'paid').order('verified_at', { ascending: false }),
      supabaseAdmin.from('expenses').select('*').order('recorded_at', { ascending: false }),
      supabaseAdmin.from('conversations').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('anime_projects').select('*', { count: 'exact', head: true })
    ]);

    const totalRevenue = (payments || []).reduce((sum, p) => sum + Number(p.amount_sar || 0), 0);
    const totalExpenses = (expenses || []).reduce((sum, e) => sum + Number(e.amount_sar || 0), 0);
    const netProfit = totalRevenue - totalExpenses;

    res.json({
      financials: {
        totalRevenue,
        totalExpenses,
        netProfit,
        paymentsCount: (payments || []).length
      },
      usage: {
        usersCount: (users || []).length,
        conversationsCount: convCount || 0,
        animeProjectsCount: projCount || 0
      },
      users: users || [],
      payments: payments || [],
      expenses: expenses || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/owner/expenses', requireAuth, requireOwner, async (req, res) => {
  const { category, description, amount_sar } = req.body;
  if (!category || !description || Number(amount_sar) <= 0) {
    return res.status(400).json({ error: 'بيانات المصروف غير مكتملة.' });
  }
  const { data, error } = await supabaseAdmin
    .from('expenses')
    .insert({
      category,
      description,
      amount_sar: Number(amount_sar),
      recorded_by: req.user.id
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ expense: data });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.message?.includes('غير مسموح') ? 403 : 500;
  res.status(status).json({ error: status === 403 ? err.message : 'حدث خطأ داخلي في الخادم.' });
});

app.listen(PORT, () => {
  console.log(`AI GPT PRO Backend running on port ${PORT}`);
});
