/**
 * studyStats.ts
 * 
 * 本地存储每个知识点（topic_id）的答题统计：答对次数 / 总次数。
 * 所有数据保存在 localStorage，无需网络，刷新后仍然保留。
 */

const STORAGE_KEY = 'nuonuo_study_stats';

export interface TopicStats {
    correct: number;
    total: number;
}

export type AllStats = Record<string, TopicStats>;

/** 读取全部统计数据 */
export function getStats(): AllStats {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

/** 记录一次答题结果 */
export function recordAnswer(topicId: string, isCorrect: boolean): void {
    if (!topicId) return;
    const stats = getStats();
    if (!stats[topicId]) {
        stats[topicId] = { correct: 0, total: 0 };
    }
    stats[topicId].total += 1;
    if (isCorrect) stats[topicId].correct += 1;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch {
        // localStorage full — silently skip
    }
}

/** 获取某知识点正确率（0-1），没有记录返回 -1 */
export function getTopicAccuracy(topicId: string): number {
    const stats = getStats();
    const s = stats[topicId];
    if (!s || s.total === 0) return -1;
    return s.correct / s.total;
}

/** 清空全部统计（调试用） */
export function clearStats(): void {
    localStorage.removeItem(STORAGE_KEY);
}
