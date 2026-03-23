import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './UI';
import { getWrongQuestions, removeWrongQuestion, WrongQuestion } from '../utils/wrongQuestions';
import { Trash2, ChevronRight, ChevronLeft, Check, X, BookOpen, Sparkles, BarChart2, PenLine, Highlighter, Eraser, Palette, Settings, Trophy } from 'lucide-react';
import { fetchUserWrongQuestions, fetchGrammarTopics, deleteWrongQuestionAPI } from '../services/api';
import { GrammarTopic } from '../constants';

import { getStats } from '../utils/studyStats';
import { getDeviceId } from '../utils/deviceId';
import { 
  COLORS, 
  renderMarkdownWithExampleCards, 
  unwrapExampleBlockquotes, 
  unescapeStrongEntities 
} from '../utils/grammarParser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// --- Grammar Stats Chart (Errors Only) ---
function GrammarErrorChart({ questions, topics }: { questions: any[], topics: GrammarTopic[] }) {
  // Count errors per topic_id/tag from wrong questions
  const errorCounts: Record<string, number> = {};
  
  questions.forEach(q => {
    const tid = q.data?.topic_id || q.data?.topicId;
    const tag = q.data?.tag || topics.find(t => t.id === tid)?.name || '综合复习';
    errorCounts[tag] = (errorCounts[tag] || 0) + 1;
  });

  // Build list of items to chart
  const chartItems = Object.keys(errorCounts).map(tagName => ({
    name: tagName,
    errors: errorCounts[tagName]
  })).sort((a, b) => b.errors - a.errors).slice(0, 10);

  if (chartItems.length === 0) return null;

  const maxErrors = Math.max(...chartItems.map(t => t.errors), 1);
  const totalErrors = chartItems.reduce((a, t) => a + t.errors, 0);

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-8">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 size={16} className="text-[#b58362]" />
        <span className="text-xs font-bold text-gray-800 tracking-widest uppercase">重点突破 (Top 10 易错)</span>
        <span className="ml-auto text-[10px] text-gray-400 font-mono">
          共计 {totalErrors} 道错题
        </span>
      </div>

      {/* Error count bars (warm brown) */}
      <div className="space-y-2.5">
        {chartItems.map(t => (
          <div key={t.name} className="flex items-center gap-3">
            <div className="w-24 text-right text-[11px] text-gray-500 font-medium shrink-0 truncate">{t.name}</div>
            <div className="flex-1 bg-gray-50 rounded-full h-5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(t.errors / maxErrors) * 100}%` }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                className="h-full rounded-full flex items-center justify-end pr-2"
                style={{ background: 'linear-gradient(90deg, #d4b09a, #b58362)' }}
              >
                <span className="text-[10px] font-bold text-white">{t.errors}</span>
              </motion.div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WrongQuestionsModule() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [topics, setTopics] = useState<GrammarTopic[]>([]);
  const isGrammarOnly = import.meta.env.VITE_APP_MODE === 'grammar' || (new URLSearchParams(window.location.search)).get('appMode') === 'grammar';
  const [activeTab, setActiveTab] = useState<'grammar' | 'reading'>(isGrammarOnly ? 'grammar' : 'grammar');
  const [filterTopicId, setFilterTopicId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isPrintMode, setIsPrintMode] = useState(false);

  // Print Config State
  const [showPrintConfig, setShowPrintConfig] = useState(false);
  const [printTimeFilter, setPrintTimeFilter] = useState<'all' | '7days' | '30days'>('all');
  const [printTopics, setPrintTopics] = useState<string[]>([]);

  // Challenge Mode State
  const [isChallengeMode, setIsChallengeMode] = useState(false);
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [challengeQuestions, setChallengeQuestions] = useState<any[]>([]);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);

  // Drawing tools state
  const [isPenActive, setIsPenActive] = useState(false);
  const [activeTool, setActiveTool] = useState<'pen' | 'marker' | 'eraser'>('pen');
  const [penColor, setPenColor] = useState('#4A3E31');

  // Canvas refs
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const isDrawing = React.useRef(false);
  const activeCanvas = React.useRef<HTMLCanvasElement | null>(null);
  const points = React.useRef<{ x: number, y: number, pressure: number, time: number }[]>([]);
  const lastWidth = React.useRef(0);

  // Handle Canvas Resize and Redraw
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const rect = (canvas.parentElement as HTMLDivElement).getBoundingClientRect();
        
        // Save current drawing
        const ctx = canvas.getContext('2d');
        let tempCanvas: HTMLCanvasElement | null = null;
        if (ctx) {
          tempCanvas = document.createElement('canvas');
          tempCanvas.width = canvas.width;
          tempCanvas.height = canvas.height;
          tempCanvas.getContext('2d')?.drawImage(canvas, 0, 0);
        }

        // Resize
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        
        // Scale context so coordinates stay in CSS pixel space
        const newCtx = canvas.getContext('2d');
        if (newCtx) {
          newCtx.scale(dpr, dpr);
        }
        
        // Restore
        if (ctx && tempCanvas) {
           const restoreCtx = canvas.getContext('2d');
           restoreCtx?.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, rect.width, rect.height);
        }
      }
    };
    
    // Initial size
    setTimeout(handleResize, 100);
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [currentIndex, activeTab]);

  // Drawing Handlers
  const getCoords = (e: React.PointerEvent) => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    // ctx is scaled by dpr, so coordinates should be in CSS pixel space
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5,
      time: Date.now()
    };
  };

  const getPenWidth = (pressure: number, velocity: number) => {
    const isMobile = window.innerWidth < 768;
    if (activeTool === 'eraser') {
      const baseEraserWidth = isMobile ? 12 : 20;
      const pressureFactor = (pressure === 0.5 || pressure === 0) ? 1 : (0.5 + pressure);
      return baseEraserWidth * pressureFactor;
    }
    if (activeTool === 'marker') {
      return isMobile ? 10 : 16;
    }
    // Pen: ultrathin water-based feel
    const baseWidth = isMobile ? 0.8 : 1.2;
    const vFactor = Math.max(0, Math.min(1, velocity / 4));
    const simulatedPressure = 1 - Math.pow(vFactor, 1.5);
    const finalPressure = (pressure === 0.5 || pressure === 0) ? simulatedPressure : pressure;
    return baseWidth * (0.5 + 1.3 * finalPressure);
  };

  const startDrawing = (e: React.PointerEvent) => {
    if (!isPenActive) return;
    const canvas = e.currentTarget as HTMLCanvasElement;
    isDrawing.current = true;
    activeCanvas.current = canvas;

    const pt = getCoords(e);
    points.current = [pt];
    lastWidth.current = getPenWidth(pt.pressure, 0);

    const ctx = canvas.getContext('2d')!;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over';

    const strokeColor = activeTool === 'eraser' ? 'rgba(0,0,0,1)' : penColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lastWidth.current;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  };

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing.current || !activeCanvas.current || !isPenActive) return;
    const canvas = activeCanvas.current;
    const pt = getCoords(e);

    if (activeTool === 'marker' && points.current.length > 0) {
      pt.y = points.current[0].y; // Lock Y axis for marker
    }

    const prevPt = points.current[points.current.length - 1];
    const dx = pt.x - prevPt.x;
    const dy = pt.y - prevPt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dt = pt.time - prevPt.time;
    const velocity = dt > 0 ? dist / dt : 0;

    const targetWidth = getPenWidth(pt.pressure, velocity);
    const lerpFactor = activeTool === 'marker' ? 1 : 0.3;
    const width = lastWidth.current + (targetWidth - lastWidth.current) * lerpFactor;

    const ctx = canvas.getContext('2d')!;
    ctx.lineTo(pt.x, pt.y);
    const strokeColor = activeTool === 'eraser' ? 'rgba(0,0,0,1)' : penColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = width;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);

    points.current.push(pt);
    lastWidth.current = width;
  };

  const stopDrawing = (e: React.PointerEvent) => {
    if (!isDrawing.current) return;
    
    if (points.current.length <= 2) {
      if (activeCanvas.current) {
        const originalPointerEvents = activeCanvas.current.style.pointerEvents;
        activeCanvas.current.style.pointerEvents = 'none';
        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (element instanceof HTMLElement) {
          const button = element.closest('button');
          if (button) (button as HTMLElement).click();
        }
        activeCanvas.current.style.pointerEvents = originalPointerEvents;
      }
    }

    isDrawing.current = false;
    activeCanvas.current = null;
    points.current = [];
  };

  const clearCanvas = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  // 当切换 tab 时，重置过滤条件
  useEffect(() => {
    setFilterTopicId(null);
  }, [activeTab]);

  // Derived state
  const tabQuestions = questions.filter(q => q.type === activeTab).sort((a, b) => b.timestamp - a.timestamp);

  // 提取当前 tab 下所有存在的 topic_id
  const availableTopicIds = Array.from(new Set(tabQuestions.map(q => q.data?.topic_id || q.data?.topicId).filter(Boolean)));

  const filteredQuestions = filterTopicId
    ? tabQuestions.filter(q => (q.data?.topic_id || q.data?.topicId) === filterTopicId)
    : tabQuestions;

  const activeQuestion = currentIndex !== null && currentIndex < filteredQuestions.length
    ? filteredQuestions[currentIndex]
    : null;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchUserWrongQuestions(getDeviceId()),
      fetchGrammarTopics(),
      // Also get local questions as fallback/merge
      Promise.resolve(getWrongQuestions())
    ]).then(([apiQuestions, topicsData, localQuestions]) => {
      // Merge: Prefer API data but supplement with local if missing
      const merged = [...apiQuestions];
      localQuestions.forEach((lq: any) => {
        if (!merged.find(aq => aq.id === lq.id || aq.data?.id === lq.data?.id)) {
          merged.push(lq);
        }
      });
      
      setQuestions(merged);
      setTopics(topicsData);
      setLoading(false);
    });
  }, []);

  const handleSelectQuestion = (idx: number) => {
    setCurrentIndex(idx);
    setSelected(null);
    setIsCorrect(null);
  };

  const handleAnswer = (idx: number) => {
    if (!activeQuestion || selected !== null) return;
    setSelected(idx);
    const correct = idx === activeQuestion.data.answer;
    setIsCorrect(correct);

    if (correct) {
      // Auto-remove if answered correctly, with a slight delay for user to see the success state
      setTimeout(() => {
        // Create a synthetic event to satisfy typescript
        const syntheticEvent = { stopPropagation: () => { } } as React.MouseEvent;
        handleDelete(activeQuestion.id, syntheticEvent);
      }, 1000); // 1 second delay
    }
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setQuestions(prev => prev.filter(q => q.id !== id));

    // If we're deleting the currently active question, handle the index shift
    if (activeQuestion?.id === id) {
      if (filteredQuestions.length <= 1) {
        // It was the last one in the category
        setCurrentIndex(null);
      } else {
        // Keep currentIndex the same, which will automatically show the NEXT question that slides into this spot
        // Unless it was the very last item in the list, then we step back one
        if (currentIndex !== null && currentIndex >= filteredQuestions.length - 1) {
          setCurrentIndex(currentIndex - 1);
        }
        setSelected(null);
        setIsCorrect(null);
      }
    }

    // Auto-sync with DB and LocalStorage
    try {
      await deleteWrongQuestionAPI(id);
      removeWrongQuestion(id);
    } catch(err) {
      console.error('Delete sync failed', err);
    }
  };

  const handleNextQuestion = () => {
    if (currentIndex !== null && currentIndex < filteredQuestions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelected(null);
      setIsCorrect(null);
    } else {
      // Finished all in the list
      setCurrentIndex(null);
    }
  };

  const handleClearAll = () => {
    // Remove all questions of the current tab type
    setQuestions(prev => prev.filter(q => q.type !== activeTab));
    setShowClearConfirm(false);
    setCurrentIndex(null);
    setFilterTopicId(null);
  };

  if (isChallengeMode && challengeQuestions.length > 0) {
    const activeQ = challengeQuestions[challengeIndex];
    if (!activeQ) return null;
    const qData = activeQ.data;
    
    return (
      <div className="flex-1 flex flex-col bg-[#faf9f6] min-h-0 h-full relative">
        <AnimatePresence>
          {showSuccessAnim && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.2 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm"
            >
              <div className="bg-white px-8 py-6 rounded-3xl shadow-2xl border border-green-100 flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-500">
                  <Check size={32} strokeWidth={3} />
                </div>
                <h2 className="text-xl font-bold font-serif text-gray-800 text-center">
                  太棒了！<br/> <span className="text-green-500">错题 -1</span>
                </h2>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="h-14 flex items-center px-6 border-b border-gray-100 bg-white shrink-0">
          <button
            onClick={() => setIsChallengeMode(false)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft size={18} /> 退出闯关
          </button>
          <div className="ml-auto text-xs text-gray-400 font-serif tracking-widest uppercase flex items-center gap-2">
            <Trophy size={14} className="text-[#b58362]" /> CHALLENGE {challengeIndex + 1} / {challengeQuestions.length}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-10 hide-scrollbar">
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 bg-[#b58362]/10 text-[#b58362] text-[10px] font-bold tracking-widest uppercase rounded">
                CHALLENGE MODE
              </span>
            </div>
            
            <h3 className="text-xl md:text-2xl font-serif text-gray-800 leading-relaxed">
              {qData.text}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {qData.options.map((opt: string, idx: number) => {
                const isSelected = selected === idx;
                const isCorrectAnswer = qData.answer === idx;
                const isWrongSelected = isSelected && !isCorrectAnswer;

                let btnClass = "bg-white border-transparent text-gray-600 shadow-sm hover:shadow-md";
                if (selected !== null) {
                  if (isCorrectAnswer) btnClass = "bg-[#f4f8f4] border-[#e2efe2] text-[#4a7c59]";
                  else if (isWrongSelected) btnClass = "bg-[#fdf6f0] border-[#fae5d3] text-[#c98a6c]";
                  else btnClass = "bg-white/40 border-transparent text-gray-300 pointer-events-none";
                }

                return (
                  <button
                    key={idx}
                    disabled={selected !== null}
                    onClick={() => {
                        setSelected(idx);
                        const correct = idx === qData.answer;
                        setIsCorrect(correct);
                        if (correct) {
                            setShowSuccessAnim(true);
                            setTimeout(() => {
                                handleDelete(activeQ.id); // Also removes from DB securely
                                setShowSuccessAnim(false);
                                setSelected(null);
                                setIsCorrect(null);
                                if (challengeIndex < challengeQuestions.length - 1) {
                                    setChallengeIndex(c => c + 1);
                                } else {
                                    setChallengeQuestions([]); // empty to show success screen
                                }
                            }, 1200);
                        }
                    }}
                    className={cn("p-5 rounded-2xl border text-left transition-all duration-300 flex justify-between items-center font-serif", btnClass)}
                  >
                    <span>{opt}</span>
                    {selected !== null && isCorrectAnswer && <Check size={18} />}
                    {isWrongSelected && <X size={18} />}
                  </button>
                );
              })}
            </div>

            <AnimatePresence>
              {selected !== null && !isCorrect && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 mt-8 space-y-4"
                >
                    <div className="flex items-center gap-2">
                      <Sparkles size={16} className="text-[#b58362]" />
                      <span className="text-xs font-bold text-gray-800 tracking-widest uppercase">Analysis</span>
                    </div>
                    {(qData.keyPoint || qData.key_point || qData.analysis) ? (
                        <div className="knowledge-md">
                        {renderMarkdownWithExampleCards(
                          unwrapExampleBlockquotes(
                            unescapeStrongEntities(
                              ((qData.keyPoint || qData.key_point || qData.analysis || "") as string)
                                .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '')
                            )
                          ),
                          {
                            p: ({ children }: any) => <p className="text-[15px] leading-[1.8] mb-6" style={{ color: COLORS.text }}>{children}</p>,
                            strong: ({ children }: any) => <strong className="font-bold" style={{ color: COLORS.accent }}>{children}</strong>,
                            blockquote: ({ children }: any) => <div className="my-6 pl-4 border-l-2" style={{ borderColor: COLORS.accent }}><div className="text-sm italic" style={{ color: COLORS.text }}>{children}</div></div>
                          } as any
                        )}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500 italic font-serif">该题目暂无详细解析。</p>
                    )}
                    
                    <div className="pt-4 flex justify-end items-center border-t border-gray-100 mt-6">
                        <button
                          onClick={() => {
                              setSelected(null);
                              setIsCorrect(null);
                              if (challengeIndex < challengeQuestions.length - 1) {
                                  setChallengeIndex(c => c + 1);
                              } else {
                                  setChallengeQuestions([]); // empty to show success screen
                              }
                          }}
                          className="px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl shadow-md hover:bg-gray-800 transition-all flex items-center gap-2"
                        >
                          下一题 <ChevronRight size={16} />
                        </button>
                    </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
  } else if (isChallengeMode && challengeQuestions.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-center bg-[#faf9f6]">
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm border border-gray-50">
              <Trophy size={40} className="text-[#b58362]" />
            </div>
            <h2 className="text-2xl font-serif font-bold text-gray-800 mb-2">哇哦！没有错题可供闯关</h2>
            <p className="text-gray-500 text-sm mb-8">你真是太棒了！或者请先去刷题积累一些错题吧。</p>
            <button onClick={() => setIsChallengeMode(false)} className="px-8 py-3 bg-[#1a1a1a] text-white rounded-full text-sm font-bold shadow-xl hover:scale-105 transition-all">返回错题本</button>
        </div>
      );
  }

  if (activeQuestion) {
    const qData = activeQuestion.data;
    return (
      <div className="flex-1 flex flex-col bg-[#faf9f6] min-h-0 h-full">
        <div className="h-14 flex items-center px-6 border-b border-gray-100 bg-white shrink-0">
          <button
            onClick={() => setCurrentIndex(null)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft size={18} /> 返回主页
          </button>
          <div className="ml-auto text-xs text-gray-400 font-serif tracking-widest uppercase">
            QUESTION {currentIndex! + 1} / {filteredQuestions.length}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-10 hide-scrollbar">
          <div className="max-w-3xl mx-auto space-y-8">
            {/* Context for Reading Questions */}
            {activeQuestion.type === 'reading' && qData.article && (
              <>
                {/* Drawing Toolbar - matches ReadingModule style */}
                <div className="flex items-center gap-2 bg-white/60 backdrop-blur-md p-1.5 rounded-2xl shadow-sm border border-gray-100 mb-2 w-fit">
                  <button
                    onClick={() => setIsPenActive(!isPenActive)}
                    className={cn(
                      "p-2 rounded-xl transition-all",
                      isPenActive ? "bg-[#1a1a1a] text-white" : "bg-gray-50 text-gray-400 hover:bg-gray-100"
                    )}
                    title={isPenActive ? "关闭划记" : "开启划记"}
                  >
                    <PenLine size={18} />
                  </button>

                  <AnimatePresence>
                    {isPenActive && (
                      <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="flex items-center gap-1.5"
                      >
                        <div className="w-px h-5 bg-gray-200 mx-0.5"></div>
                        <button
                          onClick={() => setActiveTool('pen')}
                          className={cn("p-1.5 rounded-lg transition-all", activeTool === 'pen' ? "bg-gray-100 text-[#b58362]" : "text-gray-400 hover:text-gray-600")}
                          title="细笔"
                        >
                          <PenLine size={16} />
                        </button>
                        <button
                          onClick={() => setActiveTool('marker')}
                          className={cn("p-1.5 rounded-lg transition-all", activeTool === 'marker' ? "bg-gray-100 text-[#b58362]" : "text-gray-400 hover:text-gray-600")}
                          title="记号笔"
                        >
                          <Highlighter size={16} />
                        </button>
                        <button
                          onClick={() => setActiveTool('eraser')}
                          className={cn("p-1.5 rounded-lg transition-all", activeTool === 'eraser' ? "bg-gray-100 text-[#b58362]" : "text-gray-400 hover:text-gray-600")}
                          title="橡皮擦"
                        >
                          <Eraser size={16} />
                        </button>
                        <div className="w-px h-5 bg-gray-200 mx-0.5"></div>
                        {/* Muted color palette matching ReadingModule */}
                        <div className="flex items-center gap-1.5 px-0.5">
                          {[
                            { color: '#4A3E31', label: '默认' },
                            { color: '#E8DCC4', label: '沙色' },
                            { color: '#FADADD', label: '粉' },
                            { color: '#D1EAF0', label: '蓝' },
                          ].map((c) => (
                            <button
                              key={c.color}
                              onClick={() => setPenColor(c.color)}
                              className={cn(
                                "w-4 h-4 rounded-full border transition-transform hover:scale-110",
                                penColor === c.color ? "border-gray-400 scale-110" : "border-transparent"
                              )}
                              style={{ backgroundColor: c.color }}
                              title={c.label}
                            />
                          ))}
                        </div>
                        <div className="w-px h-5 bg-gray-200 mx-0.5"></div>
                        <button
                          onClick={clearCanvas}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 transition-all"
                          title="清空"
                        >
                          <Trash2 size={16} />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Article Card */}
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 mb-8">
                  <div className="flex items-center gap-2 mb-4 text-[#b58362]">
                    <BookOpen size={16} />
                    <span className="text-xs font-bold tracking-widest uppercase font-serif">Article Context</span>
                  </div>

                  <div className="relative">
                    {/* Canvas Overlay */}
                    <canvas
                      ref={canvasRef}
                      onPointerDown={startDrawing}
                      onPointerMove={draw}
                      onPointerUp={stopDrawing}
                      onPointerOut={stopDrawing}
                      className="absolute top-0 left-0 w-full h-full z-20 rounded-xl"
                      style={{
                        pointerEvents: isPenActive ? 'auto' : 'none',
                        mixBlendMode: 'multiply',
                        cursor: isPenActive ? (activeTool === 'eraser' ? 'cell' : 'crosshair') : 'default',
                      }}
                    />
                    {/* Text content */}
                    <div className="space-y-4 relative z-10" style={{ touchAction: isPenActive ? 'none' : 'auto' }}>
                      {qData.article.map((p: any) => (
                        <p key={p.id} className={cn(
                          "text-sm md:text-base leading-relaxed text-gray-600 font-serif",
                          p.id === qData.evidenceId ? "bg-[#E3F2FD]/40 border-l-4 border-[#81D4FA] pl-3 py-1" : ""
                        )}>
                          {p.text}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 bg-gray-100 text-gray-400 text-[10px] rounded font-mono">Q</span>
              </div>
              <h3 className="text-xl md:text-2xl font-serif text-gray-800 leading-relaxed">
                {qData.text}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {qData.options.map((opt: string, idx: number) => {
                  const isSelected = selected === idx;
                  const isCorrectAnswer = qData.answer === idx;
                  const isWrongSelected = isSelected && !isCorrectAnswer;

                  let btnClass = "bg-white border-transparent text-gray-600 shadow-sm hover:shadow-md";
                  if (selected !== null) {
                    if (isCorrectAnswer) btnClass = "bg-[#f4f8f4] border-[#e2efe2] text-[#4a7c59]";
                    else if (isWrongSelected) btnClass = "bg-[#fdf6f0] border-[#fae5d3] text-[#c98a6c]";
                    else btnClass = "bg-white/40 border-transparent text-gray-300";
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => handleAnswer(idx)}
                      className={cn("p-5 rounded-2xl border text-left transition-all duration-300 flex justify-between items-center font-serif", btnClass)}
                    >
                      <span>{opt}</span>
                      {selected !== null && isCorrectAnswer && <Check size={18} />}
                      {isWrongSelected && <X size={18} />}
                    </button>
                  );
                })}
              </div>

              <AnimatePresence>
                {selected !== null && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles size={16} className="text-[#b58362]" />
                      <span className="text-xs font-bold text-gray-800 tracking-widest uppercase">Analysis</span>
                    </div>
                    {(qData.keyPoint || qData.key_point || qData.analysis) ? (
                      <div className="knowledge-md">
                        {renderMarkdownWithExampleCards(
                          unwrapExampleBlockquotes(
                            unescapeStrongEntities(
                              ((qData.keyPoint || qData.key_point || qData.analysis || "") as string)
                                .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '') // Strip emojis
                            )
                          ),
                          {
                            p: ({ children }: any) => {
                              const text = typeof children === 'string' ? children : String(children?.[0] || '');
                              const t = text.trim();
                              // Support the custom step/option titles if needed, 
                              // but renderMarkdownWithExampleCards already handles most card logic.
                              return <p className="text-[15px] leading-[1.8] mb-6" style={{ color: COLORS.text }}>{children}</p>;
                            },
                            strong: ({ children }: any) => (
                              <strong className="font-bold" style={{ color: COLORS.accent }}>{children}</strong>
                            ),
                            blockquote: ({ children }: any) => (
                              <div className="my-6 pl-4 border-l-2" style={{ borderColor: COLORS.accent }}>
                                <div className="text-sm italic" style={{ color: COLORS.text }}>{children}</div>
                              </div>
                            )
                          } as any
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 italic font-serif">该题目暂无详细解析，请结合原文理解。</p>
                    )}

                    <div className="pt-4 flex justify-between items-center border-t border-gray-100 mt-6">
                      <div className="flex gap-3">
                        {isCorrect && (
                          <button
                            onClick={(e) => handleDelete(activeQuestion.id, e as any)}
                            className="px-4 py-2.5 bg-[#fef2f2] text-red-600 text-sm font-medium rounded-xl hover:bg-red-50 transition-colors"
                          >
                            移出本题
                          </button>
                        )}
                      </div>
                      <button
                        onClick={handleNextQuestion}
                        className="px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl shadow-md hover:bg-gray-800 transition-all flex items-center gap-2"
                      >
                        {currentIndex !== null && currentIndex < filteredQuestions.length - 1 ? (
                          <>下一题 <ChevronRight size={16} /></>
                        ) : (
                          <>完成复盘 <Check size={16} /></>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const availableTopicsForPrint = Array.from(new Set(tabQuestions.map(q => q.data?.tag || topics.find(t => t.id === (q.data?.topic_id || q.data?.topicId))?.name || '综合复习')));

  const questionsToPrint = tabQuestions.filter(q => {
     // Check time
     const dt = Date.now() - q.timestamp;
     if (printTimeFilter === '7days' && dt > 7 * 24 * 3600 * 1000) return false;
     if (printTimeFilter === '30days' && dt > 30 * 24 * 3600 * 1000) return false;
     // Check topics
     const tagName = q.data?.tag || topics.find(t => t.id === (q.data?.topic_id || q.data?.topicId))?.name || '综合复习';
     if (printTopics.length > 0 && !printTopics.includes(tagName)) return false;
     return true;
  });

  return (
    <div className="flex-1 flex flex-col bg-[#faf9f6] md:overflow-y-auto hide-scrollbar min-h-0 h-full">
      <AnimatePresence>
        {showPrintConfig && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 print:hidden"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl p-8 max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-serif font-bold text-gray-800 flex items-center gap-2">
                  <Settings size={24} className="text-[#b58362]" /> 打印组卷配置
                </h2>
                <button onClick={() => setShowPrintConfig(false)} className="text-gray-400 hover:text-gray-600">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-8">
                <div>
                  <h3 className="text-xs font-bold text-gray-800 tracking-widest uppercase mb-3">时间筛选</h3>
                  <div className="flex gap-3">
                    {[
                      { id: 'all', label: '全部累积' },
                      { id: '30days', label: '近 30 天' },
                      { id: '7days', label: '近 7 天' }
                    ].map(t => (
                      <button
                        key={t.id}
                        onClick={() => setPrintTimeFilter(t.id as any)}
                        className={cn("px-4 py-2 rounded-xl text-sm font-medium transition-all border", printTimeFilter === t.id ? "bg-[#b58362] text-white border-[#b58362]" : "bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100")}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-xs font-bold text-gray-800 tracking-widest uppercase">考点精准过滤</h3>
                    <div className="flex gap-2 text-[10px]">
                      <button onClick={() => setPrintTopics(availableTopicsForPrint)} className="text-[#b58362] hover:underline">全选</button>
                      <button onClick={() => setPrintTopics([])} className="text-gray-400 hover:underline">反选</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableTopicsForPrint.map(topicName => {
                      const isActive = printTopics.includes(topicName);
                      return (
                        <button
                          key={topicName}
                          onClick={() => {
                            if (isActive) setPrintTopics(prev => prev.filter(t => t !== topicName));
                            else setPrintTopics(prev => [...prev, topicName]);
                          }}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                            isActive ? "bg-[#b58362]/10 text-[#b58362] border-[#b58362]/30" : "bg-white text-gray-400 border-gray-100/50 hover:bg-gray-50"
                          )}
                        >
                          {topicName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-10 pt-6 border-t border-gray-100">
                <button onClick={() => setShowPrintConfig(false)} className="px-6 py-2.5 bg-gray-50 text-gray-600 rounded-xl font-bold">取消</button>
                <button
                  disabled={printTopics.length === 0}
                  onClick={() => {
                    setShowPrintConfig(false);
                    setIsPrintMode(true);
                  }}
                  className="px-8 py-2.5 bg-[#1a1a1a] text-white rounded-xl font-bold hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
                >
                  生成 A4 卷 ({questionsToPrint.length} 题)
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="px-6 md:px-10 pt-4 pb-12 print:hidden">
        <div className="flex justify-between items-end mb-6">
          <div>
            <h2 className="text-[1.7rem] md:text-3xl font-serif font-bold text-gray-800 mb-2 tracking-widest flex items-center gap-3">
              <div className="w-1.5 h-6 bg-[#b58362] rounded-full"></div>
              错题集锦
            </h2>
            <p className="text-gray-400 text-xs tracking-widest uppercase font-mono">Focused Practice Collection</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-2xl font-serif text-[#b58362] font-bold">{filteredQuestions.length}</div>
            <div className="text-[10px] text-gray-400 tracking-widest uppercase">Items in {activeTab}</div>
            {tabQuestions.length > 0 && (
              showClearConfirm ? (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-gray-500">确定清空？</span>
                  <button onClick={handleClearAll} className="text-[10px] px-2.5 py-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors">确定</button>
                  <button onClick={() => setShowClearConfirm(false)} className="text-[10px] px-2.5 py-1 bg-gray-100 text-gray-500 rounded-full hover:bg-gray-200 transition-colors">取消</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="text-[10px] text-gray-300 hover:text-red-400 transition-colors flex items-center gap-1 mt-1"
                >
                  <Trash2 size={10} /> 一键清空
                </button>
              )
            )}
          </div>
        </div>

        {/* Categories Tabs - Hidden in strict grammar mode */}
        {false && (
          <div className="flex items-center gap-2 mb-8 bg-white/50 p-1.5 rounded-2xl w-fit border border-gray-100/50 shadow-sm backdrop-blur-sm">
            {/* Reading hidden for now */}
          </div>
        )}

        {activeTab === 'grammar' && (
          <div className="mb-8 flex justify-end gap-3 print:hidden">
             <button
               onClick={() => {
                 setChallengeQuestions([...filteredQuestions].sort(() => Math.random() - 0.5));
                 setChallengeIndex(0);
                 setIsChallengeMode(true);
               }}
               className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-100 text-gray-800 rounded-2xl text-sm font-bold shadow-sm hover:shadow-md hover:border-[#b58362]/30 hover:text-[#b58362] transition-all"
             >
               <Trophy size={18} /> 错题闯关
             </button>
             <button
               onClick={() => {
                 setPrintTopics(availableTopicsForPrint);
                 setShowPrintConfig(true);
               }}
               className="flex items-center gap-2 px-6 py-3 bg-[#1a1a1a] text-white rounded-2xl text-sm font-bold shadow-xl hover:scale-105 active:scale-95 transition-all"
             >
               <Settings size={18} /> 定制打卷
             </button>
          </div>
        )}

        {/* Grammar Error Analysis Chart — only shown on grammar tab */}
        {activeTab === 'grammar' && (
          <GrammarErrorChart questions={tabQuestions} topics={topics} />
        )}

        {/* Filter Pills */}
        {activeTab === 'grammar' && availableTopicIds.length > 0 && (
          <div className="w-full bg-white border-b border-gray-100 overflow-x-auto hide-scrollbar mb-6 sticky top-0 z-10 scroll-smooth">
            <div className="inline-flex items-center gap-2 px-6 py-4 min-w-max">
              <button
                onClick={() => setFilterTopicId(null)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0",
                  filterTopicId === null
                    ? "bg-[#b58362] text-white shadow-sm"
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                )}
              >
                全部错题
              </button>
              {availableTopicIds.map(tid => {
                const topic = topics.find(t => t.id === tid);
                if (!topic) return null;
                const active = filterTopicId === tid;
                return (
                  <button
                    key={tid}
                    onClick={() => setFilterTopicId(tid)}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0",
                      active
                        ? "bg-[#b58362] text-white shadow-sm"
                        : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                    )}
                  >
                    {topic.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {filteredQuestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm border border-gray-50 text-3xl">✨</div>
            <h3 className="text-xl font-serif text-gray-800 mb-2">暂无错题</h3>
            <p className="text-gray-400 text-sm max-w-xs leading-relaxed">
              太棒了！你目前的练习记录非常完美。<br />继续保持，攻克更多真题吧。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredQuestions.map((q, idx) => (
              <div
                key={q.id}
                onClick={() => handleSelectQuestion(idx)}
                className="bg-white p-6 rounded-3xl border border-gray-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_25px_rgba(181,131,98,0.1)] transition-all duration-300 cursor-pointer group relative overflow-hidden"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded-[4px] text-[9px] font-bold tracking-widest uppercase bg-[#b58362]/10 text-[#b58362]">
                    QUESTION {idx + 1}
                  </span>
                  <span className="text-[10px] text-gray-300 font-mono">
                    {new Date(q.timestamp).toLocaleDateString()}
                  </span>
                </div>

                <h4 className="text-gray-800 font-serif text-base md:text-lg leading-relaxed line-clamp-2 mb-4 group-hover:text-[#b58362] transition-colors">
                  {q.data.text}
                </h4>

                <div className="flex items-center justify-between pt-4 border-t border-gray-50 mt-auto">
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-medium">
                    <Sparkles size={10} /> 再次练习
                  </div>
                  <button
                    onClick={(e) => handleDelete(q.id, e)}
                    className="p-2 text-gray-300 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {isPrintMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white z-[100] overflow-y-auto print:static print:overflow-visible"
          >
            {/* Control Bar - Hidden in Print */}
            <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b px-8 py-4 flex justify-between items-center print:hidden">
              <button onClick={() => setIsPrintMode(false)} className="flex items-center gap-2 text-gray-500 font-bold hover:text-gray-800">
                <ChevronLeft size={20} /> 退出打印预览
              </button>
              <button 
                onClick={() => window.print()}
                className="px-8 py-3 bg-[#b58362] text-white rounded-full font-bold shadow-lg shadow-[#b58362]/20 hover:scale-105 transition-all"
              >
                立即打印 (A4)
              </button>
            </div>

            {/* Print Content Area */}
            <div className="max-w-[210mm] mx-auto bg-white p-[20mm] md:my-10 shadow-2xl print:shadow-none print:m-0 print:p-0">
               {/* Print Styles */}
               <style>{`
                 @media print {
                   @page { margin: 15mm; size: A4; }
                   body { -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #333 !important; }
                   .no-break { break-inside: avoid; page-break-inside: avoid; display: block; }
                   .print-hidden { display: none !important; }
                   .print-only { display: table-footer-group !important; }
                   .print-header-only { display: table-header-group !important; }
                 }
                 .print-only { display: none; }
                 .print-header-only { display: none; }
                 .handwriting-line {
                   border-bottom: 1px dotted #ccc;
                   height: 1.2rem;
                   margin: 0.3rem 0;
                 }
                 .serif-print { font-family: 'STSong', 'SimSun', serif; }
               `}</style>
               
               <table className="w-full border-collapse">
                 <thead className="print-header-only">
                   <tr>
                     <td>
                       <div className="h-6 mb-4 border-b border-gray-100 flex items-end justify-between pb-2">
                         <span className="text-[9px] text-gray-400 font-bold tracking-widest uppercase">糯糯专升本语法 · 错题归档</span>
                         <span className="text-[9px] text-gray-300 font-mono italic">{new Date().toLocaleDateString()}</span>
                       </div>
                     </td>
                   </tr>
                 </thead>
                 <tbody className="table-row-group">
                   <tr>
                     <td>
                       <div className="mb-8 text-center border-b-2 border-[#b58362] pb-4">
                         <h1 className="text-4xl serif-print font-bold mb-4 tracking-widest leading-[1.6]">
                           <span className="bg-gray-100 print:bg-gray-100 px-3 py-1 box-decoration-clone leading-relaxed rounded-sm text-gray-800">糯糯专升本语法·错题复盘归档</span>
                         </h1>
                         <p className="text-xs text-gray-400 tracking-widest font-mono uppercase">Error Log Archive • {new Date().toLocaleDateString()}</p>
                       </div>

                       {/* Clustering Logic */}
               {Object.entries(
                 questionsToPrint.reduce((acc, q) => {
                   const key = q.data.tag || topics.find(t => t.id === (q.data.topic_id || q.data.topicId))?.name || '综合复习';
                   if (!acc[key]) acc[key] = [];
                   acc[key].push(q);
                   return acc;
                 }, {} as Record<string, any[]>)
               ).map(([tagName, groupQs]: [string, any[]]) => (
                 <div key={tagName} className="mb-12 no-break">
                   <div className="flex items-center gap-4 mb-8">
                     <div className="w-1.5 h-6 bg-[#b58362]"></div>
                     <h2 className="text-2xl font-bold serif-print text-gray-800 tracking-wide">考点：{tagName}</h2>
                   </div>

                   {/* Questions in this cluster */}
                   <div className="space-y-6 pl-4">
                     {groupQs.map((q, qIdx) => (
                       <div key={q.id} className="no-break border-l-2 border-gray-100 pl-6 pb-2">
                         <div className="flex gap-2 mb-3">
                           <span className="font-bold text-[#b58362] serif-print">题 {qIdx + 1}.</span>
                         </div>
                         <p className="text-[16px] text-gray-800 leading-[1.8] serif-print mb-6 print:text-black">
                           {q.data.text}
                           {q.data.source && <span className="text-[12px] text-gray-400 ml-2 font-mono print:text-gray-500">({q.data.source})</span>}
                         </p>
                         <div className="grid grid-cols-2 gap-y-3 gap-x-8 mb-4">
                           {q.data.options.map((opt: string, i: number) => (
                             <div key={i} className="text-sm text-gray-600 print:text-gray-800 flex gap-2">
                               <span className="font-bold text-gray-500 print:text-black w-4">{String.fromCharCode(65 + i)}.</span>
                               <span>{opt}</span>
                             </div>
                           ))}
                         </div>
                         
                         {/* Answer area for mental recall */}
                         <div className="flex items-center gap-6 mt-4 mb-4">
                           <div className="flex items-baseline gap-2 text-xs text-[#7a9e7e] font-bold print:text-gray-900">
                             <span className="uppercase tracking-widest text-[10px]">Reference Answer:</span>
                             <span className="text-xl serif-print font-bold print:text-black">{String.fromCharCode(65 + q.data.answer)}</span>
                           </div>
                         </div>

                         {/* Analysis Area */}
                         {(q.data.keyPoint || q.data.key_point || q.data.analysis) && (
                           <div className="mb-4 p-4 bg-gray-50/50 rounded-lg border border-gray-100 text-[13px] text-gray-700 serif-print leading-[1.8] print:bg-transparent print:border-none print:p-0 print:text-black">
                             <span className="font-bold text-gray-900 mr-1 print:text-black">【解析】</span>
                             <ReactMarkdown components={{ p: ({ children }) => <span className="inline-block mt-1 font-serif">{children}</span> }}>
                               {String(q.data.keyPoint || q.data.key_point || q.data.analysis || "").replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '')}
                             </ReactMarkdown>
                           </div>
                         )}

                         {/* Handwriting area below each question */}
                         <div className="mt-4 border-t border-dotted border-gray-200 pt-3">
                            <span className="text-[10px] text-gray-400 print:text-gray-600 font-bold tracking-widest uppercase italic">Self-Reflection & Notes:</span>
                            <div className="handwriting-line"></div>
                         </div>
                       </div>
                     ))}
                   </div>
                 </div>
               ))}
               
                     </td>
                   </tr>
                 </tbody>
                 <tfoot className="print-only">
                   <tr>
                     <td>
                       <div className="mt-12 pt-4 border-t border-gray-100 flex justify-between items-start">
                         <span className="text-[9px] text-gray-300 font-mono italic">DAWN ENGLISH • ADAPTIVE LEARNING SYSTEM</span>
                         <span className="text-[9px] text-gray-300 font-bold uppercase">糯糯专升本</span>
                       </div>
                     </td>
                   </tr>
                 </tfoot>
               </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
