import { safeJsonParse } from './safeJsonParse';

/** 首页等模块依赖累计「全熟」次数；与 VocabularyModule 写入 vocab_stats 后派发 */
export const VOCAB_STATS_UPDATED_EVENT = 'vocab-stats-updated';
/** 云端拉取成功并应用到本地后的通知 */
export const VOCAB_PULL_SYNCED_EVENT = 'vocab-pull-synced';

export function dispatchVocabStatsUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(VOCAB_STATS_UPDATED_EVENT));
}

export function dispatchVocabPullSynced() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(VOCAB_PULL_SYNCED_EVENT));
}

/** 从 localStorage 读出累计「全熟」标记次数 */
export function readMasteredWordCount(): number {
  if (typeof localStorage === 'undefined') return 0;
  const s = safeJsonParse<{ familiar_100?: unknown } | null>(
    localStorage.getItem('vocab_stats'),
    null
  );
  if (!s || typeof s !== 'object') return 0;
  const n = s.familiar_100;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
