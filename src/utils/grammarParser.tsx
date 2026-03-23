import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

// --- Nuonuo brand tokens (match home cover) ───────────────────────────────────
export const COLORS = {
  bg: '#F8F7F4', // warm parchment
  text: '#333230', // deep charcoal
  accent: '#A67C65', // caramel brown
  muted: '#99958F', // warm gray
  card: '#FFFFFF',
  cardInner: '#FFFFFF',
  border: '#E9E4DC',
};

export interface ExampleCardItem {
  type: 'letter' | 'raw' | 'paragraph';
  letter?: string;
  label?: string;
  dash?: string;
  en?: string;
  cn?: string;
  text?: string;
}

export function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function splitEnCn(text: string) {
  const t = text.trim();
  const cnIdx = t.search(/[\u4e00-\u9fa5]/);
  if (cnIdx < 0) return { en: t, cn: '' };
  return { en: t.slice(0, cnIdx).trim(), cn: t.slice(cnIdx).trim() };
}

export function isExampleSectionTitle(trimmed: string) {
  const t = trimmed.replace(/^>\s*/, '').trim();
  // Matches "例句", "基础例句", "3. 例句", "• 例句", "特指例句", "典型例句" etc.
  // Optional leading number/bullet, optional prefix (基础/典型/特指), then "例句", optional colon.
  // We allow trailing content if it starts with a space.
  return /^((\d+[\.\uFF0E\uFF61]\s*)|([-•*]\s*))?(典型|特指|基础)?例句[:：]?(\s+.*)?$/.test(t);
}

export function getExampleCardTitle(trimmed: string) {
  const t = trimmed.replace(/^>\s*/, '').trim();
  const m = t.match(/^((\d+[\.\uFF0E\uFF61]\s*)|([-•*]\s*))?((典型|特指|基础)?例句)[:：]?/);
  return m?.[4] || '例句';
}

export function isSectionStopLine(trimmed: string) {
  if (!trimmed) return false;
  const t = trimmed.replace(/^>\s*/, ''); // handle blockquote markers
  if (t.startsWith('#')) return true;
  // stop at next “note/rule” blocks
  return /^(核心用法|特殊情况|主要用法|具体用法|一般情况|用法说明|高频考点|核心注意|注意|提示|总结|规则|定义|用法|分类|注意事项|时态规则|回答方式|固定结构|用法详解|易混辨析|语法精讲|特别说明|扩展)[:：]/.test(t);
}

export function renderInlineStrong(text: string) {
  const re = /<strong\b[^>]*>([\s\S]*?)<\/strong>|\*\*([\s\S]*?)\*\*/gi;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(text)) !== null && guard++ < 2000) {
    const start = m.index;
    const end = re.lastIndex;
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
    const strongText = (m[1] ?? m[2] ?? '').toString();
    nodes.push(
      <strong key={`${start}_${end}`} className="font-bold" style={{ color: COLORS.accent }}>
        {strongText}
      </strong>,
    );
    lastIndex = end;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function parseExampleBodyLine(line: string): ExampleCardItem | null {
  const raw = line.trim();
  if (!raw) return null;

  // Handle bullets: -, •, *
  const cleaned = raw.replace(/^([-•*])\s*/, '').trim();

  const rawMatch = cleaned.match(/^原句[:：]\s*(.+)$/);
  if (rawMatch) {
    const { en, cn } = splitEnCn(rawMatch[1]);
    return { type: 'raw', en, cn };
  }

  // Lettered list: a. through z. 
  // (We use a-z now, but we'll check if it's likely an example)
  const letterMatch = cleaned.match(/^([a-z]|[A-Z])[\.\uFF0E\uFF61]\s*(.+)$/);
  if (letterMatch) {
    const letter = letterMatch[1].toLowerCase();
    const rest = letterMatch[2].trim();

    const colonIdx = rest.indexOf('：');
    let label = '';
    let after = rest;
    if (colonIdx >= 0) {
      label = rest.slice(0, colonIdx).trim();
      after = rest.slice(colonIdx + 1).trim();
    }

    let dash: string | undefined;
    const dashMatch = after.match(/^([—\-–−])\s*/);
    if (dashMatch) {
      dash = dashMatch[1];
      after = after.slice(dashMatch[0].length).trim();
    }

    const { en, cn } = splitEnCn(after);
    
    // Heuristic: If there's no English and it's just Chinese, it's probably a rule, not an example card item.
    // Except if it's very short, like a label.
    if (!/[A-Za-z]/.test(en) && cn.length > 5) return null;

    return { type: 'letter', letter, label, dash, en, cn };
  }

  const empMatch = cleaned.match(/^强调句[:：]\s*(.+)$/);
  if (empMatch) {
    const { en, cn } = splitEnCn(empMatch[1]);
    return { type: 'paragraph', text: `${en}${cn ? ' ' + cn : ''}` };
  }

  // Fallback: accept if contains English letters and not a stop section
  if (/[A-Za-z]/.test(cleaned) && !isSectionStopLine(cleaned)) {
    const { en, cn } = splitEnCn(cleaned);
    const text = `${en}${cn ? ' ' + cn : ''}`.trim();
    if (text) return { type: 'paragraph', text };
  }

  return null;
}

export function renderExampleCard(items: ExampleCardItem[], title?: string) {
  return (
    <div className="nn-example-card my-8" role="group" aria-label="例句卡片">
      <div className="nn-example-title">{title || '例句'}：</div>
      {items.map((it, idx) => {
        if (it.type === 'letter') {
          return (
            <div key={idx} className="nn-example-item">
              <span className="nn-example-letter">{it.letter}.</span>
              {it.label ? <span className="nn-example-label">{it.label}：</span> : null}
              {it.dash ? (
                <span style={{ color: COLORS.accent, fontWeight: 700, marginRight: 8 }}>
                  {it.dash}
                </span>
              ) : null}
              <span className="nn-example-en">
                <em>{renderInlineStrong(it.en || '')}</em>
              </span>
              {it.cn ? (
                <>
                  {' '}
                  <span className="nn-example-cn" style={{ display: 'inline-block' }}>
                    {renderInlineStrong(it.cn)}
                  </span>
                </>
              ) : null}
            </div>
          );
        }
        if (it.type === 'raw') {
          return (
            <div key={idx} className="nn-example-item">
              <span className="nn-example-label">原句：</span>
              <span className="nn-example-en">
                <em>{renderInlineStrong(it.en || '')}</em>
              </span>
              {it.cn ? <span className="nn-example-cn">{renderInlineStrong(it.cn)}</span> : null}
            </div>
          );
        }
        return (
          <p key={idx} className="nn-example-item" style={{ margin: '10px 0' }}>
            {renderInlineStrong(it.text || '')}
          </p>
        );
      })}
    </div>
  );
}

export function unescapeStrongEntities(markdown: string) {
  return markdown.replace(/&lt;\s*(\/?)\s*strong\s*&gt;/gi, '<$1strong>');
}

export function extractEmphasisItExamples(markdown: string) {
  const re = /(?:^|\r?\n)(基础例句|例句)[：:]?\s*\r?\n([\s\S]*?)(?=\r?\n#{1,3}\s|\r?\n$)/;
  const m = re.exec(markdown);
  if (!m) return null;

  const startIndex = m.index ?? 0;
  const fullMatch = m[0];
  const body = m[2] || '';
  const before = markdown.slice(0, startIndex);
  const after = markdown.slice(startIndex + fullMatch.length);

  const lines = body.split(/\r?\n/);
  const items: Array<
    | { type: 'raw'; en: string; cn: string }
    | { type: 'letter'; letter: string; label: string; en: string; cn: string }
  > = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const cleaned = t.replace(/^-+\s*/, '').replace(/^•\s*/, '').trim();
    if (!cleaned) continue;

    const rawMatch = cleaned.match(/^原句[:：]\s*(.+)$/);
    if (rawMatch) {
      const { en, cn } = splitEnCn(cleaned.replace(/^原句[:：]\s*/, ''));
      items.push({ type: 'raw', en, cn });
      continue;
    }

    const letterMatch = cleaned.match(/^([a-dA-D])\.\s*(.+)$/);
    if (letterMatch) {
      const letter = letterMatch[1].toLowerCase();
      const rest = letterMatch[2].trim();

      const colonIdx = rest.indexOf('：');
      let label = '';
      let afterColon = rest;
      if (colonIdx >= 0) {
        label = rest.slice(0, colonIdx).trim();
        afterColon = rest.slice(colonIdx + 1).trim();
      }

      const { en, cn } = splitEnCn(afterColon);
      items.push({ type: 'letter', letter, label, en, cn });
    }
  }

  if (!items.length) return null;
  return { before, after, items };
}

export function unwrapExampleBlockquotes(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const titleRe = /^\s*>\s*(例句：|例句:|例句|基础例句：|基础例句:|基础例句)\b/;
  const quoteStartRe = /^\s*>/;
  const out: string[] = [];
  let inExample = false;

  for (const line of lines) {
    if (!inExample) {
      if (titleRe.test(line)) {
        inExample = true;
        out.push(line.replace(/^\s*>\s?/, ''));
        continue;
      }
      out.push(line);
      continue;
    }

    if (quoteStartRe.test(line)) {
      out.push(line.replace(/^\s*>\s?/, ''));
    } else {
      inExample = false;
      out.push(line);
    }
  }

  return out.join('\n');
}

export function renderMarkdownWithExampleCards(markdown: string, components: any) {
  const lines = markdown.split(/\r?\n/);
  const segments: Array<{ type: 'md'; text: string } | { type: 'card'; items: ExampleCardItem[]; title?: string }> = [];
  let mdBuf: string[] = [];

  const flushMd = () => {
    if (!mdBuf.length) return;
    segments.push({ type: 'md', text: mdBuf.join('\n') });
    mdBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isExampleSectionTitle(trimmed)) {
      flushMd();
      const items: ExampleCardItem[] = [];
      const cardTitle = getExampleCardTitle(trimmed);

      const match = trimmed.replace(/^>\s*/, '').match(/^(.*)例句[:：]?\s*(.*)$/);
      const trailing = match?.[2]?.trim() || '';
      if (trailing) {
        const first = parseExampleBodyLine(trailing);
        if (first) items.push(first);
      }

      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === '') {
          i++;
          continue;
        }
        // If we hit ANOTHER title, break and start a new card (per user "separating" request)
        if (isExampleSectionTitle(t)) break; 
        
        // Stop if we hit a standard numbered point NOT starting with a letter example
        if (/^(\d+)[\.\uFF0E\uFF61]\s*/.test(t) && !/^([a-zA-Z])[\.\uFF0E\uFF61]\s*/.test(t)) break;
        if (/^结构[:：]/.test(t)) break;
        if (isSectionStopLine(t)) break;
        
        const item = parseExampleBodyLine(lines[i]);
        // If it starts with "(" like (验证: ...), it's a continuation of the previous example
        if (!item && items.length > 0 && t.startsWith('(')) {
           const last = items[items.length - 1];
           if (last.type === 'letter' || last.type === 'paragraph') {
              if (last.type === 'letter') last.cn = (last.cn || '') + ' ' + t;
              else last.text = (last.text || '') + ' ' + t;
              i++;
              continue;
           }
        }
        if (!item) break;
        items.push(item);
        i++;
      }
      segments.push({ type: 'card', items, title: cardTitle });
      i--; 
      continue;
    }
    mdBuf.push(lines[i]);
  }
  flushMd();

  return segments.map((seg, idx) => {
    if (seg.type === 'card') {
      return (
        <React.Fragment key={idx}>
          {renderExampleCard(seg.items, (seg as any).title)}
        </React.Fragment>
      );
    }
    return (
      <ReactMarkdown 
        key={idx} 
        remarkPlugins={[remarkGfm]} 
        rehypePlugins={[rehypeRaw]} 
        skipHtml={false} 
        components={{
          ...components,
          p: (props: any) => {
             // If caller already provided a p, use it, otherwise default
             if (components?.p) return components.p(props);
             return <p className="mb-4 text-[16px] leading-[1.8] text-[#544E48]">{props.children}</p>;
          },
          ul: (props: any) => <ul className="list-none space-y-3 mb-6">{props.children}</ul>,
          li: (props: any) => (
            <li className="flex items-start gap-3 text-[16px] leading-[1.8] text-[#544E48]">
              <span className="w-1.5 h-1.5 rounded-full mt-2.5 shrink-0" style={{ backgroundColor: COLORS.accent }}></span>
              <div>{props.children}</div>
            </li>
          ),
          strong: (props: any) => <strong className="font-bold underline decoration-[#E9E4DC] decoration-2 underline-offset-4" style={{ color: COLORS.accent }}>{props.children}</strong>
        }}
      >
        {seg.text}
      </ReactMarkdown>
    );
  });
}
