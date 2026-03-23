import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Question, GrammarTopic, KnowledgePoint } from '../constants';
import { fetchGrammarTopics, fetchGrammarQuestions, fetchKnowledgePoint, saveWrongQuestionAPI } from '../services/api';
import { cn } from './UI';
import { Check, X, ChevronRight, ChevronLeft, RefreshCw, Sparkles, Loader2, List, ChevronDown, Trophy, Target, BookOpen, ExternalLink } from 'lucide-react';
import KnowledgeDrawer from './KnowledgeDrawer';
import { saveWrongQuestion } from '../utils/wrongQuestions';
import { recordAnswer } from '../utils/studyStats';
import { getStats } from '../utils/studyStats';
import { getDeviceId } from '../utils/deviceId';
import { COLORS, renderInlineStrong } from '../utils/grammarParser';

// ---------- LocalStorage helpers ----------
const LS_KEY_PREFIX = 'grammarProgress_';
function loadProgress(topicId: string) {
  try {
    const raw = localStorage.getItem(LS_KEY_PREFIX + topicId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveProgress(topicId: string, data: { order: number[]; index: number; answers?: (number | null)[] }) {
  try {
    localStorage.setItem(LS_KEY_PREFIX + topicId, JSON.stringify(data));
  } catch { }
}

type KeyPointBlock =
  | { type: 'section'; label: string; text: string }
  | { type: 'step'; text: string }
  | { type: 'option'; letter: string; text: string }
  | { type: 'paragraph'; text: string };

function stripEmojis(s: string) {
  return s.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu,
    '',
  );
}

function renderInlineRichText(text: string, opts: { onOpenVirtual?: () => void }) {
  const nodes: React.ReactNode[] = [];
  const virtualToken = '【虚拟语气】';
  const tipToken = '【踩分点】';

  const pushText = (t: string) => {
    if (!t) return;
    nodes.push(t);
  };

  let i = 0;
  let guard = 0;
  while (i < text.length && guard++ < 10000) {
    const idxBold = text.indexOf('**', i);
    const idxVirtual = text.indexOf(virtualToken, i);
    const idxTip = text.indexOf(tipToken, i);

    const candidates = [
      idxBold >= 0 ? idxBold : Number.POSITIVE_INFINITY,
      idxVirtual >= 0 ? idxVirtual : Number.POSITIVE_INFINITY,
      idxTip >= 0 ? idxTip : Number.POSITIVE_INFINITY,
    ];
    const minIdx = Math.min(...candidates);

    if (minIdx === Number.POSITIVE_INFINITY) {
      pushText(text.slice(i));
      break;
    }

    if (minIdx > i) pushText(text.slice(i, minIdx));

    if (minIdx === idxVirtual) {
      nodes.push(
        <span
          key={`v_${i}`}
          className="knowledge-trigger cursor-pointer text-[#b58362] font-bold underline underline-offset-4 decoration-dotted"
          onClick={opts.onOpenVirtual}
        >
          虚拟语气
        </span>,
      );
      i = minIdx + virtualToken.length;
      continue;
    }

    if (minIdx === idxTip) {
      nodes.push(
        <span
          key={`t_${i}`}
          className="analysis-tag-info font-bold px-2 py-0.5 rounded-lg border border-green-200 text-green-700 bg-green-50"
        >
          踩分点
        </span>,
      );
      i = minIdx + tipToken.length;
      continue;
    }

    // bold **...**
    if (minIdx === idxBold) {
      const end = text.indexOf('**', idxBold + 2);
      if (end < 0) {
        pushText(text.slice(i));
        break;
      }
      const bold = text.slice(idxBold + 2, end);
      nodes.push(
        <strong key={`b_${idxBold}`} className="analysis-bold-highlight" style={{ color: COLORS.accent }}>
          {bold}
        </strong>,
      );
      i = end + 2;
      continue;
    }

    // fallback
    pushText(text.slice(i, minIdx + 1));
    i = minIdx + 1;
  }

  return nodes;
}

function renderKeyPoint(text: string, onOpenVirtual: () => void) {
  const cleaned = stripEmojis(text)
    .replace(/^\s*[-—•*]{1,5}\s*$/gm, '') // standalone symbols
    .replace(/^\s*[^a-zA-Z0-9\u4e00-\u9fa5\s]{1,5}\s*$/gm, ''); // short symbol-only lines

  const lines = cleaned.split(/\r?\n/);
  const labelSet = new Set([
    '核心考点', '详细解析', '标准答案', '考点图谱', '题干破冰', '寻找线索', 
    '逻辑推理', '选项深挖', '技巧点拨', '高频错点', '命题人视角', '易错提醒', 
    '补充', '错误原因', '选项排除', '词义辨析', '语法规则', '基础例句', '例句'
  ]);

  const stepRe = /^\s*(?:\d+\.?\s*)?(第?[一二三四五]步)\s*[:：]?\s*(.*)$/;
  const optionRe = /^\s*([A-D])\.\s*([^：:\n]*)(?:[:：]\s*(.*))?$/;
  const sectionRe = new RegExp(`^\\s*(${Array.from(labelSet).join('|')})\\s*[:：]?\\s*(.*)$`);

  const blocks: KeyPointBlock[] = [];
  let cur: KeyPointBlock | null = null;

  const flush = () => {
    if (!cur) return;
    blocks.push(cur);
    cur = null;
  };

  const appendToCur = (line: string) => {
    if (!cur) {
      cur = { type: 'paragraph', text: line };
      return;
    }
    cur.text = cur.text ? `${cur.text}\n${line}` : line;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Step title
    const stepMatch = line.match(stepRe);
    if (stepMatch) {
      flush();
      const title = `${stepMatch[1]}${stepMatch[2] ? '：' + stepMatch[2] : ''}`;
      cur = { type: 'step', text: title };
      flush();
      continue;
    }

    // Section label (Label: xxx)
    const sectionMatch = line.match(sectionRe);
    if (sectionMatch) {
      flush();
      const label = sectionMatch[1];
      const rest = (sectionMatch[2] || '').trim();
      cur = { type: 'section', label, text: rest };
      continue;
    }

    // Option line
    const optMatch = line.match(optionRe);
    if (optMatch) {
      flush();
      const letter = optMatch[1];
      const t1 = (optMatch[2] || '').trim();
      const t2 = (optMatch[3] || '').trim();
      const text = t2 ? `${t1}：${t2}` : t1;
      cur = { type: 'option', letter, text };
      continue;
    }

    // Default: append to current block if any
    appendToCur(line);
  }
  flush();

  const renderParagraphWithBreaks = (s: string) => {
    const parts = s.split(/\n/);
    return parts.map((p, idx) => (
      <React.Fragment key={idx}>
        {renderInlineRichText(p, { onOpenVirtual })}
        {idx < parts.length - 1 ? <br /> : null}
      </React.Fragment>
    ));
  };

  return (
    <>
      {blocks.map((b, idx) => {
        if (b.type === 'section') {
          return (
            <div className="analysis-card mb-4" key={idx} style={{ background: COLORS.card, borderColor: COLORS.border }}>
              <span className="analysis-highlight-label" style={{ color: COLORS.accent, fontWeight: 700 }}>{b.label}：</span>
              <div className="analysis-point-text" style={{ marginTop: 6, color: COLORS.text }}>
                {b.text ? renderParagraphWithBreaks(b.text) : null}
              </div>
            </div>
          );
        }
        if (b.type === 'step') {
          return (
            <div className="analysis-step-title mb-3 mt-6" key={idx} style={{ color: COLORS.text, borderLeft: `3px solid ${COLORS.accent}`, paddingLeft: 12 }}>
              {b.text}
            </div>
          );
        }
        if (b.type === 'option') {
          return (
            <div className="analysis-option-block mb-3" key={idx}>
              <span className="analysis-label-theme" style={{ color: COLORS.accent, fontWeight: 700 }}>
                {b.letter}.
              </span>
              <div style={{ marginTop: 4, color: COLORS.text }}>
                {b.text ? renderParagraphWithBreaks(b.text) : null}
              </div>
            </div>
          );
        }
        return (
          <div key={idx} className="analysis-point-text mb-2" style={{ color: COLORS.text }}>
            {renderParagraphWithBreaks(b.text)}
          </div>
        );
      })}
    </>
  );
}

export default function GrammarModule({ 
  initialView = 'system',
  initialTopicId = null
}: { 
  initialView?: 'system' | 'practice' | 'knowledge',
  initialTopicId?: string | null
}) {
  const [activeView, setActiveView] = useState<'system' | 'practice' | 'knowledge'>(initialView);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [isFinished, setIsFinished] = useState(false);
  const [currentQuestions, setCurrentQuestions] = useState<Question[]>([]);
  const [showOverview, setShowOverview] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<(number | null)[]>([]);

  // Diagnostic states
  const [isDiagnosticMode, setIsDiagnosticMode] = useState(false);
  const [showDiagnosisReport, setShowDiagnosisReport] = useState(false);
  
  // Knowledge Drawer states
  const [isKnowledgeDrawerOpen, setIsKnowledgeDrawerOpen] = useState(false);
  const [activeKnowledgePoint, setActiveKnowledgePoint] = useState<KnowledgePoint | null>(null);

  // Accordion state - dynamically open all categories when topics load
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  // API State
  const [topics, setTopics] = useState<GrammarTopic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  const explanationRef = useRef<HTMLDivElement>(null);

  // ---------- Auto-select topic if provided ----------
  useEffect(() => {
    if (initialTopicId && topics.length > 0) {
      const topic = topics.find(t => t.id === initialTopicId);
      if (topic) {
        setActiveTopicId(initialTopicId);
        // If we are in practice view, we might need to load questions
        if (activeView === 'practice') {
          handleEnterTopic(initialTopicId);
        }
      }
    }
  }, [initialTopicId, topics, activeView]);

  // ---------- Fetch topics on mount ----------
  useEffect(() => {
    let mounted = true;
    // Clear old topic cache to ensure fresh data
    try { localStorage.removeItem('nuonuo_cache_topics'); } catch {}
    fetchGrammarTopics(true).then(data => {
      if (!mounted) return;
      const filtered = data.filter(t => t.id !== 't4' && t.id !== 't5');
      const totalQuestions = data.reduce((sum, t) => sum + (t.questionCount || 0), 0);
      const mixedTopic: GrammarTopic = {
        id: 'all',
        category: '全部',
        name: '混刷真题',
        enName: 'MIXED PRACTICE',
        desc: '所有语法真题随机出题，全面检测',
        icon: 'Sparkles',
        questionCount: totalQuestions,
      };
      setTopics([mixedTopic, ...filtered]);
      setLoadingTopics(false);

      // Auto-open all categories dynamically
      const allCats: Record<string, boolean> = {};
      filtered.forEach(t => {
        const cat = (t as any).category || '语法体系';
        allCats[cat] = true;
      });
      setOpenCategories(allCats);

      // If initialView is practice and topic is not set, default to 'all'
      if (initialView === 'practice' && !activeTopicId) {
        handleEnterTopic('all');
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const question = currentQuestions[currentQ];
  const activeTopic = topics.find(t => t.id === activeTopicId);

  const shuffleArray = (array: any[]) => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  };

  // ---------- Enter a topic ----------
  const handleEnterTopic = async (topicId: string) => {
    setActiveTopicId(topicId);
    setLoadingQuestions(true);
    setActiveView('practice');
    const fetched = await fetchGrammarQuestions(topicId);
    // Try to load saved shuffled order
    const saved = loadProgress(topicId);
    let ordered: Question[] = [];
    if (saved && saved.order && saved.order.length === fetched.length) {
      // saved.order is an array of original indices
      ordered = saved.order.map((origIdx: number) => fetched[origIdx]).filter(Boolean);
    } else {
      ordered = shuffleArray(fetched);
    }
    setCurrentQuestions(ordered);
    setLoadingQuestions(false);
    // Restore index and answers if saved
    const startIdx = saved?.index ?? 0;
    const savedAnswers = saved?.answers ?? new Array(fetched.length).fill(null);
    setCurrentQ(startIdx);
    setSelectedAnswers(savedAnswers);
    setSelected(null);
    setIsFinished(false);
  };

  // ---------- Save progress on index change ----------
  // Save shuffled order and current index; also persist answer map
  useEffect(() => {
    if (activeTopicId && currentQuestions.length) {
      const order = currentQuestions.map((_, i) => i);
      saveProgress(activeTopicId, { order, index: currentQ, answers: selectedAnswers });
    }
  }, [activeTopicId, currentQ, currentQuestions, selectedAnswers]);

  const handleSelect = (idx: number) => {
    if (selected !== null) return;
    setSelected(idx);
    const isCorrect = idx === question.answer;
    // Record stats against the current active topic
    if (activeTopicId) recordAnswer(activeTopicId, isCorrect);
    if (!isCorrect) {
      saveWrongQuestion('grammar', question);
      saveWrongQuestionAPI(getDeviceId(), 'grammar', question).catch(console.error);
    }
    // Record answer in local state
    setSelectedAnswers(prev => {
      const newAnswers = [...prev];
      newAnswers[currentQ] = idx;
      return newAnswers;
    });

    setTimeout(() => {
      if (explanationRef.current) {
        explanationRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 150);
  };

  const nextQuestion = () => {
    if (currentQ < currentQuestions.length - 1) {
      setCurrentQ(currentQ + 1);
      setSelected(null);
    } else {
      setIsFinished(true);
    }
  };

  const reset = async () => {
    if (!activeTopicId) return;
    setLoadingQuestions(true);
    const fetched = await fetchGrammarQuestions(activeTopicId);
    const ordered = shuffleArray(fetched);
    setCurrentQuestions(ordered);
    setLoadingQuestions(false);
    setCurrentQ(0);
    setSelected(null);
    setIsFinished(false);
    setSelectedAnswers(new Array(fetched.length).fill(null));
  };

  // ---------- Session score for finish screen ----------
  const sessionCorrect = selectedAnswers.filter((ans, i) => ans !== null && ans === currentQuestions[i]?.answer).length;
  const sessionTotal = currentQuestions.length;
  const sessionPct = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : 0;
  const sessionExcellent = sessionPct >= 80;

  // ---------- Diagnostic Logic ----------
  const startDiagnostic = async () => {
    setIsDiagnosticMode(true);
    setLoadingQuestions(true);
    setActiveView('practice');
    // Fetch random questions across all topics
    const fetched = await fetchGrammarQuestions('all');
    const diagnosticQs = shuffleArray(fetched).slice(0, 10);
    setCurrentQuestions(diagnosticQs);
    setCurrentQ(0);
    setSelectedAnswers(new Array(10).fill(null));
    setSelected(null);
    setIsFinished(false);
    setShowDiagnosisReport(false);
    setLoadingQuestions(false);
  };

  const openKnowledge = async (pointId: string) => {
    try {
      const point = await fetchKnowledgePoint(pointId);
      if (point) {
        setActiveKnowledgePoint(point);
        setIsKnowledgeDrawerOpen(true);
      } else {
        // Fallback for cat vs t prefix if needed
        const alternativeId = pointId.startsWith('cat') ? pointId.replace('cat', 't') : pointId.replace('t', 'cat');
        const altPoint = await fetchKnowledgePoint(alternativeId);
        if (altPoint) {
            setActiveKnowledgePoint(altPoint);
            setIsKnowledgeDrawerOpen(true);
        }
      }
    } catch (e) {
      console.error('Failed to open knowledge point:', e);
    }
  };

  const handlePracticeFromKnowledge = async (kId: string) => {
    setIsDiagnosticMode(false);
    setActiveTopicId('all'); // Mixed practice with target
    setLoadingQuestions(true);
    setActiveView('practice');
    
    const allFetched = await fetchGrammarQuestions('all');
    // Filter by knowledgeId or tag
    const filtered = allFetched.filter(q => (q as any).knowledgeId === kId || q.tag === kId);
    
    if (filtered.length > 0) {
      setCurrentQuestions(shuffleArray(filtered));
      setSelectedAnswers(new Array(filtered.length).fill(null));
      setCurrentQ(0);
      setSelected(null);
      setIsFinished(false);
    } else {
      setCurrentQuestions(shuffleArray(allFetched));
    }
    setLoadingQuestions(false);
  };

  // ---------- UI ----------
  if (activeView === 'system' || activeView === 'knowledge') {
    const studyStats = getStats();
    const isKnowledgeFocus = activeView === 'knowledge';
    // Group topics by category
    const categories = topics.reduce((acc, t) => {
      if (t.id === 'all') return acc;
      const cat = t.category || '其他';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(t);
      return acc;
    }, {} as Record<string, GrammarTopic[]>);

    const toggleCategory = (cat: string) => {
      setOpenCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
    };

    return (
      <div className="flex-1 flex flex-col bg-[#faf9f6] md:overflow-y-auto hide-scrollbar min-h-0 h-full">
        <div className="px-6 md:px-10 pt-4 pb-12">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-[1.7rem] md:text-3xl font-serif font-bold text-gray-800 tracking-widest flex items-center gap-3">
              <div className="w-1.5 h-6 bg-[#b58362] rounded-full"></div>
              {isKnowledgeFocus ? '语法知识点' : '语法真题'}
            </h2>
            <button 
              onClick={startDiagnostic}
              className="flex items-center gap-2 px-4 py-2 bg-[#b58362] text-white rounded-full text-sm font-bold shadow-md shadow-[#b58362]/20 hover:bg-[#a07254] transition-all"
            >
              <Target size={16} /> 考前诊断
            </button>
          </div>

          {loadingTopics ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin text-[#b58362]" size={32} /></div>
          ) : topics.length === 0 ? (
            <div className="text-center py-20 text-gray-500">未获取到语法知识点。</div>
          ) : (
            <div className="space-y-6">
              {/* Mixed Practice Card */}
              <div
                onClick={() => handleEnterTopic('all')}
                className="bg-white rounded-3xl p-6 flex items-center shadow-sm border border-[#b58362]/10 hover:shadow-lg hover:border-[#b58362]/30 transition-all cursor-pointer group overflow-hidden relative"
              >
                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Sparkles size={120} />
                </div>
                <div className="w-14 h-14 bg-[#fdfaf6] rounded-2xl flex items-center justify-center text-[#b58362] group-hover:bg-[#b58362] group-hover:text-white transition-all duration-500 shrink-0">
                  <Sparkles size={28} />
                </div>
                <div className="ml-5 flex-1">
                  <h3 className="text-xl font-bold text-gray-800 group-hover:text-[#b58362] transition-colors">混刷真题</h3>
                  <p className="text-sm text-gray-400 mt-1 uppercase tracking-widest font-mono">Mixed Real Questions</p>
                </div>
                <div className="bg-[#b58362]/5 px-4 py-2 rounded-xl text-[#b58362] font-bold text-sm">
                  {topics.find(t => t.id === 'all')?.questionCount} 题
                </div>
              </div>

              {/* Categorized Long List (Accordion) */}
              {Object.entries(categories).map(([catName, catTopics]) => (
                <div key={catName} className="bg-white/50 rounded-3xl overflow-hidden border border-gray-100">
                  <button 
                    onClick={() => toggleCategory(catName)}
                    className="w-full px-6 py-5 flex justify-between items-center hover:bg-white transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-[#b58362] rounded-full" />
                      <span className="text-lg font-bold text-gray-800">{catName}</span>
                      <span className="text-[10px] text-gray-400 font-mono px-2 py-0.5 bg-gray-50 rounded-full">{catTopics.length} 考点</span>
                    </div>
                    <motion.div
                      animate={{ rotate: openCategories[catName] ? 180 : 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <ChevronDown className="text-gray-300" size={20} />
                    </motion.div>
                  </button>
                  
                  <AnimatePresence>
                    {openCategories[catName] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden bg-white"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 border-t border-gray-50">
                          {catTopics.map((topic, index) => {
                            const answered = studyStats[topic.id]?.total || 0;
                            const total = topic.questionCount || 0;
                            const pct = total > 0 ? Math.min(1, answered / total) : 0;
                            return (
                              <div
                                key={topic.id}
                                onClick={() => {
                                  if (isKnowledgeFocus) {
                                    openKnowledge(topic.id);
                                  } else {
                                    handleEnterTopic(topic.id);
                                  }
                                }}
                                className="p-5 flex flex-col justify-between border-b border-r last:border-r-0 border-gray-50 hover:bg-[#fdfaf6] transition-all cursor-pointer group min-h-[120px]"
                              >
                                <div className="flex justify-between items-start mb-2">
                                  <div className="p-2.5 rounded-xl bg-gray-50 group-hover:bg-[#b58362] group-hover:text-white transition-all text-gray-400">
                                    <BookOpen size={18} />
                                  </div>
                                  <div className="text-[10px] font-bold text-gray-300 group-hover:text-[#b58362]/30 italic">{(index + 1).toString().padStart(2, '0')}</div>
                                </div>
                                <div>
                                  <h4 className="font-bold text-gray-800 group-hover:text-[#b58362] transition-colors">{topic.name}</h4>
                                  <p className="text-[9px] text-gray-400 uppercase tracking-widest font-mono mt-0.5 truncate">{topic.enName}</p>
                                </div>
                                <div className="mt-4 flex items-center justify-between">
                                  <div className="flex-1 h-1 bg-gray-100 rounded-full mr-4 overflow-hidden">
                                    <motion.div 
                                      initial={{ width: 0 }}
                                      animate={{ width: `${pct * 100}%` }}
                                      className="h-full bg-[#b58362]"
                                    />
                                  </div>
                                  <span className="text-[10px] font-bold text-gray-400">{answered}/{total}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- Practice view ----------
  return (
    <div className="flex-1 flex flex-col pt-2 relative md:px-10 min-h-0 h-full bg-[#faf9f6]">
      <div className="flex items-center gap-4 px-6 md:px-0 pb-4 mb-2 z-10 shrink-0 border-b border-gray-100/50">
        <button onClick={() => setActiveView('system')} className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors shrink-0 text-gray-600">
          <ChevronLeft size={20} />
        </button>
        <div className="flex flex-col">
          <span className="text-base font-bold text-gray-800 tracking-wider">{activeTopic?.name}</span>
          <span className="text-[10px] text-gray-400 tracking-widest font-mono uppercase mt-0.5">{activeTopic?.enName}</span>
        </div>
        {/* Overview toggle */}
        <button onClick={() => setShowOverview(true)} className="ml-auto w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors text-gray-600">
          <List size={20} />
        </button>
      </div>

      <div className="flex-1 flex flex-col px-6 md:px-0 pb-32 md:pb-36 overflow-y-auto hide-scrollbar relative min-h-0">
        <AnimatePresence mode="wait">
          {loadingQuestions ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Loader2 className="animate-spin text-[#b58362]" size={32} />
            </motion.div>
          ) : currentQuestions.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
            >
              <div className="w-20 h-20 bg-[#f4f3ed] rounded-full flex items-center justify-center mb-6 shadow-inner text-3xl">🚧</div>
              <h2 className="text-2xl font-serif text-gray-800 mb-2">后端题库空</h2>
              <p className="text-gray-500 mb-8 text-sm leading-relaxed">请通过Supabase SQL脚本向表中插入题库数据！<br /></p>
              <button onClick={() => setActiveView('system')} className="px-6 py-2.5 bg-gray-900 text-white rounded-full text-sm font-medium hover:bg-gray-800 transition-colors shadow-md">返回语法体系</button>
            </motion.div>
          ) : isFinished ? (
            <motion.div
              key="finished"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
            >
              {isDiagnosticMode ? (
                <div className="w-full max-w-xl bg-white rounded-[2.5rem] p-8 shadow-xl border border-[#b58362]/5 flex flex-col items-center relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#b58362] to-[#f0c2a2]" />
                  <div className="w-20 h-20 bg-[#fdfaf6] rounded-3xl flex items-center justify-center mb-6 shadow-inner text-[#b58362]">
                    <Trophy size={40} />
                  </div>
                  <h2 className="text-3xl font-serif font-bold text-gray-800 mb-2">诊断报告</h2>
                  <p className="text-gray-400 text-sm mb-8 uppercase tracking-[0.2em] font-mono">Diagnosis Report</p>
                  
                  <div className="grid grid-cols-2 gap-8 w-full mb-10">
                    <div className="flex flex-col items-center">
                      <span className="text-4xl font-serif font-bold text-gray-800">{sessionCorrect}</span>
                      <span className="text-[10px] text-gray-400 uppercase tracking-widest mt-1">正确题数</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-4xl font-serif font-bold text-[#b58362]">{sessionPct}%</span>
                      <span className="text-[10px] text-gray-400 uppercase tracking-widest mt-1">答对率</span>
                    </div>
                  </div>

                  <div className="w-full space-y-4 mb-8">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                       <Target size={14} /> 你的弱点考点
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {/* Filter questions with wrong answers and get their topic names/tags */}
                      {Array.from(new Set(
                        currentQuestions
                          .filter((_, i) => selectedAnswers[i] !== null && selectedAnswers[i] !== currentQuestions[i].answer)
                          .map(q => q.tag || (q as any).knowledgeId || topics.find(t => t.id === (q as any).catId || t.id === q.topicId)?.name)
                          .filter(Boolean)
                      )).map(weakPoint => (
                        <button
                          key={weakPoint}
                          onClick={() => openKnowledge(weakPoint as string)}
                          className="px-4 py-2 bg-orange-50 text-orange-600 rounded-xl text-sm font-bold border border-orange-100 hover:bg-orange-100 transition-colors flex items-center gap-2"
                        >
                          {weakPoint} <BookOpen size={14} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex w-full gap-3">
                    <button onClick={reset} className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl text-sm font-bold hover:bg-gray-200 transition-all">
                      重新诊断
                    </button>
                    <button onClick={() => setActiveView('system')} className="flex-1 py-4 bg-gray-900 text-white rounded-2xl text-sm font-bold hover:bg-gray-800 transition-all shadow-lg shadow-gray-200">
                      回体系学习
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="w-20 h-20 bg-[#f0ebd8] rounded-full flex items-center justify-center mb-5 shadow-inner">
                    <Sparkles className="text-[#d4c5b0]" size={32} />
                  </div>
                  <h2 className="text-2xl font-serif text-gray-800 mb-3">训练完成</h2>
                  <div className="flex items-end gap-1 mb-1">
                    <span className="text-5xl font-serif font-bold" style={{ color: sessionExcellent ? '#7a9e7e' : '#b58362' }}>{sessionPct}</span>
                    <span className="text-lg text-gray-400 mb-1.5">%</span>
                  </div>
                  <p className="text-gray-400 text-xs tracking-widest font-mono mb-1">
                    {sessionCorrect} / {sessionTotal} 题正确
                  </p>
                  <p className="text-gray-400 text-xs mb-10">
                    {sessionExcellent ? '🎉 掌握不错，继续保持！' : '📌 仍有盲区，建议重新测试巩固'}
                  </p>
                  <button onClick={reset} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-800 transition-colors bg-white px-6 py-3 rounded-full shadow-sm border border-gray-100">
                    <RefreshCw size={14} /><span>重新测试</span>
                  </button>
                </>
              )}
            </motion.div>
          ) : (

            <motion.div
              key="practice"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col max-w-3xl mx-auto w-full pt-2 md:pt-4"
            >
              <div className="flex flex-col justify-center min-h-[140px] md:min-h-[180px] mb-6 md:mb-8">
                <div className="flex items-center justify-between mb-3 md:mb-5">
                  <div className="flex items-center gap-2 md:gap-3">
                    <span className="text-xs text-[#b58362] font-serif font-bold tracking-widest">{isDiagnosticMode ? 'DIAGNOSTIC' : 'PRACTICE'}</span>
                    <span className="text-xs text-gray-300 font-serif tracking-widest">|</span>
                    <span className="text-xs text-gray-400 font-serif tracking-widest">{currentQ + 1} / {currentQuestions.length}</span>
                  </div>
                  {question.source && (
                    <span className="text-[10px] text-gray-400 font-sans px-2 py-0.5 rounded border border-gray-100 bg-white tracking-wider shadow-sm">{question.source}</span>
                  )}
                </div>
                {/* Progress bar for diagnostic */}
                {isDiagnosticMode && (
                  <div className="w-full h-1 bg-gray-100 rounded-full mb-6 overflow-hidden">
                    <motion.div 
                      className="h-full bg-[#b58362]"
                      initial={{ width: 0 }}
                      animate={{ width: `${((currentQ + 1) / currentQuestions.length) * 100}%` }}
                    />
                  </div>
                )}
                <div className="text-xl md:text-3xl font-serif leading-relaxed text-gray-800 md:leading-snug">
                  {question.text.split(/\\n|\n/).map((line, i) => {
                    const cleanLine = (i === 0 ? line.replace(/^\d+[\.．]\s*/, '') : line).replace(/^[-—]{1,3}\s*/, '');
                    return <p key={i} className={i > 0 ? 'mt-2' : ''}>{cleanLine}</p>;
                  })}
                </div>
              </div>

              <div className="flex flex-col md:grid md:grid-cols-2 gap-3 md:gap-5 mb-4">
                {question.options.map((opt, idx) => {
                  const isSelected = selected === idx;
                  const isCorrectAnswer = question.answer === idx;
                  const isWrongSelected = isSelected && !isCorrectAnswer;
                  let btnClass = "bg-white border-transparent text-gray-600 shadow-sm hover:shadow-md hover:border-gray-200";
                  if (selected !== null) {
                    if (isCorrectAnswer) btnClass = "bg-[#f4f8f4] border-[#e2efe2] text-[#4a7c59] shadow-sm";
                    else if (isWrongSelected) btnClass = "bg-[#fdf6f0] border-[#fae5d3] text-[#c98a6c] shadow-sm";
                    else btnClass = "bg-white/40 border-transparent text-gray-300";
                  }
                  return (
                    <button key={idx} onClick={() => handleSelect(idx)} className={cn("p-4 md:p-6 rounded-2xl md:rounded-3xl border text-left transition-all duration-300 flex justify-between items-center", btnClass)}>
                      <span className="text-base md:text-lg font-serif">{typeof opt === 'string' ? opt : JSON.stringify(opt)}</span>
                      {selected !== null && isCorrectAnswer && <Check size={20} className="text-[#4a7c59] opacity-70" />}
                      {isWrongSelected && <X size={20} className="text-[#c98a6c] opacity-70" />}
                    </button>
                  );
                })}
              </div>

              <div ref={explanationRef} className={cn("overflow-hidden transition-all duration-500 ease-in-out shrink-0", selected !== null ? 'max-h-[5000px] opacity-100 mt-2 md:mt-4' : 'max-h-0 opacity-0 mt-0')}>
                <div className="bg-white p-5 md:p-6 rounded-2xl md:rounded-3xl shadow-[0_4px_15px_rgba(0,0,0,0.03)] border border-gray-100 flex flex-col gap-3">
                  {selected !== question.answer && (
                    <div className="rounded-2xl bg-[#FBFAF8] border border-[#E9E4DC] px-4 py-3">
                      <span className="text-xs md:text-sm text-[#A67C65] font-medium">找到盲区啦，继续加油！</span>
                    </div>
                  )}
                  <div
                    className="analysis-point-text prose prose-sm max-w-none"
                  >
                    {renderKeyPoint(
                      ((question as any).keyPoint || (question as any).key_point || "") as string,
                      () => openKnowledge('虚拟语气'),
                    )}
                  </div>
                  <div className="mt-8 pt-8 border-t border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2 text-gray-400">
                        <Target size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-widest font-mono">Mindflow Recall</span>
                      </div>
                      <p className="text-gray-400 text-xs italic">
                        "Seeing the pattern is the first step to mastery."
                      </p>
                    </div>
                    {(question as any).knowledgeId && (
                      <button
                        onClick={() => openKnowledge((question as any).knowledgeId)}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-[#fdfaf6] text-[#b58362] rounded-2xl text-sm font-bold border border-[#b58362]/10 hover:bg-[#b58362]/5 transition-all shadow-sm group"
                      >
                        <BookOpen size={18} />
                        <span>复习知识点</span>
                        <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform opacity-50" />
                      </button>
                    )}
                  </div>
                  
                  <button onClick={nextQuestion} className="self-end px-5 md:px-7 py-2 md:py-3 bg-gray-900 text-white rounded-full text-xs md:text-sm font-medium flex items-center gap-1 hover:bg-gray-800 transition-colors shadow-md mt-4">
                    下一题 <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---------- Overview Panel ---------- */}
      {showOverview && activeTopic && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex justify-center items-center z-50" onClick={() => setShowOverview(false)}>
          <div className="bg-white rounded-xl w-11/12 max-w-3xl max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-4 flex justify-between items-center">
              {activeTopic.name} - 题目总览
              <button onClick={() => setShowOverview(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </h3>
            {/* Group by tag */}
            {Object.entries(
              currentQuestions.reduce((acc, q, idx) => {
                const tag = q.tag || '未分类';
                if (!acc[tag]) acc[tag] = [];
                acc[tag].push(idx);
                return acc;
              }, {} as Record<string, number[]>)
            ).map(([tag, indices]) => (
              <div key={tag} className="mb-4">
                <h4 className="text-sm font-medium text-gray-600 mb-2">{tag}</h4>
                <div className="grid grid-cols-6 gap-2">
                  {indices.map(idx => {
                    const status = selectedAnswers[idx] === null ? 'unanswered' : (selectedAnswers[idx] === currentQuestions[idx].answer ? 'correct' : 'wrong');
                    const bg = status === 'unanswered' ? 'bg-gray-200' : status === 'correct' ? 'bg-green-200' : 'bg-red-200';
                    const isCurrent = idx === currentQ;
                    return (
                      <button
                        key={idx}
                        onClick={() => { setCurrentQ(idx); setShowOverview(false); setSelected(null); }}
                        className={cn(
                          'w-10 h-10 flex items-center justify-center rounded-lg text-sm border',
                          bg,
                          isCurrent && 'border-2 border-blue-500'
                        )}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* Knowledge Drawer (Bottom Sheet) */}
      <KnowledgeDrawer
        isOpen={isKnowledgeDrawerOpen}
        onClose={() => setIsKnowledgeDrawerOpen(false)}
        knowledge={activeKnowledgePoint || undefined}
        onPractice={handlePracticeFromKnowledge}
      />
    </div>
  );
}
