import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import GrammarModule from './components/GrammarModule';
import ReadingModule from './components/ReadingModule';
import ActivationGate from './components/ActivationGate';
import WrongQuestionsModule from './components/WrongQuestionsModule';
import PastPapersModule from './components/PastPapersModule';
import KnowledgeModule from './components/KnowledgeModule';
import { cn } from './components/UI';
import { ChevronLeft, ArrowRight, Sparkles, BookOpen, Target, RefreshCw } from 'lucide-react';
import { MobileGestures } from './components/MobileGestures';

type Tab = 'home' | 'grammar' | 'reading' | 'wrongQuestions' | 'pastPapers' | 'knowledge';

export default function App() {
  // Try environment variables first, then URL parameters as fallback
  const urlParams = new URLSearchParams(window.location.search);
  const appModeParam = urlParams.get('appMode');
  const appNameParam = urlParams.get('appName');

  const appMode = appModeParam || import.meta.env.VITE_APP_MODE || 'full';
  const appName = appNameParam || import.meta.env.VITE_APP_NAME || '糯糯专升本英语';

  console.log('Dual-App Debug:', { appMode, appName });

  useEffect(() => {
    document.title = appName;
  }, [appName]);

  // Always start at home to show the module choices (filtered by appMode)
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [grammarInitialView, setGrammarInitialView] = useState<'system' | 'practice' | 'knowledge'>('system');
  const [grammarInitialTopicId, setGrammarInitialTopicId] = useState<string | null>(null);

  const onSelect = (tab: Tab, initialView: 'system' | 'practice' | 'knowledge' = 'system') => {
    setActiveTab(tab);
    if (tab === 'grammar') {
      setGrammarInitialView(initialView);
    }
  };

  const getWrapperBg = () => {
    if (activeTab === 'home') return 'bg-[#F4F3ED]';
    if (activeTab === 'grammar') return 'bg-[#faf9f6]';
    if (activeTab === 'reading') return 'bg-[#f4f2ea]';
    if (activeTab === 'pastPapers') return 'bg-[#faf9f6]';
    if (activeTab === 'wrongQuestions') return 'bg-[#faf9f6]';
    if (activeTab === 'knowledge') return 'bg-[#faf9f6]';
    return 'bg-[#F4F3ED]';
  };

  return (
    <ActivationGate>
      <div className="flex justify-center items-start md:items-center bg-gray-100 h-[100dvh] font-sans text-gray-800 md:p-4 lg:p-8 overflow-hidden print:overflow-visible print:h-auto print:bg-white print:p-0">
        <div className={cn(
          "w-full md:max-w-4xl lg:max-w-5xl h-[100dvh] md:h-[90vh] md:rounded-[2.5rem] flex flex-col relative shadow-2xl transition-all duration-500 overflow-hidden print:overflow-visible print:h-auto print:max-w-none print:shadow-none print:rounded-none",
          getWrapperBg()
        )}>
          <MobileGestures 
            enabled={activeTab !== 'home'} 
            onSwipeRight={() => setActiveTab('home')} 
          />

          {activeTab !== 'home' && (
            <div className="h-16 flex items-center justify-between px-6 shrink-0 relative z-20 bg-inherit">
              <button
                onClick={() => setActiveTab('home')}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors"
              >
                <ChevronLeft size={24} className="text-gray-700" />
              </button>
              <div className="text-xs text-gray-400 tracking-widest font-serif pr-2">{appName}</div>
            </div>
          )}

          <div className="flex-1 relative flex flex-col min-h-0 overflow-y-auto hide-scrollbar print:overflow-visible print:block print:h-auto">
            <AnimatePresence mode="wait">
              {activeTab === 'home' && (
                <motion.div
                  key="home"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col flex-1 overflow-y-auto hide-scrollbar h-full"
                >
                  <HomeCover onSelect={onSelect} />
                </motion.div>
              )}
              {activeTab === 'grammar' && (
                <motion.div
                  key="grammar"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col"
                >
                  <GrammarModule 
                    initialView={grammarInitialView as 'system' | 'practice'} 
                    initialTopicId={grammarInitialTopicId}
                  />
                </motion.div>
              )}

              {activeTab === 'wrongQuestions' && (
                <motion.div
                  key="wrongQuestions"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col"
                >
                  <WrongQuestionsModule />
                </motion.div>
              )}
              {activeTab === 'knowledge' && (
                <motion.div
                  key="knowledge"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col"
                >
                  <KnowledgeModule onGoToPractice={(id) => {
                    // Try to map ki (knowledge id) to ti (topic id)
                    // Usually they match if they have the same number, e.g. k1 -> t1
                    const topicId = id.replace(/^k/, 't');
                    setGrammarInitialTopicId(topicId);
                    setGrammarInitialView('practice');
                    setActiveTab('grammar');
                  }} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </ActivationGate>
  );
}

function HomeCover({ onSelect }: { onSelect: (tab: Tab, initialView?: 'system' | 'practice') => void }) {
  const urlParams = new URLSearchParams(window.location.search);
  const appModeParam = urlParams.get('appMode');
  const appNameParam = urlParams.get('appName');

  const appName = appNameParam || import.meta.env.VITE_APP_NAME || '糯糯专升本英语';
  const appMode = appModeParam || import.meta.env.VITE_APP_MODE || 'full';

  return (
    <div className="flex flex-col bg-[#F4F3ED] min-h-full">
      {/* 顶部标题区 */}
      <div className="pt-8 sm:pt-12 md:pt-24 px-6 sm:px-8 md:px-14 pb-4 sm:pb-8 md:pb-12 text-center md:text-left shrink-0 landscape-compact-title">
        <p className="text-[#8c8881] text-xs tracking-widest mb-4 font-medium flex items-center justify-center md:justify-start gap-2">
          {appName} <span className="text-[10px] opacity-50">·</span> 英语备考
        </p>
        <div className="relative">
          <h1 className="text-[2rem] sm:text-[2.6rem] md:text-[3.5rem] leading-tight font-serif font-bold text-[#1f1e1d] tracking-widest">
            干净刷题
          </h1>
          <h1 className="text-[2rem] sm:text-[2.6rem] md:text-[3.5rem] leading-tight font-serif italic text-[#b58362] tracking-widest -mt-1 md:-mt-2 ml-1">
            专注备考
          </h1>
        </div>
      </div>

      {/* 菜单卡片区 */}
      <div className="px-4 sm:px-6 md:px-14 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5 md:gap-6 pb-8 sm:pb-12">
        {(appMode === 'full' || appMode === 'grammar') && (
          <div
            onClick={() => onSelect('knowledge')}
            className="bg-[#faf9f6] rounded-[2rem] p-8 pt-12 relative cursor-pointer hover:scale-[1.03] active:scale-[0.98] transition-all shadow-sm hover:shadow-xl border border-[#b58362]/10 group h-[240px] flex flex-col justify-end overflow-hidden"
          >
            <div className="absolute top-6 left-8 text-[#b58362]/40 text-[10px] tracking-widest font-mono font-bold">CORE 01</div>
            <div className="absolute top-8 right-8 text-[#b58362]/10 group-hover:text-[#b58362]/20 transition-colors">
              <BookOpen size={60} strokeWidth={1} />
            </div>
            <h2 className="text-[2.2rem] font-serif text-gray-800 mb-4 tracking-widest leading-tight z-10">
              语法<span className="text-[#b58362]">知识点</span>
            </h2>
            <div className="text-gray-400 text-xs leading-relaxed space-y-1 z-10 font-medium">
              <p>系统化体系 15 大类</p>
              <p>文字解析 深度研读</p>
            </div>
            <ArrowRight className="absolute right-7 bottom-7 text-[#b58362]/30 group-hover:text-[#b58362] transition-colors" strokeWidth={1.5} size={26} />
          </div>
        )}

        {(appMode === 'full' || appMode === 'grammar') && (
          <div
            onClick={() => onSelect('grammar', 'system')}
            className="bg-[#1a1a1a] rounded-[2rem] p-8 pt-12 relative cursor-pointer hover:scale-[1.03] active:scale-[0.98] transition-all shadow-2xl group h-[240px] flex flex-col justify-end overflow-hidden"
          >
             <div className="absolute top-6 left-8 text-[#7a7a7a] text-[10px] tracking-widest font-mono">CORE 02</div>
             <div className="absolute top-8 right-8 text-white/5 group-hover:text-white/10 transition-colors">
              <Target size={60} strokeWidth={1} />
            </div>
            <h2 className="text-[2.2rem] font-serif text-white mb-4 tracking-widest leading-tight z-10">
              语法<span style={{ textShadow: '1.5px 1.5px 0px rgba(181, 131, 98, 0.9)' }}>真题</span>
            </h2>
            <div className="text-[#999999] text-xs leading-relaxed space-y-1 z-10">
              <p>历年真题 考点拆解</p>
              <p>双向回顾 快速切题</p>
            </div>
            <ArrowRight className="absolute right-7 bottom-7 text-[#555] group-hover:text-white transition-colors" strokeWidth={1.5} size={26} />
          </div>
        )}

        {(appMode === 'full' || appMode === 'grammar') && (
          <div
            onClick={() => onSelect('wrongQuestions')}
            className="bg-[#FDF6F0] rounded-[2rem] p-8 pt-12 relative cursor-pointer hover:scale-[1.03] active:scale-[0.98] transition-all shadow-sm hover:shadow-xl border border-[#fae5d3] group h-[240px] flex flex-col justify-end overflow-hidden"
          >
            <div className="absolute top-6 left-8 text-[#c98a6c] text-[10px] tracking-widest font-mono font-bold">CORE 03</div>
            <div className="absolute top-8 right-8 text-[#c98a6c]/10 group-hover:text-[#c98a6c]/20 transition-colors">
              <RefreshCw size={60} strokeWidth={1} />
            </div>
            <h2 className="text-[2.2rem] font-serif text-gray-800 mb-4 tracking-widest leading-tight z-10">
              语法<span className="text-[#c98a6c]">复盘</span>
            </h2>
            <div className="text-[#8c8881] text-xs leading-relaxed space-y-1 z-10 font-medium">
              <p>知识点聚类 高级复印</p>
              <p>盲区锁定 深度归档</p>
            </div>
            <ArrowRight className="absolute right-7 bottom-7 text-[#c98a6c]/30 group-hover:text-[#c98a6c] transition-colors" strokeWidth={1.5} size={26} />
          </div>
        )}


      </div>

      <div className="pb-4 md:pb-8 text-center text-[10px] md:text-[11px] text-[#b3afaa] tracking-widest flex items-center justify-center gap-1.5 font-medium shrink-0">
        <Sparkles size={10} className="text-[#d4cbb8]" /> 真题全覆盖
      </div>
    </div>
  );
}
