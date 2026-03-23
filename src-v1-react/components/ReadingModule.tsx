import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { READING_DATA, ReadingArticle } from '../constants';
import { RefreshCw, PenLine, Eraser, Trash2, Sparkles, Highlighter, Palette, Loader2 } from 'lucide-react';
import { cn } from './UI';
import { saveWrongQuestion } from '../utils/wrongQuestions';
import { fetchReadingArticles, fetchReadingById, saveWrongQuestionAPI } from '../services/api';
import { getDeviceId } from '../utils/deviceId';

const InteractiveBonusQuestion = ({ text }: { text: string }) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  
  // Extract the correct answer letter and explanation
  const answerMatch = text.match(/(?:<br\/>)*[（(]\s*答案[：:]\s*([A-D])\s*[，,]?\s*(.*?)[）)](?:<br\/>|$)/);
  const correctLetter = answerMatch ? answerMatch[1] : "";
  const answerExplanation = answerMatch ? answerMatch[2] : "";
  const questionContent = text.replace(/(?:<br\/>)*[（(]\s*答案[：:].*?[）)](?:<br\/>|$)/, "");
  
  // Extract the question stem (everything before the first option line A.)
  const questionTextOnly = questionContent
    .replace(/(?:^|(?:<br\/>)+)\s*A[.．][\s\S]*$/, '')
    .replace(/<br\/>$/, '');

  // Match each option A/B/C/D individually to avoid duplicates or regex runaway
  const getOptionText = (letter: string): string => {
    const re = new RegExp(`(?:^|<br\\/>)\\s*${letter}[.．]\\s*(.*?)(?=<br\\/>\\s*[A-D][.．]|$)`, 's');
    const m = questionContent.match(re);
    return m ? m[1].replace(/<br\/>/g, ' ').trim() : '';
  };
  const options = (['A', 'B', 'C', 'D'] as const)
    .map(letter => ({ letter, text: getOptionText(letter) }))
    .filter(opt => opt.text !== '');


  const handleSelect = (letter: string) => {
    if (!selectedOption) setSelectedOption(letter);
  };
  
  return (
    <div className="bg-[#fcfdfa] border border-[#e8f0e6] rounded-2xl p-5 md:p-6 mt-8 shadow-[0_8px_30px_rgba(0,0,0,0.03)] overflow-hidden select-text">
      <div className="flex items-center gap-3 mb-4 border-b border-[#a5c2a1]/20 pb-3">
        <span className="bg-gradient-to-br from-[#8ab398] to-[#a5c2a1] text-white w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm">Q</span>
        <span className="text-[#5e7e69] font-bold text-lg tracking-wide">举一反三小题</span>
      </div>
      
      <div className="text-gray-800 text-[15px] mb-4 leading-relaxed" dangerouslySetInnerHTML={{ __html: questionTextOnly }} />
      
      <div className="flex flex-col gap-2.5 mb-4">
        {options.map(opt => {
          const isSelected = selectedOption === opt.letter;
          const isCorrect = opt.letter === correctLetter;
          const isRevealed = selectedOption !== null;
          
          let btnClass = 'bg-gray-50 text-gray-700 border border-transparent hover:bg-[#f2f7f4] hover:border-[#a5c2a1] cursor-pointer';
          if (isRevealed) {
            if (isCorrect) btnClass = 'bg-[#f2f7f4] text-[#4a7c59] border border-[#d0e3d5] shadow-sm';
            else if (isSelected) btnClass = 'bg-[#fcf5f1] text-[#c98a6c] border border-[#fae5d3] shadow-sm';
            else btnClass = 'bg-transparent text-gray-300 border border-transparent opacity-50';
          }
          
          return (
            <button
              key={opt.letter}
              onClick={() => handleSelect(opt.letter)}
              className={`p-3.5 rounded-xl text-left text-[14px] md:text-[15px] transition-all duration-300 w-full flex items-start gap-2.5 ${btnClass}`}
            >
              <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold ${
                isRevealed && isCorrect ? 'bg-[#4a7c59] text-white' : 
                isRevealed && isSelected ? 'bg-[#c98a6c] text-white' : 
                'bg-gray-200 text-gray-500'
              }`}>{opt.letter}</span>
              <span className="flex-1">{opt.text}</span>
              {isRevealed && isCorrect && <span className="text-[#4a7c59] shrink-0">✓</span>}
              {isRevealed && isSelected && !isCorrect && <span className="text-[#c98a6c] shrink-0">✗</span>}
            </button>
          );
        })}
      </div>
      
      {selectedOption && (
        <div className="bg-[#f2f7f4] rounded-xl p-4 border border-[#d0e3d5]">
          <div className="text-[#4a7c59] font-bold mb-2 flex items-center gap-2 text-[14px]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4a7c59]"></span>
            {selectedOption === correctLetter ? '回答正确！' : `正确答案是 ${correctLetter}`}
          </div>
          {answerExplanation && <div className="text-gray-700 leading-relaxed text-[14px]" dangerouslySetInnerHTML={{ __html: answerExplanation }} />}
        </div>
      )}
    </div>
  );
};

export default function ReadingModule() {
  const [loading, setLoading] = useState(true);
  const [articlesList, setArticlesList] = useState<{id: string, source: string}[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [articleData, setArticleData] = useState<ReadingArticle | null>(null);
  
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [isPenActive, setIsPenActive] = useState(false);
  const [activeTool, setActiveTool] = useState<'pen' | 'marker' | 'eraser'>('pen');
  const [penColor, setPenColor] = useState('#4A3E31');

  const articleRef = useRef<HTMLDivElement>(null);
  const questionsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const questionsCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const activeCanvas = useRef<HTMLCanvasElement | null>(null);
  const activeContainer = useRef<HTMLDivElement | null>(null);
  const points = useRef<any[]>([]);
  const lastWidth = useRef(0);
  const passageDrawings = useRef<Record<number, string>>({});
  const questionDrawings = useRef<Record<number, string>>({});

  // Load article list on mount
  useEffect(() => {
    fetchReadingArticles().then(data => {
      setArticlesList(data);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to fetch reading list:', err);
      setLoading(false);
    });
  }, []);

  const saveLocalState = (
    currentAnswers: Record<number, number>, 
    currentIsSubmitted: boolean,
    articleId: string | null = selectedArticleId
  ) => {
    if (!articleId) return;
    const state = {
      answers: currentAnswers,
      isSubmitted: currentIsSubmitted,
      passageDrawings: passageDrawings.current,
      questionDrawings: questionDrawings.current
    };
    try {
      localStorage.setItem(`reading_state_${articleId}`, JSON.stringify(state));
    } catch(e) { console.error('Failed to save reading state to localStorage', e) }
  };

  const handleSelectArticle = (id: string) => {
    setLoading(true);
    fetchReadingById(id).then(data => {
      if (data) {
        setArticleData(data);
        setSelectedArticleId(id);
        
        try {
          const savedStr = localStorage.getItem(`reading_state_${id}`);
          if (savedStr) {
            const saved: any = JSON.parse(savedStr);
            setCurrentQ(0);
            setAnswers(saved.answers || {});
            setIsSubmitted(saved.isSubmitted || false);
            passageDrawings.current = saved.passageDrawings || {};
            questionDrawings.current = saved.questionDrawings || {};
          } else {
            setCurrentQ(0);
            setAnswers({});
            setIsSubmitted(false);
            passageDrawings.current = {};
            questionDrawings.current = {};
          }
        } catch(e) {
          setCurrentQ(0);
          setAnswers({});
          setIsSubmitted(false);
          passageDrawings.current = {};
          questionDrawings.current = {};
        }

        // Just clear the actual canvas surfaces
        [canvasRef, questionsCanvasRef].forEach(ref => {
          const canvas = ref.current;
          if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
          }
        });
      }
      setLoading(false);
    });
  };

  const handleBackToList = () => {
    setSelectedArticleId(null);
    setArticleData(null);
  };

  // --- Auto-Split Passages & Parse Data ---
  const processedArticle = React.useMemo(() => {
    if (!articleData) return null;
    
    const parsedPassages: { name: string; paragraphs: any[] }[] = [];
    let currentP: any[] = [];
    let currentPassageName = "Passage 1";
    let foundAnyPassage = false;
    
    articleData.article.forEach((p: any) => {
      // Create a fallback text by joining sentences if p.text is omitted
      const pText = p.text || (p.sentences ? p.sentences.map((s: any) => s.text).join('') : '');

      // 1. Remove generic directions
      if (
        pText.includes('Directions:') || 
        /Reading Comprehension\s*\(\d+\s*points\)/i.test(pText)
      ) {
        return;
      }
      
      // 2. Auto-identify passages (e.g. "Passage 1", "Passage One", "Passage A")
      const passageMatch = pText.match(/(?:---\n)?(Passage\s*[A-Za-z0-9]+)/i);
      if (passageMatch) {
        if (currentP.length > 0 && foundAnyPassage) {
           parsedPassages.push({ name: currentPassageName, paragraphs: currentP });
           currentP = [];
        }
        currentPassageName = passageMatch[1];
        foundAnyPassage = true;
        // Clean the dashed line and the boilerplate statement about questions
        let cleanText = pText
          .replace(/^---\n/, '')
          .replace(/Questions\s*\d+\s*-\s*\d+\s*are\s*based\s*on\s*the\s*following\s*passage\.?\s*/i, '')
          .replace(/Passage\s*[A-Za-z0-9]+\s*\n?/i, '');
          
        if (cleanText.trim()) {
          currentP.push({ ...p, text: cleanText });
        }
      } else {
        currentP.push(p);
      }
    });

    if (currentP.length > 0) {
      parsedPassages.push({ name: currentPassageName, paragraphs: currentP });
    }
    
    if (!foundAnyPassage && parsedPassages.length === 1) {
       parsedPassages[0].name = "Reading";
    }

    return parsedPassages;
  }, [articleData]);
  
  const cleanQuestionText = (text: string) => text.replace(/^\s*\d+[\.．、\s]+/, '');
  const cleanOptionText = (text: string) => text.replace(/^\s*(?:[A-D][\.．、\s]+)+/i, '');

  const getPenWidth = (pressure: number, velocity: number) => {
    const isMobile = window.innerWidth < 768;
    if (activeTool === 'eraser') {
      const baseEraserWidth = isMobile ? 12 : 20;
      const pressureFactor = (pressure === 0.5 || pressure === 0) ? 1 : (0.5 + pressure);
      return baseEraserWidth * pressureFactor;
    }

    if (activeTool === 'marker') {
      return isMobile ? 10 : 16; // Maintain visibility while being more precise
    }

    // 水性笔 (Water-based pen) feel: ultrathin as per user's demand
    const baseWidth = isMobile ? 0.8 : 1.2;
    const maxMultiplier = 1.8;
    const minMultiplier = 0.5;

    const vFactor = Math.max(0, Math.min(1, velocity / 4));
    const simulatedPressure = 1 - Math.pow(vFactor, 1.5); // non-linear for better expression

    const finalPressure = (pressure === 0.5 || pressure === 0) ? simulatedPressure : pressure;
    const width = baseWidth * (minMultiplier + (maxMultiplier - minMultiplier) * finalPressure);
    return width;
  };

  // Initialize canvas sizes
  useEffect(() => {
    if (loading) return;

    const resizeAndRestore = (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;

      const cssWidth = canvas.offsetWidth;
      const cssHeight = canvas.offsetHeight;
      const dpr = window.devicePixelRatio || 1;

      if (canvas.width === cssWidth * dpr && canvas.height === cssHeight * dpr) return;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx && canvas.width > 0 && canvas.height > 0) {
        tempCtx.drawImage(canvas, 0, 0);
      }

      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (tempCanvas.width > 0 && tempCanvas.height > 0) {
          ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width / dpr, tempCanvas.height / dpr);
        }
      }
    };

    const observer = new ResizeObserver(() => {
      resizeAndRestore(canvasRef.current);
      resizeAndRestore(questionsCanvasRef.current);
    });

    if (canvasRef.current?.parentElement) {
      observer.observe(canvasRef.current.parentElement);
    }
    if (questionsCanvasRef.current?.parentElement) {
      observer.observe(questionsCanvasRef.current.parentElement);
    }

    // Initial trigger
    resizeAndRestore(canvasRef.current);
    resizeAndRestore(questionsCanvasRef.current);

    return () => {
      observer.disconnect();
    };
  }, [isSubmitted, currentQ, loading]);

  // Restore or clear the right-side (question) canvas when switching questions
  useEffect(() => {
    const canvas = questionsCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      const savedData = questionDrawings.current[currentQ];
      if (savedData && ctx) {
        const img = new Image();
        img.onload = () => {
          const dpr = window.devicePixelRatio || 1;
          ctx.drawImage(img, 0, 0, canvas.width / dpr, canvas.height / dpr);
        };
        img.src = savedData;
      }
    }
  }, [currentQ]);

  // Derived state to determine which passage is active
  const activePassageIndex = processedArticle && articleData?.questions?.length
    ? Math.min(
        Math.floor(currentQ / Math.ceil(articleData.questions.length / processedArticle.length)),
        processedArticle.length - 1
      )
    : 0;

  // Restore or clear the left-side (article) canvas when switching passages
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      const savedData = passageDrawings.current[activePassageIndex];
      if (savedData && ctx) {
        const img = new Image();
        img.onload = () => {
          const dpr = window.devicePixelRatio || 1;
          ctx.drawImage(img, 0, 0, canvas.width / dpr, canvas.height / dpr);
        };
        img.src = savedData;
      }
    }
  }, [activePassageIndex]);


  const getCoords = (e: React.PointerEvent) => {
    const canvas = e.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Use ratio between internal resolution and CSS layout to neutralize stretching
    const scaleX = (canvas.width / dpr) / (rect.width || 1);
    const scaleY = (canvas.height / dpr) / (rect.height || 1);

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      pressure: e.pressure || 0.5,
      time: Date.now()
    };
  };

  const startDrawing = (e: React.PointerEvent) => {
    if (!isPenActive) return;
    const canvas = e.currentTarget as HTMLCanvasElement;
    const container = canvas.parentElement as HTMLDivElement;

    isDrawing.current = true;
    activeCanvas.current = canvas;
    activeContainer.current = container;

    const pt = getCoords(e);
    points.current = [pt];

    lastWidth.current = getPenWidth(pt.pressure, 0);

    const ctx = canvas.getContext('2d')!;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over';

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, lastWidth.current / 4, 0, Math.PI * 2);
    ctx.fillStyle = activeTool === 'eraser' ? 'rgba(0,0,0,1)' : penColor;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  };

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing.current || !activeCanvas.current || !activeContainer.current || !isPenActive) return;
    const canvas = activeCanvas.current;

    const pt = getCoords(e);

    if (activeTool === 'marker' && points.current.length > 0) {
      pt.y = points.current[0].y;
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

    // We draw segment by segment to allow dynamic width changing and avoid overlapping alpha dots (if any).
    // The previous startDrawing or draw iteration left the path positioned correctly via moveTo.
    ctx.lineTo(pt.x, pt.y);

    ctx.strokeStyle = activeTool === 'eraser' ? 'rgba(0,0,0,1)' : penColor;
    ctx.lineWidth = width;
    ctx.stroke();

    // Prepare for next segment
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);

    points.current.push(pt);
    lastWidth.current = width;
  };

  const stopDrawing = (e: React.PointerEvent) => {
    if (!isDrawing.current) return;

    // If it was just a quick tap without much movement, simulate a click
    // so the user can select an option even while the pen tool is active.
    if (points.current.length <= 2) {
      if (activeCanvas.current) {
        // Hide the canvas temporarily to allow `elementFromPoint` to grab the element underneath
        const originalPointerEvents = activeCanvas.current.style.pointerEvents;
        activeCanvas.current.style.pointerEvents = 'none';

        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (element instanceof HTMLElement) {
          // Find if the clicked element is a button and trigger its click
          const button = element.closest('button');
          if (button) {
            (button as HTMLElement).click();
          }
        }

        // Restore pointer events
        activeCanvas.current.style.pointerEvents = originalPointerEvents;
      }
    }

    // Save drawing state before resetting active canvas
    if (activeCanvas.current) {
      if (activeCanvas.current === canvasRef.current) {
        passageDrawings.current[activePassageIndex] = activeCanvas.current.toDataURL();
      } else if (activeCanvas.current === questionsCanvasRef.current) {
        questionDrawings.current[currentQ] = activeCanvas.current.toDataURL();
      }
      saveLocalState(answers, isSubmitted);
    }

    isDrawing.current = false;
    activeCanvas.current = null;
    activeContainer.current = null;
    points.current = [];
  };

  const clearCanvas = () => {
    [canvasRef, questionsCanvasRef].forEach(ref => {
      const canvas = ref.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
    // Clear in-memory stored drawings when user hits trash icon or switches articles
    passageDrawings.current = {};
    questionDrawings.current = {};
    saveLocalState(answers, isSubmitted);
  };

  const handleSelect = (idx: number) => {
    if (isSubmitted) return;
    const newAnswers = { ...answers, [currentQ]: idx };
    setAnswers(newAnswers);
    saveLocalState(newAnswers, isSubmitted);
  };

  const calculateScore = () => {
    let correct = 0;
    articleData.questions.forEach((q, i) => { if (answers[i] === q.answer) correct++; });
    return Math.round((correct / articleData.questions.length) * 100);
  };
  const reset = () => {
    setCurrentQ(0);
    setAnswers({});
    setIsSubmitted(false);
    if (selectedArticleId) {
      localStorage.removeItem(`reading_state_${selectedArticleId}`);
    }
    clearCanvas();
  };

  const saveWrongQuestionsForReading = () => {
    if (!articleData) return;
    articleData.questions.forEach((q, i) => {
      if (answers[i] !== q.answer) {
        
        let qArticle = articleData.article;
        if (processedArticle && articleData.questions.length > 0) {
           const passageIdx = Math.min(
             Math.floor(i / Math.ceil(articleData.questions.length / processedArticle.length)),
             processedArticle.length - 1
           );
           qArticle = processedArticle[passageIdx].paragraphs;
        }

        const payload = {
          id: `reading-${articleData.id}-${i}`,
          text: q.text,
          options: q.options,
          answer: q.answer,
          analysis: q.analysis,
          source: articleData.source,
          article: qArticle
        };
        saveWrongQuestion('reading', payload);
        saveWrongQuestionAPI(getDeviceId(), 'reading', payload).catch(console.error);
      }
    });
  };

  const handleSubmit = () => {
    setIsSubmitted(true);
    setShowSummary(true);
    saveWrongQuestionsForReading();
    saveLocalState(answers, true);
  };


  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F9F8F4]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="animate-spin text-[#b58362]" />
          <p className="text-sm text-[#8c8881] font-serif tracking-widest">
            正在加载...
          </p>
        </div>
      </div>
    );
  }

  // --- SELECTION SCREEN ---
  if (!selectedArticleId || !articleData) {
    return (
      <div className="flex-1 overflow-y-auto bg-[#F9F8F4] p-8 md:p-12 animate-fade-in">
        <div className="max-w-5xl mx-auto flex flex-col items-center">
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-[#b58362] mb-3 text-center">
            阅读理解真题全集
          </h2>
          <p className="text-gray-500 mb-12 text-center max-w-lg font-serif">
            请选择你要练习的试卷。由于解析详尽，建议在专注时刻进行全真模拟训练。
          </p>

          {articlesList.length === 0 ? (
            <div className="text-center p-12 bg-white rounded-3xl border border-dashed border-[#d4cbb8] w-full">
              <p className="text-gray-400 font-serif">题库空空如也，请先上传题目哦 ~</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
              {articlesList.map((article) => (
                <button
                  key={article.id}
                  onClick={() => handleSelectArticle(article.id)}
                  className="group relative bg-[#FDFCF9] w-full text-left p-8 rounded-3xl border border-[#efe8dd] hover:border-[#b58362]/40 transition-all duration-500 hover:shadow-xl hover:-translate-y-1 overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[#f8f1e7] to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-bl-full transform translate-x-12 -translate-y-12"></div>
                  
                  <div className="text-[10px] text-[#b58362] mb-4 tracking-[0.2em] font-serif font-bold uppercase inline-block bg-[#f8f1e7] px-3 py-1 rounded-full">
                    READING MODULE
                  </div>
                  <h3 className="text-xl font-serif font-bold text-gray-800 leading-snug group-hover:text-[#b58362] transition-colors mb-4 relative z-10">
                    {(() => {
                      const parts = article.source.split(' - ');
                      if (parts.length > 1) {
                        return (
                          <div className="flex flex-col gap-1.5">
                            <span>{parts[0]}</span>
                            <span className="text-sm font-medium text-gray-500 font-sans tracking-wide">{parts[1]}</span>
                          </div>
                        );
                      }
                      return article.source;
                    })()}
                  </h3>
                  <div className="flex items-center text-sm font-medium text-gray-400 group-hover:text-gray-600 transition-colors relative z-10">
                    <span className="flex-1">点击开始做题</span>
                    <span className="opacity-0 group-hover:opacity-100 transform translate-x-[-10px] group-hover:translate-x-0 transition-all duration-300">
                      →
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- READING UI ---
  const question = articleData.questions[currentQ];

  const activeParagraphs = processedArticle ? processedArticle[activePassageIndex].paragraphs : articleData.article;

  return (
    <div className="flex-1 flex flex-col landscape:flex-row animate-fade-in min-h-0 h-full bg-[#F9F8F4]">
      {/* Article Section Container */}
      <div className="flex-1 landscape:flex-[1.5] relative min-h-0 h-full border-b landscape:border-b-0 landscape:border-r border-dashed border-[#d4cbb8]">
        {/* Article Section with Paper Texture */}
        <div
          ref={articleRef}
          className={cn(
            "h-full overflow-y-auto px-6 landscape:px-12 md:px-16 pt-8 landscape:pt-12 pb-20 paper-texture bg-[#FDFCF9] overscroll-contain touch-auto",
            isPenActive ? "touch-none cursor-crosshair" : "touch-auto"
          )}
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <div className="relative w-full min-h-full">
            {/* Handwriting Canvas Overlay - Now covers full scrollable height */}
            <canvas
              ref={canvasRef}
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerOut={stopDrawing}
              className="absolute top-0 left-0 w-full h-full z-20"
              style={{
                pointerEvents: isPenActive ? 'auto' : 'none',
                mixBlendMode: 'multiply'
              }}
            />

            {/* Paper Decorative Lines */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-0" style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px)', backgroundSize: '100% 2.5rem' }}></div>

            {isSubmitted && (
              <div className="absolute top-0 right-0 animate-slide-up bg-white/90 backdrop-blur px-5 py-3 rounded-2xl shadow-sm text-center z-30 border border-gray-100 mt-4 mr-4 md:mt-0 md:mr-0">
                <div className="text-3xl font-serif text-[#b58362] font-bold">{calculateScore()}<span className="text-sm font-normal ml-0.5">分</span></div>
                <div className="text-[10px] text-gray-400 tracking-widest mt-1 uppercase">Final Score</div>
              </div>
            )}

            <div className="relative z-10">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3 md:mb-5 border-b border-[#b58362]/20 pb-4">
                <div className="flex flex-col">
                  <button 
                    onClick={handleBackToList}
                    className="text-xs text-gray-400 hover:text-[#b58362] flex items-center gap-1 transition-colors mb-2 w-fit"
                  >
                    ← 返回题库
                  </button>
                  <div className="text-xs md:text-sm text-[#b58362] tracking-[0.2em] font-serif font-bold uppercase inline-block">
                    {articleData.source || 'Reading Passage 01'}
                  </div>
                </div>
              </div>

              {/* Passage Tabs (auto-generated) */}
              {processedArticle && processedArticle.length > 1 && (
                <div className="flex gap-2 mb-6 md:mb-8 overflow-x-auto hide-scrollbar pb-2">
                  {processedArticle.map((passage, idx) => (
                    <div 
                      key={idx} 
                      className={cn(
                        "text-xs font-bold px-4 py-1.5 rounded-full border transition-all whitespace-nowrap",
                        activePassageIndex === idx 
                          ? "bg-[#b58362] text-white border-[#b58362] shadow-md" 
                          : "bg-white text-gray-400 border-gray-200 opacity-60"
                      )}
                    >
                      {passage.name}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-8 md:space-y-10">
                {activeParagraphs.map((p) => {
                  const isParaEvidence = isSubmitted && question?.evidenceId === p.id;
                  
                  return (
                    <p
                      key={p.id}
                      className={cn(
                        "text-lg md:text-2xl font-serif leading-[2] md:leading-[2.2] text-[#2d2d2d] transition-all duration-700 select-none",
                        isParaEvidence && !p.sentences ? 'bg-[#E3F2FD]/40 border-l-4 border-[#81D4FA] pl-4 py-1 rounded-r-lg' : ''
                      )}
                    >
                      {p.sentences ? (
                        p.sentences.map((sentence) => {
                          const isSentenceEvidence = isSubmitted && question?.evidenceId === sentence.id;
                          return (
                            <span 
                              key={sentence.id}
                              className={cn(
                                "transition-all duration-700 rounded-sm",
                                isSentenceEvidence ? 'bg-[#E3F2FD]/70 py-0.5 px-1 shadow-[0_0_0_2px_rgba(227,242,253,0.7)]' : ''
                              )}
                            >
                              {sentence.text}
                            </span>
                          );
                        })
                      ) : (
                        p.text
                      )}
                    </p>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Floating Pen Toolbar for Article - Fixed position in bottom-right of article container */}
        <div className="absolute bottom-6 right-6 z-40 flex items-center gap-2 bg-white/60 backdrop-blur-md p-1.5 rounded-2xl shadow-sm border border-gray-100">
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

                {/* Color Selection - Ultra Muted Colors */}
                <div className="flex items-center gap-1.5 px-0.5">
                  {[
                    { color: '#4A3E31', label: '默认' },
                    { color: '#E8DCC4', label: '沙色' },
                    { color: '#FADADD', label: '粉' },
                    { color: '#D1EAF0', label: '蓝' }
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
      </div>

      {/* Questions Section Container */}
      <div className="flex-1 relative min-h-0 h-full">
        {/* Questions Section */}
        <div
          ref={questionsRef}
          className="h-full relative flex flex-col px-6 landscape:px-8 md:px-10 py-8 landscape:py-12 shrink-0 bg-white shadow-[-20px_0_40px_rgba(0,0,0,0.02)] z-30 overflow-y-auto overscroll-contain touch-auto"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <div className="relative w-full min-h-full">
            {/* Handwriting Canvas Overlay for Questions */}
            <canvas
              ref={questionsCanvasRef}
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerOut={stopDrawing}
              className="absolute top-0 left-0 w-full h-full z-40"
              style={{
                pointerEvents: isPenActive ? 'auto' : 'none',
                mixBlendMode: 'multiply'
              }}
            />

            <div className="flex justify-between items-center mb-8 md:mb-12 shrink-0 relative z-30 pointer-events-none">
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-400 font-serif tracking-widest uppercase mb-1">Question</span>
                <span className="text-lg font-serif font-bold text-gray-800">{currentQ + 1} <span className="text-gray-300 font-normal mx-1">/</span> {articleData.questions.length}</span>
              </div>
            </div>

            <h4 className="text-lg md:text-xl font-serif font-medium text-gray-800 mb-8 md:mb-12 leading-relaxed shrink-0">
              {cleanQuestionText(question.text)}
            </h4>

            <div className="flex flex-col gap-4 md:gap-5 pb-6 shrink-0 relative z-30 pointer-events-auto">
              {question.options.map((opt, idx) => {
                const isSelected = answers[currentQ] === idx;
                const isCorrect = isSubmitted && question.answer === idx;
                const isWrongSelect = isSubmitted && isSelected && question.answer !== idx;

                let btnClass = "bg-gray-50 text-gray-700 border border-transparent hover:bg-gray-100";
                if (isSelected && !isSubmitted) btnClass = "bg-[#1a1a1a] text-white shadow-lg scale-[1.02]";
                if (isSubmitted) {
                  if (isCorrect) btnClass = "bg-[#f4f8f4] text-[#4a7c59] border border-[#e2efe2] shadow-sm";
                  else if (isWrongSelect) btnClass = "bg-[#fdf6f0] text-[#c98a6c] border border-[#fae5d3] shadow-sm";
                  else btnClass = "bg-transparent text-gray-300 border-transparent opacity-50";
                }
                return (
                  <button
                    key={idx}
                    data-option-index={idx}
                    onClick={() => handleSelect(idx)}
                    className={cn(
                      "p-5 md:p-6 rounded-2xl text-left text-sm md:text-lg transition-all duration-300 font-serif w-full",
                      btnClass
                    )}
                  >
                    <span className="mr-3 opacity-30 font-sans">{String.fromCharCode(65 + idx)}.</span>
                    {cleanOptionText(opt)}
                  </button>
                );
              })}
            </div>

            {isSubmitted && question.analysis && (() => {
                const rawAnalysis = question.analysis
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
                  .replace(/\n/g, "<br/>");
                
                const bonusSplit = rawAnalysis.split(/(?:<br\/>)*[·•]\s*举一反三小题[：:]\s*/);
                const mainAnalysisStr = bonusSplit[0];
                const bonusText = bonusSplit[1];

                const formattedMain = mainAnalysisStr
                  .replace(/(?:<br\/>)*【核心考点】(?:<br\/>)*/g, "")
                  // Options block parsing (Must run before headers to preserve <br\/>【 boundaries)
                  .replace(/(?:<br\/>)*[·•]?\s*(正确选项|错误选项)\s*([A-D](?:\.|选项)?\s*[^：:]+)[：:]\s*(?:(?:错误类型|错误原因)\s*【(.*?)】。?)?\s*([\s\S]*?(?=(?:<br\/>)*[·•]?\s*(?:正确选项|错误选项)\s*[A-D](?:\.|选项)|$|<br\/>【))/g, 
                    (match, type, optionText, errorType, explanation) => {
                      const isCorrect = type === '正确选项';
                      const typeColor = isCorrect ? '#4a7c59' : '#c98a6c';
                      const bgColor = isCorrect ? '#f2f7f4' : '#fcf5f1';
                      const borderColor = isCorrect ? '#d0e3d5' : '#fae5d3';
                      let explainHtml = explanation.replace(/^(?:<br\/>)+/, ''); 
                      
                      let html = `<div class="mt-5 mb-5 p-5 md:p-6 rounded-2xl border shadow-sm" style="background-color: ${bgColor}; border-color: ${borderColor}">`;
                      
                      html += `<div class="font-bold text-[16px] mb-3 leading-snug" style="color: ${typeColor}">`;
                      html += `<span>${type} </span><span class="text-gray-800 ml-1 font-bold">${optionText}</span>`;
                      html += `</div>`;
                      
                      if (errorType && !isCorrect) {
                         html += `<div class="mb-4 mt-1"><span class="inline-block bg-white text-[#c98a6c] text-[13px] font-bold px-3 py-1.5 rounded-[8px] border border-[#fae5d3] shadow-sm tracking-wide">🔖 错误类型：${errorType}</span></div>`;
                      }
                      
                      html += `<div class="text-gray-700 text-[14px] md:text-[15px] leading-[1.8]">${explainHtml}</div>`;
                      
                      html += `</div>`;
                      return html;
                  })
                  
                  // Custom Badges for headers (Redesigned for rich modern look)
                  .replace(/(?:<br\/>)*【标准答案】\s*([A-D])/g, '<div class="mt-4 mb-3 p-4 rounded-xl bg-gradient-to-r from-[#fdfbf6] to-[#f9f5ed] border border-[#f0e8d9] flex justify-between items-center shadow-sm"><div class="flex items-center gap-3"><span class="flex items-center justify-center w-8 h-8 rounded-full bg-[#b58362]/10 text-[#b58362]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></span><span class="font-serif text-[#8a6a55] text-[15px] font-bold tracking-widest">标准答案</span></div><span class="font-bold text-4xl text-[#b58362] font-serif">$1</span></div>')
                  .replace(/(?:<br\/>)*【题型考点】(?:<br\/>)*/g, '<div class="flex items-center gap-2 mt-8 mb-4 border-b border-[#e1d5cc]/30 pb-2"><div class="w-1.5 h-1.5 rounded-full bg-[#d8b7b7]"></div><span class="text-[#ad8787] text-[15px] font-bold font-serif tracking-widest">题型考点</span></div>')
                  .replace(/(?:<br\/>)*【题干\s*\/\s*定位句深度拆解】(?:<br\/>)*/g, '<div class="flex items-center gap-2 mt-8 mb-4 border-b border-[#e1d5cc]/30 pb-2"><div class="w-1.5 h-1.5 rounded-full bg-[#9bbacd]"></div><span class="text-[#7292a5] text-[15px] font-bold font-serif tracking-widest">深度拆解</span></div>')
                  .replace(/(?:<br\/>)*【选项全维度详细分析】(?:<br\/>)*/g, '<div class="flex items-center gap-2 mt-8 mb-4 border-b border-[#e1d5cc]/30 pb-2"><div class="w-1.5 h-1.5 rounded-full bg-[#aebcd6]"></div><span class="text-[#8495b2] text-[15px] font-bold font-serif tracking-widest">选项分析</span></div>')
                  .replace(/(?:<br\/>)*【高频易错点警示】(?:<br\/>)*/g, '<div class="mt-8 mb-4 bg-[#fffaf5] border-l-4 border-[#e5bca5] p-3 rounded-r-xl"><span class="text-[#c18663] text-[14px] font-bold flex items-center gap-2"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> 高频易错点警示</span></div>')
                  .replace(/(?:<br\/>)*【考点拓展\s*&\s*举一反三】(?:<br\/>)*/g, '<div class="mt-8 mb-5 overflow-hidden rounded-xl border border-[#d6e5d3]"><div class="bg-[#e9f2e7] px-4 py-2.5 border-b border-[#d6e5d3]"><span class="text-[#64855f] text-[14px] font-bold flex items-center gap-2"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg> 考点拓展 & 举一反三</span></div><div class="p-5 bg-[#fafcf9] text-[#485e44] leading-relaxed text-[15px]">') // The closing div is tricky here since we don't know where it ends easily with pure regex, but the parent container handles the overflow. Let's make it a full block instead.

                  // Highlight common structures 
                  .replace(/(?:<br\/>)*[·•]\s*核心逻辑[：:]/g, '<div class="mt-6 mb-2 text-[#8a6a55] font-bold flex items-center gap-2 bg-[#f9f5ed] w-fit px-3 py-1 rounded-md text-[13px]"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg> 核心逻辑</div>')
                  .replace(/(?:<br\/>)*[·•]\s*题干翻译[：:]/g, '<div class="mt-5 mb-1 text-gray-800 font-bold flex items-center gap-2"><span class="text-[14px] bg-gray-100 text-gray-500 w-6 h-6 rounded-full flex items-center justify-center">文</span> 题干翻译</div>')
                  .replace(/(?:<br\/>)*[·•]\s*原文定位句.*?[：:]/g, '<div class="mt-6 mb-1 text-gray-800 font-bold flex items-center gap-2"><span class="text-[14px] bg-[#e3f2fd] text-[#0288d1] w-6 h-6 rounded-full flex items-center justify-center">引</span> 原文定位句</div>')
                  .replace(/(?:<br\/>)*[·•]\s*定位句核心.*?[：:]/g, '<div class="mt-4 mb-1 text-gray-800 font-bold flex items-center gap-2"><span class="text-[14px] bg-[#fff5e6] text-[#e68a00] w-6 h-6 rounded-full flex items-center justify-center">析</span> 定位句核心信息梳理</div>')
                  
                  // strip all remaining bullet dots!
                  .replace(/(?:<br\/>)*[·•]\s*/g, '<div class="h-2"></div>') // Add a tiny bit of space instead of just removing
                  
                  // Circled numbers with hanging indent
                  .replace(/(?:<br\/>|；|;|\s)*([①②③④⑤⑥⑦⑧⑨⑩])(?:<br\/>|\s)*([\s\S]*?)(?=(?:<br\/>|；|;|\s)*[①②③④⑤⑥⑦⑧⑨⑩]|$|<br\/>\s*(?:[1-9]\.|·|•)|<div|<\/div>)/g, '<div class="flex items-start mt-4 mb-3 bg-[#fdfcf9] p-3 rounded-xl border border-[#f0e8d9]"><span class="text-[#b58362] font-bold mr-3 shrink-0 text-[16px] leading-snug">$1</span><div class="flex-1 text-gray-700 leading-relaxed">$2</div></div>')
                  
                  // Bullet lists 1. 2. 3. 
                  .replace(/(?:<br\/>)*\s*([1-9])\.(?:<br\/>|\s)+([\s\S]*?)(?=(?:<br\/>)*\s*[1-9]\.(?:<br\/>|\s)|$|<div|<\/div>)/g, '<div class="flex items-start mt-4 mb-2"><span class="inline-flex items-center justify-center bg-[#f0ede6] text-[#b58362] w-5 h-5 rounded-full text-[12px] font-bold mr-3 mt-1.5 shrink-0">$1</span><div class="flex-1 text-gray-700 leading-relaxed text-[15px]">$2</div></div>')
                  
                  // Generic brackets matching
                  .replace(/【(?!标准答案|题型考点|题干\s*\/\s*定位句深度拆解|选项全维度详细分析|高频易错点警示|考点拓展\s*&\s*举一反三)(.*?)】/g, '<span class="inline-block bg-[#f4f0ea] text-[#8c7a6b] text-[12px] font-bold border border-[#e6dfd5] px-2 py-0.5 rounded mx-1 mb-1 mt-1">$1</span>');

                return (
                  <div className="mb-8 shrink-0 relative z-30 pointer-events-auto bg-white p-6 md:p-8 rounded-3xl border border-[#efe8dd] shadow-[0_8px_30px_rgba(0,0,0,0.03)]">
                    <div 
                      className="text-sm md:text-[15px] text-gray-700 font-serif leading-[2.2] break-words"
                      dangerouslySetInnerHTML={{ __html: formattedMain }}
                    />
                    {bonusText && <InteractiveBonusQuestion text={bonusText} />}
                  </div>
                );
            })()}

            <div className="mt-auto pt-6 flex justify-between items-center shrink-0 border-t border-gray-50 relative z-30 pointer-events-auto">
              {/* Left: Prev */}
              <button
                onClick={() => currentQ > 0 && setCurrentQ(currentQ - 1)}
                className={cn(
                  "text-sm md:text-base font-medium transition-colors flex items-center gap-2",
                  currentQ > 0 ? 'text-gray-600 hover:text-black' : 'text-gray-200 pointer-events-none'
                )}
              >
                上一题
              </button>

              {/* Center */}
              {isSubmitted ? (
                <button
                  onClick={() => setShowSummary(true)}
                  className="text-sm md:text-base text-white font-bold px-5 py-2 rounded-full bg-[#b58362] hover:bg-[#9e6e4f] transition-colors shadow-sm"
                >
                  📋 答题总结
                </button>
              ) : (
                <div className="flex justify-center gap-2">
                  {articleData.questions.map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "w-1.5 h-1.5 rounded-full transition-all duration-300",
                        currentQ === i ? 'bg-[#b58362] w-4' : 'bg-gray-200'
                      )}
                    />
                  ))}
                </div>
              )}

              {/* Right: Next or Submit */}
              {!isSubmitted && currentQ === articleData.questions.length - 1 ? (
                <button
                  onClick={handleSubmit}
                  className="px-6 py-2.5 bg-[#1a1a1a] text-white text-sm md:text-base font-medium rounded-full shadow-xl hover:bg-black transition-all hover:scale-105 active:scale-95"
                >
                  提交批改
                </button>
              ) : (
                <button
                  onClick={() => currentQ < articleData.questions.length - 1 && setCurrentQ(currentQ + 1)}
                  className={cn(
                    "text-sm md:text-base font-medium transition-colors flex items-center gap-2",
                    currentQ < articleData.questions.length - 1 ? 'text-gray-600 hover:text-black' : 'text-gray-200 pointer-events-none'
                  )}
                >
                  下一题
                </button>
              )}
            </div>

            {/* Summary Modal */}
            {showSummary && (
              <div
                className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100]"
                onClick={() => setShowSummary(false)}
              >
                <div
                  className="bg-white rounded-3xl w-full max-w-md mx-4 overflow-hidden shadow-2xl"
                  onClick={e => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center">
                    <h3 className="text-xl font-bold text-gray-800">📋 答题总结</h3>
                    <div className="text-2xl font-serif text-[#b58362] font-bold">
                      {calculateScore()}<span className="text-sm font-normal ml-0.5">分</span>
                    </div>
                  </div>

                  {/* Grid of questions */}
                  <div className="p-6">
                    <div className="grid grid-cols-5 gap-3 mb-6">
                      {articleData.questions.map((q, idx) => {
                        const userAnswer = answers[idx];
                        const isCorrect = userAnswer === q.answer;
                        const hasAnswered = userAnswer !== undefined;
                        return (
                          <button
                            key={idx}
                            onClick={() => { setCurrentQ(idx); setShowSummary(false); }}
                            className={cn(
                              "aspect-square rounded-2xl flex flex-col items-center justify-center font-bold text-base transition-all hover:scale-105 shadow-sm border",
                              !hasAnswered
                                ? "bg-gray-50 text-gray-300 border-gray-100"
                                : isCorrect
                                  ? "bg-[#f2f7f4] text-[#4a7c59] border-[#d0e3d5]"
                                  : "bg-[#fcf5f1] text-[#c98a6c] border-[#fae5d3]"
                            )}
                          >
                            <span className="text-lg">{idx + 1}</span>
                            <span className="text-xs mt-0.5">{!hasAnswered ? '—' : isCorrect ? '✓' : '✗'}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Legend */}
                    <div className="flex items-center justify-center gap-6 text-xs text-gray-400">
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#f2f7f4] border border-[#d0e3d5] inline-block"></span>正确</span>
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#fcf5f1] border border-[#fae5d3] inline-block"></span>错误</span>
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-100 border border-gray-200 inline-block"></span>未作答</span>
                    </div>
                  </div>

                  <div className="px-6 pb-5 flex items-center justify-between">
                    <span className="text-xs text-gray-400">点击题号跳转查看解析</span>
                    <button
                      onClick={() => { setShowSummary(false); reset(); }}
                      className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-800 transition-colors"
                    >
                      <RefreshCw size={12} /> 重新测试
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
