import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, Loader2, ArrowRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { fetchKnowledgeTopics, fetchKnowledgeContent } from '../services/api';
import { twMerge } from 'tailwind-merge';
import {
  renderMarkdownWithExampleCards,
  unwrapExampleBlockquotes,
  unescapeStrongEntities,
  extractEmphasisItExamples,
  COLORS,
} from '../utils/grammarParser';

interface KnowledgeTopic {
  id: string;
  name: string;
  en_name: string;
  description: string;
  icon: string;
  chapter_no: number;
  category: string;
}

interface KnowledgeContent {
  id: string;
  name: string;
  content: string;
}

export default function KnowledgeModule({ onGoToPractice }: { onGoToPractice?: (topicId: string) => void }) {
  const [topics, setTopics] = useState<KnowledgeTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [content, setContent] = useState<KnowledgeContent | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    fetchKnowledgeTopics().then(data => {
      setTopics(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (activeTopicId) {
      setLoadingContent(true);
      fetchKnowledgeContent(activeTopicId).then(data => {
        setContent(data);
        setLoadingContent(false);
      });
    } else {
      setContent(null);
    }
  }, [activeTopicId]);

  const handleBackToList = () => {
    setActiveTopicId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: COLORS.bg }}>
        <Loader2 className="animate-spin" size={32} style={{ color: COLORS.accent }} />
      </div>
    );
  }

  // ── List View ────────────────────────────────────────────────────────────────
  if (!activeTopicId) {
    return (
      <div className="flex-1 flex flex-col md:overflow-y-auto hide-scrollbar min-h-0 h-full" style={{ background: COLORS.bg }}>
        <div className="px-6 md:px-10 pt-6 pb-16">

          {/* ── Page Header ── */}
          <div className="flex items-center mb-8">
            <h2
              className="text-[1.85rem] md:text-[2.1rem] font-serif font-bold tracking-widest flex items-center gap-3"
              style={{ color: COLORS.text }}
            >
              <span className="inline-block w-[5px] rounded-full shrink-0" style={{ height: '1.6rem', background: COLORS.accent }} />
              语法知识点
            </h2>
          </div>

          {/* ── Card Grid ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {topics.map((topic) => (
              <motion.div
                key={topic.id}
                whileHover={{ y: -2, boxShadow: '0 10px 30px rgba(51,50,48,0.08)' }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveTopicId(topic.id)}
                className="rounded-2xl cursor-pointer group flex flex-col justify-between min-h-[148px] transition-colors"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                  boxShadow: '0 2px 10px rgba(51,50,48,0.05)',
                  padding: '20px 22px 18px',
                }}
              >
                {/* Top row: chapter number only */}
                <div className="flex justify-end mb-3">
                  <span
                    className="text-[10px] font-mono font-bold tracking-tighter"
                    style={{ color: COLORS.muted }}
                  >
                    CH.{topic.chapter_no.toString().padStart(2, '0')}
                  </span>
                </div>

                {/* Main content */}
                <div>
                  {/* ↓ Chinese title — hero element */}
                  <h3
                    className="font-serif font-bold leading-tight mb-1 transition-colors"
                    style={{ fontSize: '1.25rem', color: COLORS.text, letterSpacing: '0.02em' }}
                  >
                    {topic.name}
                  </h3>

                  {/* English subtitle — smaller, muted */}
                  <p
                    className="font-mono uppercase truncate"
                    style={{ fontSize: '9px', letterSpacing: '0.15em', color: COLORS.muted, marginBottom: '6px' }}
                  >
                    {topic.en_name}
                  </p>

                  {/* Description */}
                  <p
                    className="line-clamp-2 leading-relaxed"
                    style={{ fontSize: '11px', color: COLORS.muted }}
                  >
                    {topic.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Detail View ──────────────────────────────────────────────────────────────
  const activeTopic = topics.find(t => t.id === activeTopicId);

  // Custom components for ReactMarkdown
  const MarkdownComponents = {
    h1: ({ children }: any) => (
      <h1
        className="text-3xl md:text-4xl font-serif font-bold mb-10 mt-4 tracking-tight pb-4"
        style={{ color: COLORS.text, borderBottom: `1px solid ${COLORS.border}` }}
      >
        {children}
      </h1>
    ),
    h2: ({ children }: any) => {
      const rawText = typeof children === 'string' ? children : String(children?.[0] || '');
      const match = rawText.match(/^([一二三四五六七八九十]+)、\s*(.*)$/);
      const numeral = match ? match[1] : null;
      const text = match ? match[2] : rawText;

      return (
        <div className="mt-12 mb-6 flex items-center">
          {numeral && (
            <span className="text-xl font-serif font-bold mr-3" style={{ color: COLORS.accent }}>
              {numeral}、
            </span>
          )}
          <h2 className="text-2xl font-serif font-bold" style={{ color: COLORS.text }}>
            {text}
          </h2>
          <div className="ml-4 flex-1 h-px" style={{ background: COLORS.border }} />
        </div>
      );
    },
    h3: ({ children }: any) => (
      <h3 className="text-xl font-serif font-bold mt-8 mb-4 tracking-wider" style={{ color: COLORS.text }}>
        {children}
      </h3>
    ),
    p: ({ children }: any) => {
      const text = typeof children === 'string' ? children : String(children?.[0] || '');
      const t = text.trim();

      // “基础例句”单独做成清晰的标签（让用户一眼知道下面是例句区）
      if (t.startsWith('基础例句')) {
        return (
          <div
            className="inline-flex items-center px-4 py-2 rounded-2xl mb-6 border border-[#fae5d3] bg-[#fdfaf6] text-[#b58362] font-semibold text-sm"
            style={{ boxShadow: '0 10px 24px rgba(181,131,98,0.08)' }}
          >
            基础例句
          </div>
        );
      }

      let additionalClasses = '';
      let additionalStyles: React.CSSProperties = {};

      // Only style the *title line* for "例句："/"核心注意：".
      // If the paragraph contains more than just the title (e.g. title + items in one paragraph),
      // styling the whole paragraph will make后续知识点看起来“跑进例句区块”。
      const isExampleTitleOnly = /^例句[：:]?$/.test(t);
      const isCoreTitleOnly = /^核心注意[：:]?$/.test(t);

      if (isExampleTitleOnly || isCoreTitleOnly) {
        additionalClasses = 'py-3 pl-4 pr-3 my-4 rounded-lg bg-[#A67C65]/10 italic font-medium';
        additionalStyles = { borderLeft: `3px solid ${COLORS.accent}` };
      }

      return (
        <p
          className={twMerge('text-[15px] leading-[1.75] mb-6 tracking-normal', additionalClasses)}
          style={{ ...additionalStyles, color: COLORS.text, whiteSpace: 'pre-wrap' }}
        >
          {children}
        </p>
      );
    },
    blockquote: ({ children }: any) => (
      (() => {
        const extractText = (node: any): string => {
          if (node == null) return '';
          if (typeof node === 'string') return node;
          if (Array.isArray(node)) return node.map(extractText).join('');
          if (typeof node === 'object' && node.props?.children) return extractText(node.props.children);
          return '';
        };

        return (
          <div
            className="my-8 pl-5 pr-4 py-4"
            style={{ borderLeft: `3px solid ${COLORS.accent}`, background: 'transparent' }}
          >
            <div className="text-[14px] leading-relaxed font-medium" style={{ color: COLORS.text }}>
              {children}
            </div>
          </div>
        );
      })()
    ),
    ul: ({ children }: any) => <div className="flex flex-col gap-3 my-8">{children}</div>,
    ol: ({ children }: any) => <div className="flex flex-col gap-3 my-8">{children}</div>,
    li: ({ children }: any) => {
      const extractText = (node: any): string => {
        if (node == null) return '';
        if (typeof node === 'string') return node;
        if (Array.isArray(node)) return node.map(extractText).join('');
        if (node.props?.children) return extractText(node.props.children);
        return '';
      };

      const text = extractText(children).trim();

      // 防止“空列表项”只渲染出圆点造成视觉干扰。
      // 只有当 li 本身没有任何 children（确实为空）时才隐藏点；
      // 否则可能是嵌套结构导致 extractText 为空，但其实仍有可见内容。
      const hasChildren =
        children != null && !(Array.isArray(children) && children.length === 0);
      if (!text && !hasChildren) {
        return (
          <div className="flex gap-4 items-start py-1" aria-hidden="true">
            <span
              className="w-1.5 h-1.5 rounded-full mt-[9px] shrink-0"
              style={{ background: COLORS.accent, opacity: 0 }}
            />
            <div className="flex-1" style={{ opacity: 0 }} />
          </div>
        );
      }

      // Check for alphabetical example sentences (a., b., c.)
      const alphabeticalExampleMatch = text.match(/^([a-zA-Z])[\.\uFF0E\uFF61]\s*(.+)$/);
      if (alphabeticalExampleMatch) {
        const letter = alphabeticalExampleMatch[1];
        const exampleContent = alphabeticalExampleMatch[2].trim();

        // Try to split into:
        //  - prefix: Chinese label before the first English letter (e.g. 强调主语：)
        //  - en: from first English letter until first Chinese character
        //  - cn: the rest Chinese part
        const enStart = exampleContent.search(/[A-Za-z]/);
        let prefix = '';
        let en = exampleContent;
        let cn = '';
        if (enStart >= 0) {
          prefix = exampleContent.slice(0, enStart).trim();
          const rest = exampleContent.slice(enStart);
          const cnIdx = rest.search(/[\u4e00-\u9fa5]/);
          if (cnIdx >= 0) {
            en = rest.slice(0, cnIdx).trim();
            cn = rest.slice(cnIdx).trim();
          } else {
            en = rest.trim();
          }
        }

        return (
          <div className="nn-example-item">
            <span className="nn-example-letter">{letter.toLowerCase()}.</span>
            {prefix ? <span className="nn-example-label">{prefix.replace(/[：:]+$/, '')}：</span> : null}
            <span className="nn-example-en"><em>{en}</em></span>
            {cn ? <span className="nn-example-cn">{cn}</span> : null}
          </div>
        );
      }

      // “原句：xxx”单独成块，避免和 a/b/c 例句混在一起
      const rawSentenceMatch = text.match(/^原句[:：]\s*(.+)$/);
      if (rawSentenceMatch) {
        const text = rawSentenceMatch[1].trim();
        const cnIdx = text.search(/[\u4e00-\u9fa5]/);
        const en = cnIdx >= 0 ? text.slice(0, cnIdx).trim() : text;
        const cn = cnIdx >= 0 ? text.slice(cnIdx).trim() : '';

        return (
          <div className="nn-example-item">
            <span className="nn-example-label">原句：</span>
            <span className="nn-example-en"><em>{en}</em></span>
            {cn ? <span className="nn-example-cn">{cn}</span> : null}
          </div>
        );
      }

      // Heuristic: Is it a "Collocation"? (Contains English followed by Chinese)
      // Matches "phrase [space] 中文" or "phrase / 中文" or "phrase : 中文"
      const collocationMatch = text.match(/^([a-zA-Z\s\(\)\/]+)\s+([\u4e00-\u9fa5].*)$/);

      if (collocationMatch) {
        return (
          <div className="flex flex-col md:flex-row md:items-baseline gap-2 md:gap-4 py-3 border-b last:border-0">
            <span className="font-semibold text-[15px] min-w-[140px]" style={{ color: COLORS.text }}>
              {collocationMatch[1].trim()}
            </span>
            <span className="text-[14px]" style={{ color: COLORS.muted }}>
              {collocationMatch[2].trim()}
            </span>
          </div>
        );
      }

      // Default: Standard List Item
      return (
        <div className="flex gap-4 items-start py-1">
          <span className="w-1.5 h-1.5 rounded-full mt-[9px] shrink-0" style={{ background: COLORS.accent }} />
          <div className="text-[15px] leading-relaxed flex-1" style={{ color: COLORS.text }}>
            {children}
          </div>
        </div>
        );
    },
    strong: ({ children }: any) => (
      <strong className="font-bold" style={{ color: COLORS.accent }}>
        {children}
      </strong>
    ),
    table: ({ children }: any) => (
      <div className="my-8 overflow-hidden rounded-2xl border transition-all duration-300 hover:shadow-md" style={{ borderColor: COLORS.border }}>
        <table className="w-full border-collapse text-left text-sm" style={{ background: COLORS.cardInner }}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead style={{ background: `${COLORS.accent}10` }}>
        {children}
      </thead>
    ),
    tbody: ({ children }: any) => (
      <tbody className="divide-y" style={{ borderColor: COLORS.border }}>
        {children}
      </tbody>
    ),
    tr: ({ children }: any) => (
      <tr className="transition-colors hover:bg-black/[0.01]">
        {children}
      </tr>
    ),
    th: ({ children }: any) => (
      <th className="px-5 py-4 font-serif font-bold text-[13px] uppercase tracking-wider" style={{ color: COLORS.text }}>
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="px-5 py-4 leading-relaxed" style={{ color: COLORS.text }}>
        {children}
      </td>
    ),
    code: ({ children }: any) => (
      <code
        className="px-2 py-0.5 rounded font-mono text-sm mx-1"
        style={{ background: '#F1EEEA', color: COLORS.text, border: `1px solid ${COLORS.border}` }}
      >
        {children}
      </code>
    ),
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden" style={{ background: COLORS.bg }}>

      {/* Detail Header */}
      <div
        className="px-6 md:px-10 py-4 flex items-center gap-4 border-b shrink-0 z-20"
        style={{
          borderColor: COLORS.border,
          background: 'rgba(248,247,244,0.88)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <button
          onClick={handleBackToList}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white border hover:bg-gray-50 transition-colors shrink-0 shadow-sm"
          style={{ borderColor: COLORS.border, color: COLORS.text }}
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex flex-col overflow-hidden">
          <h3 className="font-serif font-bold tracking-wide truncate" style={{ color: COLORS.text }}>
            {activeTopic?.name}
          </h3>
          <span className="font-mono uppercase truncate text-[9px] tracking-[0.15em]" style={{ color: COLORS.muted }}>
            {activeTopic?.en_name}
          </span>
        </div>
      </div>

      {/* Detail Content */}
      <div className="flex-1 overflow-y-auto px-6 md:px-10 pt-12 pb-32 hide-scrollbar scroll-smooth">
        <div className="max-w-[720px] mx-auto">
          {loadingContent ? (
            <div className="flex justify-center py-24">
              <Loader2 className="animate-spin" size={36} style={{ color: COLORS.accent }} />
            </div>
          ) : !content?.content ? (
            <div className="text-center py-20">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">🚧</div>
              <h4 className="text-2xl font-serif font-bold mb-2" style={{ color: COLORS.text }}>内容建设中</h4>
              <p className="max-w-sm mx-auto mb-10" style={{ color: COLORS.muted }}>该章节的详细笔记正在整理中，我们将尽快为你呈现更清晰、系统的考点梳理。</p>
              <button
                onClick={handleBackToList}
                className="px-8 py-3 rounded-xl text-sm font-bold text-white shadow-lg transition-all hover:scale-105 active:scale-95"
                style={{ background: COLORS.accent }}
              >
                返回目录
              </button>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="max-w-none"
              style={{ color: COLORS.text }}
            >
              <div className="knowledge-md">
                {renderMarkdownWithExampleCards(
                  unwrapExampleBlockquotes(
                    unescapeStrongEntities(content.content.replace(/^•\s/gm, '- ')),
                  ),
                  MarkdownComponents as any,
                )}
              </div>

              {/* Practice CTA Section - Styled as a distinct card */}
              <div
                className="mt-24 p-10 rounded-3xl flex flex-col items-center relative overflow-hidden"
                style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, boxShadow: '0 14px 40px rgba(51,50,48,0.08)' }}
              >
                <h4 className="text-2xl font-serif font-bold mb-3 text-center" style={{ color: COLORS.text }}>
                  掌握这个考点了吗？
                </h4>
                <p className="text-sm mb-10 text-center max-w-sm leading-relaxed" style={{ color: COLORS.muted }}>
                  看懂了不等于会做。点击下方按钮，立刻做题检验掌握程度。
                </p>
                
                <button
                  onClick={() => onGoToPractice && onGoToPractice(activeTopicId || '')}
                  className="w-full md:w-auto px-12 py-5 rounded-2xl font-bold flex items-center justify-center gap-3 text-white transition-all hover:brightness-105 active:scale-[0.98]"
                  style={{ background: COLORS.accent, boxShadow: '0 18px 30px rgba(166,124,101,0.25)' }}
                >
                  <span>开始专项真题练习</span>
                  <ArrowRight size={22} />
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
