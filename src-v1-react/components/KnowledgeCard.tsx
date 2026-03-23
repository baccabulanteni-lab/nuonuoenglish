import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, BookOpen, Lightbulb } from 'lucide-react';
import { KnowledgePoint } from '../constants';
import { cn } from './UI';

interface KnowledgeCardProps {
  isOpen: boolean;
  onClose: () => void;
  data: KnowledgePoint | null;
}

export default function KnowledgeCard({ isOpen, onClose, data }: KnowledgeCardProps) {
  if (!data) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[60]"
          />

          {/* Bottom Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 bg-[#faf9f6] rounded-t-[2.5rem] shadow-[0_-8px_30px_rgba(0,0,0,0.15)] z-[70] max-h-[85vh] overflow-hidden flex flex-col"
          >
            {/* Header Handle */}
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mt-4 mb-2 shrink-0" />

            {/* Content Header */}
            <div className="px-8 pb-4 pt-2 flex justify-between items-start shrink-0 border-b border-gray-100/50">
              <div className="flex flex-col">
                <h2 className="text-2xl md:text-3xl font-serif font-bold text-gray-800 tracking-tight flex items-center gap-2">
                  <span className="text-[#b58362]">{data.title}</span>
                </h2>
                <span className="text-[10px] text-gray-400 font-mono tracking-[0.2em] uppercase mt-1">{data.enTitle}</span>
              </div>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100/50 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-8 py-6 hide-scrollbar space-y-8 pb-12">
              
              {/* Core Concept */}
              <section>
                <div className="bg-[#f0ede4] rounded-2xl p-6 border border-[#e5e1d5] relative overflow-hidden">
                  <BookOpen className="absolute -right-4 -bottom-4 w-24 h-24 text-black/[0.03] -rotate-12" />
                  <p className="text-[#5c544d] text-base md:text-lg leading-relaxed font-sans relative z-10">
                    {data.coreConcept}
                  </p>
                </div>
              </section>

              {/* Formula Section */}
              {data.formula && data.formula.length > 0 && (
                <section className="space-y-6">
                  {data.formula.map((f, i) => (
                    <div key={i} className="space-y-3">
                      <h3 className="text-sm font-bold text-[#b58362] tracking-wider uppercase flex items-center gap-2">
                        <div className="w-1 h-4 bg-[#b58362] rounded-full" />
                        {f.label}
                      </h3>
                      <div className="space-y-4 pl-3">
                        {f.items.map((item, j) => (
                          <div key={j} className="flex flex-col gap-1">
                            <span className="text-[11px] text-gray-400 font-medium">{item.condition}</span>
                            <div className="text-lg md:text-xl font-mono text-gray-700 bg-white/50 py-2 px-3 rounded-lg border border-gray-100 inline-block font-semibold">
                              {item.structure.split(/(\w+ \+ \w+ \+ \w+)/).map((part, idx) => (
                                <span key={idx} className={idx % 2 === 1 ? 'text-[#b58362]' : ''}>{part}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {/* Examples Section */}
              <section className="space-y-6">
                <h3 className="text-sm font-bold text-gray-400 tracking-wider uppercase flex items-center gap-2">
                  <div className="w-1 h-4 bg-gray-200 rounded-full" />
                  真题解析与例句
                </h3>
                <div className="space-y-6">
                  {data.examples.map((ex, i) => (
                    <div key={i} className="group">
                      <div className="text-lg md:text-xl font-serif text-gray-800 leading-snug group-hover:text-[#b58362] transition-colors">
                        {ex.en}
                      </div>
                      <div className="text-sm text-gray-400 mt-2 font-sans">{ex.cn}</div>
                      {ex.tips && (
                        <div className="mt-3 flex gap-2 items-start bg-orange-50/50 p-3 rounded-xl border border-orange-100/50">
                          <Lightbulb className="text-orange-400 shrink-0 mt-0.5" size={14} />
                          <p className="text-[13px] text-orange-700 leading-relaxed">
                            <span className="font-bold">考点点拨：</span>{ex.tips}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* CTA Button */}
              <section className="pt-4">
                <button 
                  onClick={onClose}
                  className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold text-lg shadow-lg shadow-gray-200 hover:bg-gray-800 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300"
                >
                  学懂了，去练几道真题 →
                </button>
              </section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
