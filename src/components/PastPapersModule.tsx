import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, BookOpen, FileText, Sparkles, Calendar, Clock, Loader2, ArrowRight, Check, X } from 'lucide-react';
import { cn } from './UI';
import { fetchPastPapers, fetchPaperQuestions, fetchPaperReadings, saveWrongQuestionAPI } from '../services/api';
import { Question, ReadingArticle } from '../constants';
import { getDeviceId } from '../utils/deviceId';
import { saveWrongQuestion } from '../utils/wrongQuestions';

type Section = 'grammar' | 'cloze' | 'reading';

export default function PastPapersModule() {
  const [activeProvince, setActiveProvince] = useState<string>('湖南');
  const [tree, setTree] = useState<Record<string, Record<string, string[]>>>({});
  const [loading, setLoading] = useState(true);
  
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<string | null>(null);

  const [paperData, setPaperData] = useState<{
    grammar: Question[];
    cloze: ReadingArticle[];
    reading: ReadingArticle[];
  } | null>(null);
  const [loadingPaper, setLoadingPaper] = useState(false);
  const [isPracticing, setIsPracticing] = useState(false);

  useEffect(() => {
    fetchPastPapers().then(data => {
      setTree(data);
      // If default province doesn't exist, pick first available
      const provinces = Object.keys(data);
      if (provinces.length > 0 && !data['湖南'] && !data['四川']) {
        setActiveProvince(provinces[0]);
      } else if (data['四川'] && !data['湖南']) {
        setActiveProvince('四川');
      }
      setLoading(false);
    });
  }, []);

  const handleSelectPaper = async (paper: string, year: string) => {
    setSelectedYear(year);
    setSelectedPaper(paper);
    setLoadingPaper(true);
    setIsPracticing(true);
    
    try {
      console.log(`[PAST-PAPERS] Fetching questions/readings for: "${paper}"`);
      const [grammar, reading] = await Promise.all([
        fetchPaperQuestions(paper),
        fetchPaperReadings(paper)
      ]);
      
      const clozeData = reading.filter(r => (r as any).type === 'cloze');
      const realReading = reading.filter(r => (r as any).type !== 'cloze');

      console.log(`[PAST-PAPERS] Loaded ${grammar.length} grammar, ${clozeData.length} cloze, ${realReading.length} readings`);
      setPaperData({ grammar, cloze: clozeData, reading: realReading });
      
      // Auto-switch to first non-empty section
      if (grammar.length > 0) {
        // already default
      } else if (clozeData.length > 0) {
        // will need to pass this somehow or set it in PaperPractice
      }
    } catch (e) {
      console.error('Failed to load paper data', e);
    } finally {
      setLoadingPaper(false);
    }
  };

  const quitPractice = () => {
    setIsPracticing(false);
    setPaperData(null);
    setSelectedPaper(null);
    setSelectedYear(null);
  };

  // Strictly only allow Hunan and Sichuan as requested
  const allowedProvinces = ['湖南', '四川'];
  const displayProvinces = allowedProvinces; // Always show both

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#faf9f6]">
        <Loader2 className="animate-spin text-[#b58362]" size={32} />
      </div>
    );
  }

  if (isPracticing) {
    return (
      <div className="flex-1 flex flex-col bg-[#faf9f6] relative h-full">
        <div className="flex items-center gap-4 px-6 md:px-10 py-4 shrink-0 z-10">
          <button onClick={quitPractice} className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors shrink-0">
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <div className="flex flex-col">
            <h2 className="text-lg md:text-xl font-serif font-bold text-gray-800 tracking-widest truncate max-w-[200px] md:max-w-none">
              {selectedPaper}
            </h2>
            <span className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">
              {activeProvince} · {selectedYear}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto hide-scrollbar px-6 md:px-10 pb-12">
          {loadingPaper ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="animate-spin text-[#b58362]" size={32} />
              <p className="text-sm text-gray-400 font-serif tracking-widest uppercase">Preparing Paper...</p>
            </div>
          ) : (
            <PaperPractice data={paperData!} onBack={quitPractice} paperTitle={selectedPaper!} />
          )}
        </div>
      </div>
    );
  }

  const currentProvinceData = tree[activeProvince] || {};
  const years = Object.keys(currentProvinceData).sort((a, b) => b.localeCompare(a));

  return (
    <div className="flex-1 flex flex-col bg-[#faf9f6] relative overflow-hidden h-full">
      {/* Province Switcher Tabs */}
      <div className="px-6 md:px-10 pt-6 pb-2 shrink-0 overflow-x-auto hide-scrollbar">
        <div className="flex p-1 bg-gray-100 rounded-2xl w-fit">
          {displayProvinces.map((p) => (
            <button
              key={p}
              onClick={() => {
                setActiveProvince(p);
                setSelectedYear(null);
              }}
              className={cn(
                "px-6 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap",
                activeProvince === p 
                  ? "bg-white text-[#b58362] shadow-sm" 
                  : "text-gray-400 hover:text-gray-600"
              )}
            >
              {p}真题
            </button>
          ))}
          {displayProvinces.length === 0 && (
            <div className="px-6 py-2.5 text-sm text-gray-400 italic">暂无真题数据</div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto hide-scrollbar px-6 md:px-10 pb-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeProvince}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="flex flex-col gap-6 pt-4"
          >
            {years.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                  <FileText className="text-gray-200" size={32} />
                </div>
                <p className="text-gray-400 font-serif italic text-sm">该地区暂无已上传的真题年份</p>
              </div>
            ) : (
              years.map((year) => (
                <div key={year} className="flex flex-col gap-3">
                  <div className="flex items-center gap-3 px-1">
                    <Calendar size={14} className="text-[#b58362]" />
                    <span className="text-sm font-serif font-bold text-gray-400 tracking-widest">{year} 年份</span>
                    <div className="h-px bg-gray-100 flex-1"></div>
                  </div>
                  <div className="flex flex-col gap-3">
                    {currentProvinceData[year].map((paper, idx) => (
                      <div
                        key={paper}
                        onClick={() => handleSelectPaper(paper, year)}
                        className="bg-white rounded-3xl p-5 md:p-6 flex flex-col md:flex-row md:items-center justify-between shadow-sm border border-gray-100 hover:border-[#b58362]/30 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-[#f8f1e7] flex items-center justify-center text-[#b58362] shrink-0 group-hover:bg-[#1a1a1a] group-hover:text-white transition-colors">
                            <BookOpen size={20} />
                          </div>
                          <div className="flex flex-col">
                            <h3 className="text-lg font-serif font-bold text-gray-800 group-hover:text-[#b58362] transition-colors leading-tight mb-0.5">
                              {paper}
                            </h3>
                            <div className="flex items-center gap-3 text-gray-400 text-[10px] tracking-wide">
                              <span className="flex items-center gap-1 uppercase"><Check size={10} className="text-green-500" /> 已校验</span>
                              <span className="flex items-center gap-1 uppercase"><Clock size={10} /> 模拟实战</span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 md:mt-0 flex items-center justify-end text-[10px] font-bold text-[#b58362] tracking-widest uppercase opacity-0 group-hover:opacity-100 transition-opacity">
                          Start Practice <ChevronRight size={14} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------- Sub-component for actual practice ----------

function PaperPractice({ data, onBack, paperTitle }: { 
  data: { 
    grammar: Question[]; 
    cloze: ReadingArticle[];
    reading: ReadingArticle[] 
  }, 
  onBack: () => void, 
  paperTitle: string 
}) {
  const [activeSection, setActiveSection] = useState<Section>(
    data.grammar.length > 0 ? 'grammar' : (data.cloze.length > 0 ? 'cloze' : 'reading')
  );
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number | null>>({}); // key style: "grammar_0" or "cloze_0_1" or "reading_0_1"
  const [isFinished, setIsFinished] = useState(false);

  // For Reading Section
  const [currentReadingIdx, setCurrentReadingIdx] = useState(0);
  const [currentReadingQIdx, setCurrentReadingQIdx] = useState(0);

  const deviceId = getDeviceId();

  const handleSelectGrammar = (idx: number) => {
    if (selected !== null) return;
    const question = data.grammar[currentQ];
    setSelected(idx);
    
    const isCorrect = idx === question.answer;
    setAnswers(prev => ({ ...prev, [`grammar_${currentQ}`]: idx }));
    
    if (!isCorrect) {
      saveWrongQuestion('grammar', question);
      saveWrongQuestionAPI(deviceId, 'grammar', question).catch(console.error);
    }
  };

  const handleSelectReading = (idx: number) => {
    const article = data.reading[currentReadingIdx];
    const question = article.questions[currentReadingQIdx];
    const key = `reading_${currentReadingIdx}_${currentReadingQIdx}`;
    
    if (answers[key] !== undefined) return;
    
    setAnswers(prev => ({ ...prev, [key]: idx }));
    
    if (idx !== question.answer) {
      const payload = {
        id: `reading-${article.id}-${currentReadingQIdx}`,
        text: question.text,
        options: question.options,
        answer: question.answer,
        analysis: question.analysis,
        source: paperTitle,
        article: article.article
      };
      saveWrongQuestion('reading', payload);
      saveWrongQuestionAPI(deviceId, 'reading', payload).catch(console.error);
    }
  };

  const handleSelectCloze = (idx: number) => {
    const article = data.cloze[currentReadingIdx];
    const question = article.questions[currentReadingQIdx];
    const key = `cloze_${currentReadingIdx}_${currentReadingQIdx}`;
    
    if (answers[key] !== undefined) return;
    
    setAnswers(prev => ({ ...prev, [key]: idx }));
    
    if (idx !== question.answer) {
      const payload = {
        id: `cloze-${article.id}-${currentReadingQIdx}`,
        text: question.text,
        options: question.options,
        answer: question.answer,
        analysis: question.analysis,
        source: paperTitle,
        article: article.article
      };
      saveWrongQuestion('reading', payload); // Reuse reading for wrong questions UI
      saveWrongQuestionAPI(deviceId, 'reading', payload).catch(console.error);
    }
  };

  const nextGrammar = () => {
    if (currentQ < data.grammar.length - 1) {
      setCurrentQ(currentQ + 1);
      setSelected(null);
    } else {
      if (data.cloze.length > 0) setActiveSection('cloze');
      else if (data.reading.length > 0) setActiveSection('reading');
      else setIsFinished(true);
    }
  };

  const nextCloze = () => {
    const article = data.cloze[currentReadingIdx];
    if (currentReadingQIdx < article.questions.length - 1) {
      setCurrentReadingQIdx(currentReadingQIdx + 1);
    } else if (currentReadingIdx < data.cloze.length - 1) {
      setCurrentReadingIdx(currentReadingIdx + 1);
      setCurrentReadingQIdx(0);
    } else {
      if (data.reading.length > 0) {
        setActiveSection('reading');
        setCurrentReadingIdx(0);
        setCurrentReadingQIdx(0);
      } else {
        setIsFinished(true);
      }
    }
  };

  const nextReading = () => {
    const article = data.reading[currentReadingIdx];
    if (currentReadingQIdx < article.questions.length - 1) {
      setCurrentReadingQIdx(currentReadingQIdx + 1);
    } else if (currentReadingIdx < data.reading.length - 1) {
      setCurrentReadingIdx(currentReadingIdx + 1);
      setCurrentReadingQIdx(0);
    } else {
      setIsFinished(true);
    }
  };

  if (isFinished) {
    // Calculate total score or just summary
    const grammarCorrect = data.grammar.filter((_, i) => answers[`grammar_${i}`] === data.grammar[i].answer).length;
    let readingCorrect = 0;
    let readingTotal = 0;
    data.cloze.forEach((article, i) => {
      article.questions.forEach((q, j) => {
        readingTotal++;
        if (answers[`cloze_${i}_${j}`] === q.answer) readingCorrect++;
      });
    });
    data.reading.forEach((article, i) => {
      article.questions.forEach((q, j) => {
        readingTotal++;
        if (answers[`reading_${i}_${j}`] === q.answer) readingCorrect++;
      });
    });

    const totalCorrect = grammarCorrect + readingCorrect;
    const totalQuestions = data.grammar.length + readingTotal;
    const pct = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

    return (
      <div className="flex flex-col items-center justify-center py-10 px-6 text-center animate-fade-in">
        <div className="w-24 h-24 bg-[#f0ebd8] rounded-full flex items-center justify-center mb-6 shadow-md">
          <Sparkles className="text-[#d4c5b0]" size={40} />
        </div>
        <h2 className="text-3xl font-serif font-bold text-gray-800 mb-2">真题模考结束</h2>
        <p className="text-gray-400 mb-8 max-w-sm">你已完成本套卷子的所有题目。通过真题练习，你的备考水平又有了质的飞跃！</p>
        
        <div className="grid grid-cols-2 gap-6 w-full max-w-md mb-12">
          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
            <span className="text-[10px] text-gray-400 uppercase tracking-widest block mb-1">Grammar</span>
            <span className="text-2xl font-serif font-bold text-[#b58362]">{grammarCorrect} <span className="text-xs text-gray-300">/ {data.grammar.length}</span></span>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
            <span className="text-[10px] text-gray-400 uppercase tracking-widest block mb-1">Reading</span>
            <span className="text-2xl font-serif font-bold text-[#b58362]">{readingCorrect} <span className="text-xs text-gray-300">/ {readingTotal}</span></span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 mb-10">
          <span className="text-6xl font-serif font-bold" style={{ color: pct >= 80 ? '#7a9e7e' : '#b58362' }}>{pct}%</span>
          <span className="text-[10px] text-gray-400 uppercase tracking-[0.2em] font-bold">Accuracy Score</span>
        </div>

        <button onClick={onBack} className="bg-[#1a1a1a] text-white px-10 py-4 rounded-full font-bold shadow-lg hover:scale-105 active:scale-95 transition-all">
          返回真题库
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Paper Nav */}
      <div className="flex items-center justify-center gap-1 mb-8 overflow-x-auto hide-scrollbar shrink-0">
        <button 
          onClick={() => setActiveSection('grammar')}
          className={cn(
            "px-6 py-2 rounded-full text-xs font-bold transition-all",
            activeSection === 'grammar' ? "bg-[#1a1a1a] text-white shadow-md" : "text-gray-400 hover:text-gray-600"
          )}
        >
          Section I: Grammar
        </button>
        {data.cloze.length > 0 && (
          <button 
            onClick={() => {
              setActiveSection('cloze');
              setCurrentReadingIdx(0);
              setCurrentReadingQIdx(0);
            }}
            className={cn(
              "px-6 py-2 rounded-full text-xs font-bold transition-all",
              activeSection === 'cloze' ? "bg-[#1a1a1a] text-white shadow-md" : "text-gray-400 hover:text-gray-600"
            )}
          >
            Section II: Cloze
          </button>
        )}
        {data.reading.length > 0 && (
          <button 
            onClick={() => {
              setActiveSection('reading');
              setCurrentReadingIdx(0);
              setCurrentReadingQIdx(0);
            }}
            className={cn(
              "px-6 py-2 rounded-full text-xs font-bold transition-all",
              activeSection === 'reading' ? "bg-[#1a1a1a] text-white shadow-md" : "text-gray-400 hover:text-gray-600"
            )}
          >
            Section III: Reading
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto hide-scrollbar">
        {activeSection === 'grammar' && data.grammar.length > 0 && (
          <div className="max-w-3xl mx-auto w-full">
            <div className="mb-8">
              <span className="text-[10px] text-gray-400 uppercase tracking-[0.2em] font-bold mb-2 block">
                Question {currentQ + 1} of {data.grammar.length}
              </span>
              <div className="text-xl md:text-2xl font-serif font-medium leading-relaxed text-gray-800">
                {data.grammar[currentQ].text.split('\n').map((line, i) => (
                  <p key={i} className={i > 0 ? 'mt-2' : ''}>{line}</p>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {data.grammar[currentQ].options.map((opt, idx) => {
                const isSelected = selected === idx;
                const isCorrect = data.grammar[currentQ].answer === idx;
                const isRevealed = selected !== null;
                
                let btnClass = "bg-white border-transparent shadow-sm hover:shadow-md";
                if (isRevealed) {
                  if (isCorrect) btnClass = "bg-green-50 border-green-100 text-green-700";
                  else if (isSelected) btnClass = "bg-red-50 border-red-100 text-red-700";
                  else btnClass = "opacity-40 grayscale-[0.5]";
                }

                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectGrammar(idx)}
                    className={cn("p-6 rounded-[1.5rem] border text-left transition-all duration-300 flex justify-between items-center group", btnClass)}
                  >
                    <span className="text-base font-serif">{opt}</span>
                    {isRevealed && isCorrect && <Check size={18} className="text-green-500" />}
                    {isRevealed && isSelected && !isCorrect && <X size={18} className="text-red-500" />}
                  </button>
                );
              })}
            </div>

            <AnimatePresence>
              {selected !== null && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#faf9f6] border border-gray-100 rounded-3xl p-8 mb-12 shadow-inner"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1.5 h-4 bg-[#b58362] rounded-full"></div>
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Detail Analysis</span>
                  </div>
                  <div 
                    className="analysis-point-text prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ 
                      __html: (() => {
                        const raw = ((data.grammar[currentQ] as any).keyPoint || (data.grammar[currentQ] as any).key_point || "") as string;
                        
                        // 1. Strip all Emojis
                        const noEmoji = raw.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '');

                        // 2. Normalize headings: match either "Label:" or "【Label】"
                        const normalized = noEmoji
                          .replace(/(?:^|\n)\s*(?:【)?\s*(核心考点|详细解析|标准答案|考点图谱|题干破冰|寻找线索|逻辑推理|选项深挖|技巧点拨|高频错点|命题人视角|易错提醒|补充)\s*(?:】)?\s*[:：]?/g, '\n【$1】');

                        let html = normalized
                          .replace(/【核心考点】/g, '<div class="analysis-card"><span class="analysis-highlight-label">核心考点：</span>')
                          .replace(/【详细解析】/g, '</div><div class="analysis-card"><span class="analysis-highlight-label">详细解析：</span>')
                          .replace(/【易错提醒】/g, '<br/><div><span class="analysis-highlight-label">易错提醒：</span>')
                          .replace(/【补充】/g, '<br/><div><span class="analysis-highlight-label">补充：</span>')
                          .replace(/【技巧点拨】/g, '<div class="analysis-tips-section"><span class="analysis-highlight-label">技巧点拨：</span>')
                          .replace(/【高频错点】/g, '<div><span class="analysis-highlight-label">高频错点：</span>')
                          .replace(/【命题人视角】/g, '<div><span class="analysis-highlight-label">命题人视角：</span>')
                          .replace(/【标准答案】/g, '<div><span class="analysis-highlight-label">标准答案：</span>')
                          .replace(/【考点图谱】/g, '<div><span class="analysis-highlight-label">考点图谱：</span>')
                          .replace(/【题干破冰】/g, '<div><span class="analysis-highlight-label">题干破冰：</span>')
                          .replace(/【寻找线索】/g, '<div><span class="analysis-highlight-label">寻找线索：</span>')
                          .replace(/【逻辑推理】/g, '<div><span class="analysis-highlight-label">逻辑推理：</span>')
                          .replace(/【选项深挖】/g, '<div><span class="analysis-highlight-label">选项深挖：</span>')
                          .replace(/^\s*(?:\d\.\s)?\*\*(第[一二三四五]步：?.*?)\*\*/gm, '<div class="analysis-step-title">$1</div>')
                          .replace(/(?:\n|^)\s*([A-D]\b\.?\s*[^：:\n]*)([:：])/g, '</div><div class="analysis-option-block"><span class="analysis-label-theme">$1$2</span>')
                          .replace(/^\s*[-•]\s+/gm, '') 
                          .replace(/\*\*(.*?)\*\*/g, '<strong class="analysis-bold-highlight">$1</strong>')
                          .replace(/\n\n/g, '</div><div class="h-6"></div>')
                          .replace(/\n/g, '<br/>');
                        
                        const hasCard = html.includes('analysis-card');
                        if (!hasCard) {
                          html = `<div class="analysis-card">${html}</div>`;
                        } else {
                          html = html + '</div>';
                        }
                        return html;
                      })()
                    }} 
                  />
                  <div className="mt-8 flex justify-end">
                    <button onClick={nextGrammar} className="bg-[#1a1a1a] text-white px-8 py-3 rounded-full text-sm font-bold shadow-md hover:translate-x-1 transition-transform flex items-center gap-2">
                      Next Question <ChevronRight size={16} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {activeSection === 'cloze' && data.cloze.length > 0 && (
          <div className="flex flex-col gap-10">
            {/* Cloze Article */}
            <div className="bg-[#FDFCF9] p-8 md:p-12 rounded-[2.5rem] shadow-sm border border-[#efe8dd] paper-texture relative overflow-hidden">
               <div className="absolute inset-0 pointer-events-none opacity-[0.02]" style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px)', backgroundSize: '100% 2.5rem' }}></div>
               <div className="relative z-10">
                 <div className="mb-6 flex items-center justify-between">
                   <span className="text-[10px] text-[#b58362] font-bold uppercase tracking-[0.2em]">Cloze Passage</span>
                   <span className="text-[10px] text-gray-300 font-mono tracking-widest">{currentReadingIdx + 1} / {data.cloze.length}</span>
                 </div>
                 {data.cloze[currentReadingIdx].article.map((p, i) => (
                   <p key={i} className="text-lg md:text-xl font-serif leading-relaxed text-gray-800 mb-6 last:mb-0">
                     {p.text}
                   </p>
                 ))}
               </div>
            </div>

            {/* Cloze Questions */}
            <div className="max-w-2xl mx-auto w-full pt-4">
              <span className="text-[10px] text-gray-400 uppercase tracking-[0.2em] font-bold mb-4 block text-center">
                Question {currentReadingQIdx + 1} of {data.cloze[currentReadingIdx].questions.length}
              </span>
              <div className="text-lg md:text-xl font-serif font-medium leading-relaxed text-gray-800 text-center mb-8">
                {data.cloze[currentReadingIdx].questions[currentReadingQIdx].text}
              </div>

              <div className="flex flex-col gap-3">
                {data.cloze[currentReadingIdx].questions[currentReadingQIdx].options.map((opt, idx) => {
                  const key = `cloze_${currentReadingIdx}_${currentReadingQIdx}`;
                  const userAns = answers[key];
                  const isSelected = userAns === idx;
                  const isCorrect = data.cloze[currentReadingIdx].questions[currentReadingQIdx].answer === idx;
                  const isRevealed = userAns !== undefined;

                  let btnClass = "bg-white border-[#f0ebe0] hover:border-[#b58362]/30";
                  if (isRevealed) {
                    if (isCorrect) btnClass = "bg-green-50 border-green-200 text-green-700 shadow-sm";
                    else if (isSelected) btnClass = "bg-red-50 border-red-200 text-red-700 shadow-sm";
                    else btnClass = "opacity-40 grayscale-[0.5]";
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelectCloze(idx)}
                      className={cn("p-5 rounded-2xl border text-left transition-all duration-300 flex justify-between items-center", btnClass)}
                    >
                      <span className="text-base font-serif flex-1">{opt}</span>
                      {isRevealed && isCorrect && <Check size={18} className="text-green-500 shrink-0 ml-4" />}
                      {isRevealed && isSelected && !isCorrect && <X size={18} className="text-red-500 shrink-0 ml-4" />}
                    </button>
                  );
                })}
              </div>

              {answers[`cloze_${currentReadingIdx}_${currentReadingQIdx}`] !== undefined && (
                <div className="mt-10 flex flex-col items-center">
                   <AnimatePresence>
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-[#faf9f6] border border-gray-100 rounded-3xl p-8 mb-10 shadow-inner w-full text-left"
                    >
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-1.5 h-4 bg-[#b58362] rounded-full"></div>
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Cloze Analysis</span>
                      </div>
                      <div 
                        className="analysis-point-text prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ 
                          __html: (data.cloze[currentReadingIdx].questions[currentReadingQIdx].analysis || "")
                            .replace(/【核心考点】/g, '<div class="analysis-card"><span class="analysis-label-theme">核心考点：</span>')
                            .replace(/【详细解析】/g, '</div><div class="analysis-card"><div class="analysis-label-theme">详细解析：</div>')
                            .replace(/^\s*[-•]\s+/gm, '') 
                            .replace(/\n/g, '<br/>')
                            + '</div>'
                        }} 
                      />
                    </motion.div>
                  </AnimatePresence>
                  <button onClick={nextCloze} className="bg-[#1a1a1a] text-white px-10 py-3 rounded-full text-sm font-bold shadow-lg hover:scale-105 transition-all">
                    Continuing <ArrowRight className="inline-block ml-2" size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeSection === 'reading' && data.reading.length > 0 && (
          <div className="flex flex-col gap-10">
            {/* Reading Article */}
            <div className="bg-[#FDFCF9] p-8 md:p-12 rounded-[2.5rem] shadow-sm border border-[#efe8dd] paper-texture relative overflow-hidden">
               <div className="absolute inset-0 pointer-events-none opacity-[0.02]" style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px)', backgroundSize: '100% 2.5rem' }}></div>
               <div className="relative z-10">
                 <div className="mb-6 flex items-center justify-between">
                   <span className="text-[10px] text-[#b58362] font-bold uppercase tracking-[0.2em]">Reading Passage {currentReadingIdx + 1}</span>
                   <span className="text-[10px] text-gray-300 font-mono tracking-widest">{currentReadingIdx + 1} / {data.reading.length}</span>
                 </div>
                 {data.reading[currentReadingIdx].article.map((p, i) => (
                   <p key={i} className="text-lg md:text-xl font-serif leading-relaxed text-gray-800 mb-6 last:mb-0">
                     {p.text}
                   </p>
                 ))}
               </div>
            </div>

            {/* Reading Questions */}
            <div className="max-w-2xl mx-auto w-full pt-4">
              <span className="text-[10px] text-gray-400 uppercase tracking-[0.2em] font-bold mb-4 block text-center">
                Question {currentReadingQIdx + 1} of {data.reading[currentReadingIdx].questions.length}
              </span>
              <div className="text-lg md:text-xl font-serif font-medium leading-relaxed text-gray-800 text-center mb-8">
                {data.reading[currentReadingIdx].questions[currentReadingQIdx].text}
              </div>

              <div className="flex flex-col gap-3">
                {data.reading[currentReadingIdx].questions[currentReadingQIdx].options.map((opt, idx) => {
                  const key = `reading_${currentReadingIdx}_${currentReadingQIdx}`;
                  const userAns = answers[key];
                  const isSelected = userAns === idx;
                  const isCorrect = data.reading[currentReadingIdx].questions[currentReadingQIdx].answer === idx;
                  const isRevealed = userAns !== undefined;

                  let btnClass = "bg-white border-[#f0ebe0] hover:border-[#b58362]/30";
                  if (isRevealed) {
                    if (isCorrect) btnClass = "bg-green-50 border-green-200 text-green-700 shadow-sm";
                    else if (isSelected) btnClass = "bg-red-50 border-red-200 text-red-700 shadow-sm";
                    else btnClass = "opacity-40 grayscale-[0.5]";
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelectReading(idx)}
                      className={cn("p-5 rounded-2xl border text-left transition-all duration-300 flex justify-between items-center", btnClass)}
                    >
                      <span className="text-base font-serif flex-1">{opt}</span>
                      {isRevealed && isCorrect && <Check size={18} className="text-green-500 shrink-0 ml-4" />}
                      {isRevealed && isSelected && !isCorrect && <X size={18} className="text-red-500 shrink-0 ml-4" />}
                    </button>
                  );
                })}
              </div>

              {answers[`reading_${currentReadingIdx}_${currentReadingQIdx}`] !== undefined && (
                <div className="mt-10 flex flex-col items-center">
                  <button onClick={nextReading} className="bg-[#1a1a1a] text-white px-10 py-3 rounded-full text-sm font-bold shadow-lg hover:scale-105 transition-all">
                    Continuing <ArrowRight className="inline-block ml-2" size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
