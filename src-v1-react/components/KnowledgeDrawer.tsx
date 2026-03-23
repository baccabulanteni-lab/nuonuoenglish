import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, BookOpen, ExternalLink } from 'lucide-react';
import { KnowledgePoint } from '../constants';
import { cn } from './UI';

interface KnowledgeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  knowledge?: KnowledgePoint;
  onPractice?: (id: string) => void;
}

export default function KnowledgeDrawer({ isOpen, onClose, knowledge, onPractice }: KnowledgeDrawerProps) {
  if (!knowledge && isOpen) return null;

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
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[100]"
          />

          {/* Drawer */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 z-[101] bg-white rounded-t-[2.5rem] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden"
          >
            {/* Grab Handle */}
            <div className="w-full flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing" onClick={onClose}>
              <div className="w-12 h-1.5 bg-gray-200 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-8 py-4 border-b border-gray-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#fdfaf6] rounded-2xl flex items-center justify-center text-[#b58362]">
                  <BookOpen size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-serif font-bold text-gray-800">{knowledge?.title}</h3>
                  <p className="text-[10px] text-gray-400 uppercase tracking-widest font-mono">Knowledge Recall</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-8 py-8 md:px-12 scroll-smooth">
              <div className="prose prose-stone max-w-none">
                <div className="text-gray-600 leading-relaxed font-serif text-lg space-y-6 whitespace-pre-wrap">
                  {knowledge?.content}
                </div>
              </div>

              {/* Action Area */}
              {onPractice && (
                <div className="mt-12 mb-8 pt-8 border-t border-gray-50">
                  <button
                    onClick={() => {
                      onPractice(knowledge?.id || '');
                      onClose();
                    }}
                    className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-gray-800 transition-all shadow-lg shadow-gray-200 group"
                  >
                    <span>去练两手</span>
                    <ExternalLink size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                  </button>
                  <p className="text-center text-[10px] text-gray-400 mt-4 tracking-widest uppercase">Instant Practice • Zero Latency</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
