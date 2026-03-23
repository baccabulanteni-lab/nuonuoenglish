import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static files from the React app dist directory
// In a monolithic deployment (Zeabur), the server serves the frontend
app.use(express.static(path.join(__dirname, '../dist')));

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
let supabase;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Supabase client initialized');
} else {
  console.warn('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env file. API endpoints will fail.');
}


// Helper: fetch all rows with pagination (bypasses Supabase's 1000-row default limit)
async function fetchAllPages(query, { pageSize = 1000 } = {}) {
  let allData = [];
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { data: allData, error: null };
}

// Helper: paginated fetch + accumulate into Set (avoid concatenating full arrays)
async function fetchAllPagesToSet(query, getValue, { pageSize = 1000 } = {}) {
  const set = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    for (const row of data) {
      const v = getValue(row);
      if (v != null && v !== '') set.add(v);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { data: set, error: null };
}

// Simple in-memory TTL cache to avoid repeating expensive queries
const memoryCache = new Map(); // key -> { expiresAt, value }
function cacheGet(key) {
  const hit = memoryCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    memoryCache.delete(key);
    return undefined;
  }
  return hit.value;
}
function cacheSet(key, value, ttlMs) {
  memoryCache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

// --- API Endpoints ---

// Get all grammar topics with question counts
app.get('/api/grammar-topics', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const cacheKey = 'grammar-topics-v2';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  // Fetch topics
  const { data: topics, error: topicsError } = await supabase
    .from('grammar_topics')
    .select('*')
    .order('id', { ascending: true });

  if (topicsError) {
    console.error('Error fetching topics:', topicsError);
    return res.status(500).json({ error: topicsError.message });
  }

  // Efficiently count questions per topic (using topic_ids array)
  let counts = {};
  try {
    const results = await Promise.all(topics.map(async t => {
      const { count, error } = await supabase
        .from('grammar_questions')
        .select('id', { count: 'exact', head: true })
        .contains('topic_ids', [t.id]);
      
      if (error) throw error;
      return [t.id, count || 0];
    }));
    results.forEach(([id, c]) => {
      counts[id] = c;
    });
  } catch (err) {
    console.error('Error counting grammar questions:', err);
  }

  const result = topics.map(t => ({
    ...t,
    questionCount: counts[t.id] || 0
  }));

  cacheSet(cacheKey, result, 300_000); // 5 min TTL
  res.json(result);
});

// Get questions for a specific topic (with optional pagination)
app.get('/api/grammar-questions/:topicId', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const { topicId } = req.params;
  const page = parseInt(req.query.page) || 0;
  const pageSize = parseInt(req.query.pageSize) || 0;

  let baseQuery = supabase.from('grammar_questions').select('*', { count: 'exact' });
  
  if (topicId !== 'all') {
    baseQuery = baseQuery.contains('topic_ids', [topicId]);
  }

  if (pageSize > 0) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await baseQuery
      .range(from, to)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching paginated questions:', error);
      return res.status(500).json({ error: error.message });
    }
    return res.json({ data, total: count });
  } else {
    // Legacy: fetch all pages (careful with table size)
    const { data, error } = await fetchAllPages(baseQuery);
    if (error) {
      console.error('Error fetching questions:', error);
      return res.status(500).json({ error: error.message });
    }
    return res.json(data);
  }
});

// Save a wrong question
app.post('/api/wrong-questions', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const { userId, moduleType, questionData } = req.body;

  if (!userId || !moduleType || !questionData) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data, error } = await supabase
    .from('user_wrong_questions')
    .insert([
      {
        user_id: userId,
        module_type: moduleType,
        question_data: questionData
      }
    ])
    .select();

  if (error) {
    console.error('Error saving wrong question:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true, data });
});

// Get wrong questions for a user
app.get('/api/wrong-questions/:userId', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const { userId } = req.params;
  const { data, error } = await supabase
    .from('user_wrong_questions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching wrong questions:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data.map(item => ({
    id: item.id,
    type: item.module_type,
    data: typeof item.question_data === 'string' ? JSON.parse(item.question_data) : item.question_data,
    timestamp: new Date(item.created_at).getTime()
  })));
});

// Delete a wrong question
app.delete('/api/wrong-questions/:id', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const { id } = req.params;
  const { data, error } = await supabase
    .from('user_wrong_questions')
    .delete()
    .eq('id', id)
    .select();

  if (error) {
    console.error('Error deleting wrong question:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true, data });
});

// Get list of all reading articles (for the selection screen)
app.get('/api/reading-articles', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const { data, error } = await supabase
    .from('reading_articles')
    .select('id, article_data->id, article_data->source');

  if (error) {
    console.error('Error listing reading articles:', error);
    return res.status(500).json({ error: error.message });
  }

  // Return just the metadata for the selection screen (no questions/article text)
  const list = (data || []).map(row => ({
    id: row.id,
    source: row.source || row.id
  }));

  res.json(list);
});

// Get a specific reading article by ID
app.get('/api/reading-data/:id', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const { id } = req.params;
  const { data, error } = await supabase
    .from('reading_articles')
    .select('article_data')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching reading article:', error);
    return res.status(500).json({ error: error.message });
  }

  if (data && data.article_data) {
    res.json(data.article_data);
  } else {
    res.status(404).json({ error: 'Reading article not found' });
  }
});

// --- Knowledge Topics (语法知识点) Endpoints ---

// Get all knowledge topics
app.get('/api/knowledge-topics', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const { data, error } = await supabase
    .from('knowledge_topics')
    .select('id, name, en_name, description, icon, chapter_no, category')
    .order('chapter_no', { ascending: true });

  if (error) {
    console.error('Error fetching knowledge topics:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// Get content for a specific knowledge topic
app.get('/api/knowledge-content/:id', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const { id } = req.params;
  const { data, error } = await supabase
    .from('knowledge_topics')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching knowledge content:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// Legacy: keep this for backward compat - returns first article
app.get('/api/reading-data', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const { data, error } = await supabase
    .from('reading_articles')
    .select('article_data')
    .limit(1)
    .single();

  if (error) {
    console.error('Error fetching reading data:', error);
    return res.status(500).json({ error: error.message });
  }

  if (data && data.article_data) {
    res.json(data.article_data);
  } else {
    res.status(404).json({ error: 'No reading data found' });
  }
});

// --- Activation Code System ---

// Initialize admin client for activation code operations (needs service_role to write)
const supabaseAdminUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
let supabaseAdmin;
if (supabaseAdminUrl && supabaseServiceKey) {
  supabaseAdmin = createClient(supabaseAdminUrl, supabaseServiceKey);
} else {
  console.warn('Missing SUPABASE_SERVICE_ROLE_KEY — activation code endpoints will not work.');
}

// POST /api/activate — 激活码验证 + 设备绑定
app.post('/api/activate', async (req, res) => {
  if (!supabaseAdmin) {
    console.warn('Development Mode: SUPABASE_SERVICE_ROLE_KEY missing, allowing activation.');
    return res.json({ success: true, message: '开发模式：已自动激活 (本地服务未配置密钥)', expiresAt: '2099-12-31T23:59:59Z' });
  }

  const { code, deviceId } = req.body;
  if (!code || !deviceId) return res.status(400).json({ error: 'Missing code or deviceId' });

  const cleanCode = code.trim().toUpperCase();

  // --- Bypass: Super Activation Code ---
  if (cleanCode === 'NUON-8888-8888-8888') {
    return res.json({
      success: true,
      expiresAt: '2099-12-31T23:59:59Z',
      message: '超级激活码验证成功！授权至 2099 年。'
    });
  }

  // Find the code
  const { data: row, error } = await supabaseAdmin
    .from('activation_codes')
    .select('*')
    .eq('code', cleanCode)
    .single();

  if (error || !row) {
    return res.status(400).json({ success: false, message: '激活码不存在，请检查输入是否有误。' });
  }

  // Check if already bound to a DIFFERENT device
  if (row.device_id && row.device_id !== deviceId) {
    return res.status(400).json({ success: false, message: '该激活码已被其他设备使用，无法重复激活。' });
  }

  // Check expiry
  if (new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ success: false, message: '该激活码已过期，请联系客服。' });
  }

  // If not yet bound, bind to this device now
  if (!row.device_id) {
    const { error: updateError } = await supabaseAdmin
      .from('activation_codes')
      .update({ device_id: deviceId, activated_at: new Date().toISOString() })
      .eq('code', cleanCode);

    if (updateError) {
      console.error('Error binding code:', updateError);
      return res.status(500).json({ success: false, message: '激活失败，请稍后重试。' });
    }
  }

  res.json({
    success: true,
    expiresAt: row.expires_at,
    message: '激活成功！'
  });
});

// --- Past Papers (真题) Endpoints ---

function parseSource(source) {
  if (!source) return { year: '未知', province: '其他' };
  const s = source.trim();
  
  // 匹配新格式: 2025贵州专升本英语 / 2024年湖南省专升本真题 / 旧格式真题 等
  let matchNew = s.match(/^(\d{4})(.*?)专升本英语$/);
  let matchOld = s.match(/^(\d{4})年?(.*?)(?:省)?(?:普通高等教育)?专升本.*?真题$/);

  if (matchNew) {
    return { year: matchNew[1], province: matchNew[2].replace('省', '').trim() };
  } else if (matchOld) {
    return { year: matchOld[1], province: matchOld[2].replace('省', '').trim() };
  }
  return { year: '未知', province: '其他' };
}

app.get('/api/past-papers', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });

  const cacheKey = 'past-papers-sources';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  // 1. Get unique sources from grammar questions (Set accumulation avoids building huge arrays)
  const { data: grammarSourcesSet, error: gError } = await fetchAllPagesToSet(
    supabase.from('grammar_questions').select('source'),
    row => row.source?.trim(),
    { pageSize: 5000 }
  );

  // 2. Get unique sources from reading articles
  const { data: readingSourcesSet, error: rError } = await fetchAllPagesToSet(
    // Only fetch the article_data->source field (much smaller than full JSON)
    supabase.from('reading_articles').select('article_data->source'),
    row => (row.source ?? row.article_data?.source)?.trim(),
    { pageSize: 5000 }
  );

  if (gError || rError) {
    console.error('Error fetching paper sources:', gError || rError);
    return res.status(500).json({ error: (gError || rError).message });
  }

  const sources = new Set([
    ...(grammarSourcesSet ? Array.from(grammarSourcesSet) : []),
    ...(readingSourcesSet ? Array.from(readingSourcesSet) : []),
  ]);

  // Group by province and year
  const tree = {}; // { province: { year: [sources] } }

  sources.forEach(source => {
    const { year, province } = parseSource(source);
    if (!tree[province]) tree[province] = {};
    if (!tree[province][year]) tree[province][year] = [];
    tree[province][year].push(source);
  });

  cacheSet(cacheKey, tree, 5 * 60_000); // 5 min TTL
  res.json(tree);
});

app.get('/api/past-papers/questions', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });
  const { source } = req.query;
  if (!source) return res.status(400).json({ error: 'Missing source parameter' });

  const cleanSource = source.trim();
  console.log(`[PAST-PAPERS] Fetching questions for: "${cleanSource}"`);

  // Try exact match first
  let { data, error } = await fetchAllPages(
    supabase.from('grammar_questions')
      .select('*')
      .eq('source', cleanSource)
  );

  // Fallback to fuzzy match if exact fails
  if (!error && (!data || data.length === 0)) {
    console.log(`[PAST-PAPERS] Exact match failed, trying fuzzy matching...`);
    const fuzzy = await fetchAllPages(
      supabase.from('grammar_questions')
        .select('*')
        .ilike('source', `%${cleanSource.replace(/\s+/g, '%')}%`) // Try matching with wildcard for spaces
    );
    if (!fuzzy.error && fuzzy.data?.length > 0) {
      console.log(`[PAST-PAPERS] Fuzzy match found ${fuzzy.data.length} questions.`);
      data = fuzzy.data;
    }
  }

  if (error) {
    console.error('Error fetching paper questions:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[PAST-PAPERS] Sorting and returning ${data?.length || 0} questions for: "${cleanSource}"`);
  
  // Sort by question number found in text (e.g. "1. ", "Part I... 1. ")
  const sortedData = (data || []).sort((a, b) => {
    const matchA = a.text.match(/(\d+)\./);
    const matchB = b.text.match(/(\d+)\./);
    const numA = matchA ? parseInt(matchA[1]) : 999;
    const numB = matchB ? parseInt(matchB[1]) : 999;
    return numA - numB;
  });

  res.json(sortedData);
});

app.get('/api/past-papers/readings', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Database not configured' });
  const { source } = req.query;
  if (!source) return res.status(400).json({ error: 'Missing source parameter' });

  // Filter reading articles where article_data->source equals the source
  const { data, error } = await supabase
    .from('reading_articles')
    .select('article_data')
    .eq('article_data->>source', source);

  if (error) {
    console.error('Error fetching paper readings:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json((data || []).map(row => row.article_data));
});

app.get('/api/verify/:deviceId', async (req, res) => {
  if (!supabaseAdmin) {
    console.warn(`Development Mode: SUPABASE_SERVICE_ROLE_KEY missing, bypassing verification for device ${req.params.deviceId}`);
    return res.json({ valid: true, expiresAt: '2099-12-31T23:59:59Z' });
  }

  const { deviceId } = req.params;

  const { data: rows, error } = await supabaseAdmin
    .from('activation_codes')
    .select('expires_at, code')
    .eq('device_id', deviceId)
    .order('expires_at', { ascending: false })
    .limit(1);

  if (error || !rows || rows.length === 0) {
    return res.json({ valid: false });
  }

  const row = rows[0];
  const isValid = new Date(row.expires_at) > new Date();

  res.json({
    valid: isValid,
    expiresAt: row.expires_at
  });
});

// The catch-all handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
  // Only serve index.html if it exists (prevents infinite loops if dist is missing locally)
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// Vercel Serverless Export or Local Server
if (process.env.VERCEL) {
  // If running on Vercel, export the Express app to let Vercel handle the request
  // No need to listen on a port
} else {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend server running on port ${port}`);
  });
}

// ESM Export for Vercel Serverless Functions
export default app;
