require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

/**
 * 糯糯背单词 - 用户学习数据导出工具
 * 
 * 运行方式: node scripts/export_user_stats.cjs
 * 
 * 注意: 为了读取所有用户的数据，建议在 .env 中配置 SUPABASE_SERVICE_ROLE_KEY。
 * 如果只使用 ANON_KEY，受 RLS 限制可能无法获取完整列表。
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
// 优先使用 Service Role Key 以绕过 RLS
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('错误: 缺少 Supabase 配置信息。请在 .env 中设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY (或 SUPABASE_SERVICE_ROLE_KEY)。');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function exportStats() {
  console.log('正在从 Supabase 获取用户进度...');

  // 1. 获取所有用户进度
  const { data: progressData, error: progressError } = await supabase
    .from('user_progress')
    .select('profile_id, payload, updated_at');

  if (progressError) {
    console.error('获取进度失败:', progressError.message);
    return;
  }

  // 2. 获取用户信息 (用于匹配用户名)
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username');

  if (profilesError) {
    console.warn('获取用户信息失败 (可能无法显示用户名):', profilesError.message);
  }

  const profileMap = new Map(profiles?.map(p => [p.id, p.username]) || []);

  const report = [];

  for (const row of progressData) {
    const username = profileMap.get(row.profile_id) || '未知用户';
    const payload = row.payload;

    if (!payload || typeof payload !== 'object') continue;

    // 解析 payload 里的 vocab_stats (它是字符串化的 JSON)
    const statsRaw = payload.vocab_stats;
    if (!statsRaw) continue;

    try {
      const stats = JSON.parse(statsRaw);
      const history = stats.history || {};

      for (const [date, dayData] of Object.entries(history)) {
        if (!dayData || typeof dayData !== 'object') continue;

        const d = dayData;
        const totalCount = (d.new || 0) + (d.familiar_70 || 0) + (d.familiar_100 || 0) + (d.reviewed || 0);
        const studyTimeMinutes = Math.round((d.studyTime || 0) / 60 * 10) / 10;

        report.push({
          username,
          date,
          totalCount,
          studyTimeMinutes,
          userId: row.profile_id
        });
      }
    } catch (e) {
      console.warn(`解析用户 ${username} 的统计数据失败:`, e.message);
    }
  }

  // 按日期降序排列
  report.sort((a, b) => b.date.localeCompare(a.date) || a.username.localeCompare(b.username));

  // 输出到控制台
  console.log('\n--- 用户每日学习工作量报告 ---');
  console.table(report.slice(0, 50)); // 只打印前 50 条

  // 保存到 CSV
  const csvHeader = '用户名,日期,刷词量,学习时长(分钟),用户ID\n';
  const csvRows = report.map(r => `${r.username},${r.date},${r.totalCount},${r.studyTimeMinutes},${r.userId}`).join('\n');
  const csvContent = csvHeader + csvRows;

  const outputPath = path.join(process.cwd(), 'user_study_report.csv');
  fs.writeFileSync(outputPath, '\ufeff' + csvContent); // 添加 BOM 以前 Excel 正确读取中文
  
  console.log(`\n报告已成功保存至: ${outputPath}`);
}

exportStats().catch(err => {
  console.error('运行出错:', err);
});
