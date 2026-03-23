import { Question, GrammarTopic, ReadingArticle, KnowledgePoint } from '../constants';
import grammarData from '../data/grammar-data.json';

const API_BASE_URL = '/api';

// --- Local Cache Helpers ---
const getCachedData = (key: string) => {
    try {
        const cached = localStorage.getItem(key);
        if (cached) return JSON.parse(cached);
    } catch (e) { }
    return null;
};

const setCachedData = (key: string, data: any) => {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) { }
};

export const fetchGrammarTopics = async (forceRefresh = false): Promise<GrammarTopic[]> => {
    // For the dedicated Grammar app or offline mode, we prioritize the local JSON "database"
    const localTopics: GrammarTopic[] = grammarData.categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        enName: cat.name.toUpperCase(), // Fallback
        desc: `包含 ${cat.subItems.join('、')} 等知识点`,
        icon: 'BookOpen',
        category: '语法体系',
        questionCount: grammarData.questions.filter(q => q.catId === cat.id).length
    }));

    // If we're in offline/emergency mode, we have the localTopics as fallback
    // but we should always try the API first if possible.

    const cacheKey = 'nuonuo_cache_topics';
    const cached = forceRefresh ? null : getCachedData(cacheKey);

    const fetchPromise = fetch(`${API_BASE_URL}/grammar-topics`)
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch topics');
            return res.json();
        })
        .then(data => {
            const formatted = data.map((item: any) => ({
                id: item.id,
                name: item.name,
                enName: item.en_name,
                desc: item.description,
                icon: item.icon,
                category: item.category || '语法体系',
                questionCount: item.questionCount || 0
            }));
            setCachedData(cacheKey, formatted);
            return formatted;
        })
        .catch(error => {
            console.error('API Error:', error);
            // Fallback to local data if API fails
            return localTopics;
        });

    if (cached) {
        fetchPromise.catch(() => { });
        return cached;
    }

    return fetchPromise;
};

export const fetchGrammarQuestions = async (topicId: string, forceRefresh = false): Promise<Question[]> => {
    // Local data lookup
    const localQs = (grammarData.questions as any[])
        .filter(q => q.catId === topicId || topicId === 'all')
        .map(q => ({
            ...q,
            topicId: q.catId // Mapping for compatibility
        }));

    // Always try the API first if possible

    const cacheKey = `nuonuo_cache_questions_${topicId}`;
    const cached = forceRefresh ? null : getCachedData(cacheKey);

    const fetchPromise = fetch(`${API_BASE_URL}/grammar-questions/${topicId}`)
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch questions');
            return res.json();
        })
        .then(data => {
            setCachedData(cacheKey, data);
            return data;
        })
        .catch(error => {
            console.error('API Error:', error);
            return localQs;
        });

    if (cached) {
        fetchPromise.catch(() => { });
        return cached;
    }

    return fetchPromise;
};

export const fetchKnowledgePoint = async (pointId: string): Promise<KnowledgePoint | null> => {
    // Local lookup in JSON
    const point = (grammarData.knowledgePoints as any)[pointId];
    if (point) return point;

// Fallback/Placeholder
    return null;
};

export const fetchKnowledgeTopics = async (): Promise<any[]> => {
    try {
        const response = await fetch(`${API_BASE_URL}/knowledge-topics`);
        if (!response.ok) throw new Error('Failed to fetch knowledge topics');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return [];
    }
};

export const fetchKnowledgeContent = async (id: string): Promise<any | null> => {
    try {
        const response = await fetch(`${API_BASE_URL}/knowledge-content/${id}`);
        if (!response.ok) throw new Error('Failed to fetch knowledge content');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return null;
    }
};

export const saveWrongQuestionAPI = async (userId: string, moduleType: string, questionData: any) => {
    try {
        const response = await fetch(`${API_BASE_URL}/wrong-questions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId, moduleType, questionData }),
        });
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return null;
    }
};

export const fetchUserWrongQuestions = async (userId: string) => {
    try {
        const response = await fetch(`${API_BASE_URL}/wrong-questions/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch wrong questions');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return [];
    }
};

export const deleteWrongQuestionAPI = async (id: string) => {
    try {
        const response = await fetch(`${API_BASE_URL}/wrong-questions/${id}`, {
            method: 'DELETE',
        });
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return null;
    }
};

export const fetchReadingArticles = async (): Promise<{ id: string; source: string }[]> => {
    try {
        const response = await fetch(`${API_BASE_URL}/reading-articles`);
        if (!response.ok) throw new Error('Failed to fetch reading articles list');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return [];
    }
};

export const fetchReadingById = async (id: string): Promise<ReadingArticle | null> => {
    try {
        const response = await fetch(`${API_BASE_URL}/reading-data/${id}`);
        if (!response.ok) throw new Error('Failed to fetch reading article');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return null;
    }
};

export const fetchReadingData = async (): Promise<ReadingArticle | null> => {
    try {
        const response = await fetch(`${API_BASE_URL}/reading-data`);
        if (!response.ok) throw new Error('Failed to fetch reading data');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return null;
    }
};


// --- Activation Code API ---

export const verifyDevice = async (deviceId: string): Promise<{ valid: boolean; expiresAt?: string }> => {
    try {
        const response = await fetch(`${API_BASE_URL}/verify/${deviceId}`);
        if (!response.ok) return { valid: false };
        return await response.json();
    } catch {
        return { valid: false };
    }
};

export const activateCode = async (code: string, deviceId: string): Promise<{ success: boolean; message: string; expiresAt?: string }> => {
    try {
        const response = await fetch(`${API_BASE_URL}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, deviceId }),
        });
        return await response.json();
    } catch {
        return { success: false, message: '网络异常，请检查网络连接后重试。' };
    }
};
export const fetchPastPapers = async (): Promise<Record<string, Record<string, string[]>>> => {
    try {
        const response = await fetch(`${API_BASE_URL}/past-papers`);
        if (!response.ok) throw new Error('Failed to fetch past papers');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return {};
    }
};

export const fetchPaperQuestions = async (source: string): Promise<Question[]> => {
    try {
        const response = await fetch(`${API_BASE_URL}/past-papers/questions?source=${encodeURIComponent(source)}`);
        if (!response.ok) throw new Error('Failed to fetch paper questions');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return [];
    }
};

export const fetchPaperReadings = async (source: string): Promise<ReadingArticle[]> => {
    try {
        const response = await fetch(`${API_BASE_URL}/past-papers/readings?source=${encodeURIComponent(source)}`);
        if (!response.ok) throw new Error('Failed to fetch paper readings');
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return [];
    }
};
