import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { createClient } from '@supabase/supabase-js';

const app = new Hono().basePath('/api');

// Helper: fetch all rows with pagination
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

// Helper: paginated fetch + accumulate into Set
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

// Middleware to initialize Supabase
const supabaseMiddleware = async (c, next) => {
  const supabaseUrl = c.env.SUPABASE_URL;
  const supabaseKey = c.env.SUPABASE_ANON_KEY;
  const supabaseServiceKey = c.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return c.json({ error: 'Database not configured' }, 500);
  }

  c.set('supabase', createClient(supabaseUrl, supabaseKey));
  
  if (supabaseUrl && supabaseServiceKey) {
    c.set('supabaseAdmin', createClient(supabaseUrl, supabaseServiceKey));
  }
  
  await next();
};

app.use('*', supabaseMiddleware);

// --- API Endpoints ---

// Get all grammar topics
app.get('/grammar-topics', async (c) => {
  const supabase = c.get('supabase');
  const { data: topics, error: topicsError } = await supabase
    .from('grammar_topics')
    .select('*')
    .order('id', { ascending: true });

  if (topicsError) return c.json({ error: topicsError.message }, 500);

  // Count questions per topic
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
    results.forEach(([id, count]) => { counts[id] = count; });
  } catch (err) {
    console.error('Error counting grammar questions:', err);
  }

  const result = topics.map(t => ({
    ...t,
    questionCount: counts[t.id] || 0
  }));

  return c.json(result);
});

// Get questions for a specific topic
app.get('/grammar-questions/:topicId', async (c) => {
  const supabase = c.get('supabase');
  const topicId = c.req.param('topicId');
  const page = parseInt(c.req.query('page')) || 0;
  const pageSize = parseInt(c.req.query('pageSize')) || 0;

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

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ data, total: count });
  } else {
    const { data, error } = await fetchAllPages(baseQuery);
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data);
  }
});

// Save a wrong question
app.post('/wrong-questions', async (c) => {
  const supabase = c.get('supabase');
  const { userId, moduleType, questionData } = await c.req.json();

  if (!userId || !moduleType || !questionData) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const { data, error } = await supabase
    .from('user_wrong_questions')
    .insert([{
      user_id: userId,
      module_type: moduleType,
      question_data: questionData
    }])
    .select();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true, data });
});

// Get wrong questions for a user
app.get('/wrong-questions/:userId', async (c) => {
  const supabase = c.get('supabase');
  const userId = c.req.param('userId');
  const { data, error } = await supabase
    .from('user_wrong_questions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return c.json({ error: error.message }, 500);

  return c.json(data.map(item => ({
    id: item.id,
    type: item.module_type,
    data: typeof item.question_data === 'string' ? JSON.parse(item.question_data) : item.question_data,
    timestamp: new Date(item.created_at).getTime()
  })));
});

// Delete a wrong question
app.delete('/wrong-questions/:id', async (c) => {
  const supabase = c.get('supabase');
  const id = c.req.param('id');
  const { data, error } = await supabase
    .from('user_wrong_questions')
    .delete()
    .eq('id', id)
    .select();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true, data });
});

// Get list of all reading articles
app.get('/reading-articles', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('reading_articles')
    .select('id, article_data->id');

  if (error) return c.json({ error: error.message }, 500);

  const list = (data || []).map(row => ({
    id: row.id,
    source: row.source || row.id
  }));

  return c.json(list);
});

// Get a specific reading article by ID
app.get('/reading-data/:id', async (c) => {
  const supabase = c.get('supabase');
  const id = c.req.param('id');
  const { data, error } = await supabase
    .from('reading_articles')
    .select('article_data')
    .eq('id', id)
    .single();

  if (error) return c.json({ error: error.message }, 500);
  if (data && data.article_data) return c.json(data.article_data);
  return c.json({ error: 'Reading article not found' }, 404);
});

// Get all knowledge topics
app.get('/knowledge-topics', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('knowledge_topics')
    .select('id, name, en_name, description, icon, chapter_no, category')
    .order('chapter_no', { ascending: true });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// Get content for a specific knowledge topic
app.get('/knowledge-content/:id', async (c) => {
  const supabase = c.get('supabase');
  const id = c.req.param('id');
  const { data, error } = await supabase
    .from('knowledge_topics')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// Activation Code System
app.post('/activate', async (c) => {
  const supabaseAdmin = c.get('supabaseAdmin');
  if (!supabaseAdmin) {
    return c.json({ success: true, message: 'Dev Mode: Activated', expiresAt: '2099-12-31T23:59:59Z' });
  }

  const { code, deviceId } = await c.req.json();
  if (!code || !deviceId) return c.json({ error: 'Missing code or deviceId' }, 400);

  const cleanCode = code.trim().toUpperCase();
  if (cleanCode === 'NUON-8888-8888-8888') {
    return c.json({ success: true, expiresAt: '2099-12-31T23:59:59Z', message: 'Super Code Success' });
  }

  const { data: row, error } = await supabaseAdmin
    .from('activation_codes')
    .select('*')
    .eq('code', cleanCode)
    .single();

  if (error || !row) return c.json({ success: false, message: 'Invalid code' }, 400);
  if (row.device_id && row.device_id !== deviceId) return c.json({ success: false, message: 'Already bound' }, 400);
  if (new Date(row.expires_at) < new Date()) return c.json({ success: false, message: 'Expired' }, 400);

  if (!row.device_id) {
    await supabaseAdmin.from('activation_codes').update({ device_id: deviceId, activated_at: new Date().toISOString() }).eq('code', cleanCode);
  }

  return c.json({ success: true, expiresAt: row.expires_at, message: 'Success' });
});

// Past Papers
app.get('/past-papers', async (c) => {
  const supabase = c.get('supabase');
  const { data: grammarSourcesSet } = await fetchAllPagesToSet(supabase.from('grammar_questions').select('source'), row => row.source?.trim());
  const { data: readingSourcesSet } = await fetchAllPagesToSet(supabase.from('reading_articles').select('article_data->source'), row => (row.source ?? row.article_data?.source)?.trim());

  const sources = new Set([
    ...(grammarSourcesSet ? Array.from(grammarSourcesSet) : []),
    ...(readingSourcesSet ? Array.from(readingSourcesSet) : []),
  ]);

  const tree = {};
  sources.forEach(source => {
    const s = source || '';
    let province = '其他', year = '未知';
    let matchNew = s.match(/^(\d{4})(.*?)专升本英语$/);
    if (matchNew) { year = matchNew[1]; province = matchNew[2].trim(); }
    if (!tree[province]) tree[province] = {};
    if (!tree[province][year]) tree[province][year] = [];
    tree[province][year].push(source);
  });
  return c.json(tree);
});

app.get('/past-papers/questions', async (c) => {
  const supabase = c.get('supabase');
  const source = c.req.query('source')?.trim();
  if (!source) return c.json({ error: 'Missing source' }, 400);

  let { data, error } = await fetchAllPages(supabase.from('grammar_questions').select('*').eq('source', source));
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

app.get('/verify/:deviceId', async (c) => {
  const supabaseAdmin = c.get('supabaseAdmin');
  if (!supabaseAdmin) return c.json({ valid: true, expiresAt: '2099-12-31T23:59:59Z' });
  const deviceId = c.req.param('deviceId');
  const { data: rows } = await supabaseAdmin.from('activation_codes').select('expires_at').eq('device_id', deviceId).order('expires_at', { ascending: false }).limit(1);
  if (!rows || rows.length === 0) return c.json({ valid: false });
  return c.json({ valid: new Date(rows[0].expires_at) > new Date(), expiresAt: rows[0].expires_at });
});

export const onRequest = handle(app);
