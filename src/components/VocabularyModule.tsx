import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './UI';
import {
  Trash2,
  Check,
  RotateCcw,
  Wand2,
  Zap,
  Upload,
  Loader2,
  Plus,
  X,
  BookOpen,
  Search,
  List,
  Home,
  Volume2,
  VolumeX,
  Shuffle,
  Star,
  AlertCircle,
  CalendarDays,
} from 'lucide-react';
import { 
  resolveBookWordList,
  hasBuiltInVocabFile,
  getFallbackSampleList,
  type BookWordPreview,
} from '../data/vocabBookWords';
import { fetchBuiltInCorpusCached } from '../utils/vocabCorpusCache';
import { loadRawCorpusForBook } from '../utils/loadBookCorpus';
import { parseImportedVocabularyUnified } from '../utils/parseVocabLocal';
import { safeJsonParse } from '../utils/safeJsonParse';
import { getStudyCursor, setStudyCursor, clearStudyCursor } from '../utils/studyCursor';
import {
  markPlanBatchChallengeCompletedIfNeeded,
  getBookChallenge,
  findAnyCompletedBookIdOnDate,
  getPrimaryFocusBookId,
  isPrimaryFocusDailyPlanDoneToday,
  DAILY_CHALLENGE_EVENT,
} from '../utils/dailyChallenge';
import { getBeijingDateKey, getBeijingYesterdayKey } from '../utils/beijingDate';
import { 
  VOCAB_STATS_UPDATED_EVENT, 
  dispatchVocabStatsUpdated 
} from '../utils/vocabStatsEvents';
import { clearScanResumeStorage } from '../utils/scanResumeStorage';
import { canonicalCycleDayLabel } from '../utils/cycleDayLabel';
import type { DailyPlanWords } from '../utils/scanResumeSession';
import { useScanCorpusBootstrap } from '../hooks/useScanCorpusBootstrap';
import { useScanResumePersistence } from '../hooks/useScanResumePersistence';
import { useScanGestureCanvas } from '../hooks/useScanGestureCanvas';
import {
  markReviewCompleted,
  readReviewCompletion,
  type ReviewCompletionSummary,
} from '../utils/reviewCompletionStorage';
import {
  saveCycleReviewSession,
  readCycleReviewSession,
  clearCycleReviewSession,
} from '../utils/cycleReviewSessionStorage';
import { computeScanBatchBookPatch } from '../utils/mergeSessionWordsIntoBook';
import {
  recordTodayScanBatchCompleted,
  clampTodayScannedWordCount,
  clearTodayScanForBook,
} from '../utils/todayScanProgress';
import {
  prefetchSpeechVoices,
  cancelEnglishSpeech,
  startPronunciationLoop,
  pronounceWordPreferHuman,
  tryUnlockAudioPlayback,
} from '../utils/speakEnglishWord';
import {
  getPronunciationAccent,
  setPronunciationAccent,
  type EnglishAccent,
} from '../utils/pronunciationAccent';
import { getIdbItem, setIdbItem, removeIdbItem } from '../utils/idbStorage';
import {
  wordsToPlanTimeMin,
  displayWordLowerFirst,
  normalizeWordListSearch,
  isDailyPlanLocked,
  isUserCustomVocabBook,
  stripDuplicateLeadingPhoneticFromMeaning,
  estimateFirstPassNodesAndDays,
} from '../utils/vocabularyModuleHelpers';
import { buildBookLibraryCardStatsLines, type BookLibraryCardStatsLines } from '../utils/bookLibraryCardStats';
import {
  buildStudyQueueForPass,
  getEffectiveStudyPass,
  computeMasteryProgressPercent,
  countNotFullyMasteredFromCorpus,
} from '../utils/studyPassQueue';
import type { Word, WordStatus, ModuleMode } from '../types/vocabularyWord';
import { LearningHeatmap, LearningStatsOverview } from './VocabularyGrowthStatsPanels';
import { BookCycleSchedulePreview } from './BookCycleSchedulePreview';

export type { DailyPlanWords };



const DEFAULT_VOCAB: Word[] = [];

/** 从 localStorage 今日历史读已累计专注秒数，避免切换 Tab 新挂载实例用 0 覆盖当日 studyTime */
function readPersistedStudySecondsForToday(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem('vocab_stats');
    const parsed = safeJsonParse<{ history?: Record<string, { studyTime?: unknown }> } | null>(raw, null);
    const today = getBeijingDateKey();
    const t = parsed?.history?.[today]?.studyTime;
    if (typeof t === 'number' && Number.isFinite(t)) return Math.max(0, Math.floor(t));
  } catch {
    /* ignore */
  }
  return 0;
}

type ViewState = 'scanning' | 'finished';

interface VocabularyModuleProps {
  mode?: ModuleMode;
  onBookSelect?: (book: any) => void;
  currentDay?: number;
  /** 扫词完成页「回首页」等 */
  onRequestHome?: () => void;
  accent?: EnglishAccent;
  audioEnabled?: boolean;
  audioRepeatMode?: 'once' | 'loop';
}

/** 内置「我的书库」；各书 count 随 import 脚本与词表更新 */
type BuiltinCollectionBook = {
  id: string;
  title: string;
  count: number;
  progress: number;
  color: string;
  tag: string;
  blurb?: string;
};

const DEFAULT_COLLECTION_BOOKS: BuiltinCollectionBook[] = [
  { id: 'coll-4', title: '初中', count: 3223, progress: 0, color: '#7d8f7c', tag: '文件夹词表' },
  { id: 'coll-5', title: '高中', count: 6008, progress: 0, color: '#6b7b8c', tag: '文件夹词表' },
  { id: 'coll-2', title: '四级', count: 7508, progress: 0, color: '#a39e96', tag: '文件夹词表' },
  { id: 'coll-1', title: '六级', count: 5651, progress: 0, color: '#8c8881', tag: '文件夹词表' },
  { id: 'coll-3', title: '考研', count: 9602, progress: 0, color: '#2D3436', tag: '文件夹词表' },
  { id: 'coll-7', title: '托福', count: 13477, progress: 0, color: '#ca8a4b', tag: '文件夹词表' },
  { id: 'coll-6', title: 'SAT', count: 8887, progress: 0, color: '#5c4d6d', tag: '文件夹词表' },
  { id: 'coll-13', title: '雅思词根', count: 3611, progress: 0, color: '#5c6658', tag: '文件夹词表' },
  { id: 'coll-9', title: '四级单词官方', count: 3155, progress: 0, color: '#c4a574', tag: '文件夹词表' },
  { id: 'coll-11', title: '雅思真经', count: 3673, progress: 0, color: '#8b6914', tag: '文件夹词表' },
  { id: 'focus-2', title: '雅思538', count: 898, progress: 0, color: '#9c6644', tag: '文件夹词表' },
  { id: 'coll-8', title: '专升本', count: 3006, progress: 0, color: '#6d6875', tag: '文件夹词表' },
  { id: 'coll-10', title: '六级词汇官方', count: 5522, progress: 0, color: '#8b7355', tag: '文件夹词表' },
];

/** 书架：按学段分架；各架内顺序与 import 词包约定一致 */
const COLLECTION_SHELVES: {
  id: string;
  title: string;
  hint?: string;
  bookIds: string[];
}[] = [
  {
    id: 'shelf-junior',
    title: '初中',
    bookIds: ['coll-4'],
  },
  {
    id: 'shelf-senior',
    title: '高中',
    bookIds: ['coll-5'],
  },
  {
    id: 'shelf-university',
    title: '大学 · 四六级 / 专升本',
    bookIds: ['coll-2', 'coll-1', 'coll-9', 'coll-10', 'coll-8'],
  },
  {
    id: 'shelf-kaoyan',
    title: '考研',
    bookIds: ['coll-3'],
  },
  {
    id: 'shelf-abroad',
    title: '留学 · 托福 / SAT / 雅思',
    bookIds: ['coll-7', 'coll-6', 'coll-13', 'coll-11', 'focus-2'],
  },
];

type CollectionShelfTab = 'all' | 'junior' | 'senior' | 'university' | 'kaoyan' | 'abroad';

const COLLECTION_SHELF_TAB_SINGLE: Record<Exclude<CollectionShelfTab, 'all'>, string> = {
  junior: 'shelf-junior',
  senior: 'shelf-senior',
  university: 'shelf-university',
  kaoyan: 'shelf-kaoyan',
  abroad: 'shelf-abroad',
};

const COLLECTION_SHELF_BOOK_IDS = new Set(COLLECTION_SHELVES.flatMap((s) => s.bookIds));

function orderCollectionBooksForShelf<T extends { id: string }>(
  collectionBooks: T[],
  bookIds: string[]
): T[] {
  const map = new Map(collectionBooks.map((b) => [b.id, b]));
  return bookIds.map((id) => map.get(id)).filter((b): b is T => b != null);
}

function mergeCollectionWithDefaults(saved: unknown) {
  const list = Array.isArray(saved) ? saved : [];
  const defaultMap = new Map(DEFAULT_COLLECTION_BOOKS.map((b) => [b.id, b]));
  const usedDefaultIds = new Set<string>();
  const merged: BuiltinCollectionBook[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string') continue;
    const b = raw as BuiltinCollectionBook & Record<string, unknown>;
    const def = defaultMap.get(b.id);
    if (def) {
      usedDefaultIds.add(b.id);
      merged.push({
        ...def,
        ...b,
        id: b.id,
        count: def.count,
        title: def.title,
        blurb: def.blurb,
        tag: def.tag,
        color: def.color,
        ...('subtitle' in def && (def as { subtitle?: string }).subtitle !== undefined
          ? { subtitle: (def as { subtitle: string }).subtitle }
          : {}),
      } as any);
    } else {
      merged.push(b as BuiltinCollectionBook);
    }
  }
  for (const def of DEFAULT_COLLECTION_BOOKS) {
    if (!usedDefaultIds.has(def.id)) {
      merged.push({ ...def });
    }
  }
  const seen = new Set<string>();
  return merged.filter((b) => {
    if (b.id === 'focus-1' || b.id === 'coll-12') return false;
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
}

const BUILT_IN_BOOK_META = new Map<
  string,
  (typeof DEFAULT_COLLECTION_BOOKS)[number]
>([
  ...DEFAULT_COLLECTION_BOOKS.map((b) => [b.id, b] as const),
]);

type FocusBookRow = (typeof DEFAULT_COLLECTION_BOOKS)[number] & {
  words?: Word[];
  dailyPlanWords?: DailyPlanWords;
  /** 学习轮次，从 1 计 */
  studyPass?: number;
};

function patchBuiltInBookMeta(book: FocusBookRow): FocusBookRow {
  const def = BUILT_IN_BOOK_META.get(book.id);
  if (!def) return book;
  return {
    ...def,
    ...book,
    id: book.id,
    count: def.count,
    title: def.title,
    blurb: def.blurb,
    tag: def.tag,
    color: def.color,
    progress: typeof book.progress === 'number' ? book.progress : 0,
    ...('subtitle' in def && (def as { subtitle?: string }).subtitle !== undefined
      ? { subtitle: (def as { subtitle: string }).subtitle }
      : {}),
  } as FocusBookRow;
}

function mergeFocusWithDefaults(saved: unknown): FocusBookRow[] {
  const list = Array.isArray(saved) ? saved : [];
  const first = list.find((raw): raw is FocusBookRow => {
    if (raw == null || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string') {
      return false;
    }
    return true;
  });
  if (first) {
    const stillValid = BUILT_IN_BOOK_META.has(first.id) || isUserCustomVocabBook(first);
    if (stillValid) {
      return [patchBuiltInBookMeta(first)];
    }
  }
  return [];
}

/** 抽屉/弹层内与列表中的书会同时挂载，禁止使用同一 layoutId，否则共享布局会抖动、关闭难看 */
const SHEET_SPRING = { type: 'spring' as const, damping: 38, stiffness: 420, mass: 0.52 };

const Book = ({
  id,
  title,
  count,
  progress,
  color,
  size = 'md',
  isImport = false,
  isCustom = false,
  onClick,
  interactive = true,
  libraryStats,
}: any & { libraryStats?: BookLibraryCardStatsLines | null }) => {
  const isLarge = size === 'lg';
  
  return (
    <motion.div 
      layout={false}
      initial={false}
      whileHover={interactive ? { y: -6, scale: 1.02 } : undefined}
      whileTap={interactive ? { scale: 0.97 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      onClick={onClick}
      className={cn(
        'relative group transition-all',
        interactive && 'cursor-pointer',
        isLarge ? 'w-44 h-60 md:w-56 md:h-72' : 'w-32 h-44 md:w-40 md:h-56'
      )}
    >
      {/* Book Shadow */}
      <div className="absolute -bottom-4 left-4 right-4 h-4 bg-black/10 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      
      {/* Book Body */}
      <div 
        className={cn(
          "w-full h-full rounded-r-lg shadow-xl relative overflow-hidden flex flex-col justify-between p-4 md:p-6 border-l-4 border-black/10",
          isImport ? "bg-transparent border-2 border-dashed border-[#fae5d3]" : ""
        )}
        style={{ backgroundColor: isImport ? 'transparent' : color }}
      >
        {isImport ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#FDF6F0] flex items-center justify-center text-[#b58362]">
              <Plus size={24} />
            </div>
            <div>
              <p className="text-sm font-serif font-bold text-[#1f1e1d]">导入词库</p>
              <p className="text-[9px] text-[#8c8881] tracking-tighter uppercase mt-1">TXT / CSV · UTF-8</p>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h3 className={cn(
                "font-serif font-bold text-white leading-tight",
                isLarge ? "text-xl md:text-2xl" : "text-sm md:text-base"
              )}>{title}</h3>
              {isLarge && <p className="text-[10px] text-white/60 tracking-widest uppercase">Target Focus</p>}
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-end text-white/80">
                <span className="text-[10px] font-mono">{count} WORDS</span>
                <span className="text-[10px] font-bold">{progress}%</span>
              </div>
              
              {/* Progress Visualization: Obi (腰封) */}
              <div className="relative h-1.5 bg-black/20 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className="absolute top-0 left-0 h-full bg-white/60"
                />
              </div>

              {libraryStats && (
                <div
                  className={cn(
                    'pt-2 mt-1 border-t border-white/15 space-y-0.5 text-left leading-snug',
                    isLarge ? 'text-[9px] md:text-[10px]' : 'text-[7px] md:text-[8px]'
                  )}
                >
                  <p className="text-white/70">
                    <span className="text-white/45">最近</span> {libraryStats.last}
                  </p>
                  <p className="text-white/70">
                    <span className="text-white/45">连续</span> {libraryStats.streak}
                  </p>
                  <p className="text-white/70">
                    <span className="text-white/45">预计</span> {libraryStats.eta}
                  </p>
                </div>
              )}
            </div>

            {/* Bookmark (书签) - Only for high progress */}
            {progress > 0 && progress < 100 && (
              <div className="absolute top-0 right-4 w-3 h-8 bg-[#D4AF37] shadow-sm rounded-b-sm transform -translate-y-1 group-hover:translate-y-0 transition-transform" />
            )}
            
            {/* Completed Stamp */}
            {progress === 100 && (
              <div className="absolute top-4 right-4 w-8 h-8 rounded-full border-2 border-white/40 flex items-center justify-center">
                <Check size={14} className="text-white" />
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
};

/** 默写：细线圆圈内对号（禁用 Emoji） */
function DictationStatusCorrectIcon({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M8 12l2.5 2.5L16 9"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 默写：细线圆圈内叉号 */
function DictationStatusWrongIcon({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.35" />
      <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

const POS_PREFIX_RE =
  /^(n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.|pron\.|art\.|num\.|int\.)\s*/i;

function DictationMeaningRich({ text }: { text: string }) {
  const segments = text
    .split(/\s*;\s*|\s*；\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return <span className="text-[#a8a29a]">—</span>;
  }
  return (
    <div className="text-[13px] md:text-sm leading-relaxed text-[#3d3a36] font-sans">
      {segments.map((seg, i) => {
        const m = seg.match(POS_PREFIX_RE);
        const pos = m?.[1];
        const body = pos ? seg.slice(m![0].length).trim() : seg;
        return (
          <span key={i} className={i > 0 ? 'ml-1' : undefined}>
            {i > 0 ? <span className="text-[#d4d0ca] mx-1">;</span> : null}
            {pos ? (
              <>
                <span className="text-[#7d9a76] font-medium italic">{pos}</span>
                <span className="text-[#3d3a36]"> {body}</span>
              </>
            ) : (
              <span>{seg}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default function VocabularyModule({
  mode: initialMode = 'scan',
  onBookSelect,
  currentDay = 1,
  onRequestHome,
  accent: propAccent,
  audioEnabled,
  audioRepeatMode,
}: VocabularyModuleProps) {
  const [activeMode, setActiveMode] = useState<ModuleMode>(initialMode as ModuleMode);
  const [viewState, setViewState] = useState<ViewState>('scanning');
  const [scanSessionTrigger, setScanSessionTrigger] = useState(0);
  const [scanFinishedReason, setScanFinishedReason] = useState<'batch' | 'dailyPlanDone' | null>(null);
  
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [focusBooks, setFocusBooks] = useState<FocusBookRow[]>([]);
  const [plan, setPlan] = useState({ time: 30, words: 150, day: 1 });
  const [reviewTargetWordIds, setReviewTargetWordIds] = useState<Set<string> | null>(null);
  const [reviewBatchHint, setReviewBatchHint] = useState<string | null>(null);
  const [storageRefreshTick, setStorageRefreshTick] = useState(0);

  useEffect(() => {
    const trigger = () => {
      console.log('[Sync] VocabularyModule 监听到同步事件，正在刷新本地存储状态...');
      setStorageRefreshTick(t => t + 1);
    };
    window.addEventListener(DAILY_CHALLENGE_EVENT, trigger);
    window.addEventListener('vocab-pull-synced', trigger);
    return () => {
      window.removeEventListener(DAILY_CHALLENGE_EVENT, trigger);
      window.removeEventListener('vocab-pull-synced', trigger);
    };
  }, []);

  useEffect(() => {
    async function loadStorage() {
      // 1. Plan
      const savedPlan = localStorage.getItem('vocab_plan');
      setPlan(safeJsonParse(savedPlan, { time: 30, words: 150, day: 1 }));

      // 2. Custom Books (Migrate from localStorage to IDB if needed)
      let custom = await getIdbItem<any[]>('vocab_custom_books');
      if (!custom) {
        const oldCustom = localStorage.getItem('vocab_custom_books');
        if (oldCustom) {
          custom = safeJsonParse(oldCustom, []);
          await setIdbItem('vocab_custom_books', custom);
          localStorage.removeItem('vocab_custom_books'); // free space
        } else {
          custom = [];
        }
      }
      setCustomBooks(custom);

      // 3. Collection Books
      const parsedColl = safeJsonParse(localStorage.getItem('vocab_collection_books'), []);
      setCollectionBooks(mergeCollectionWithDefaults(parsedColl));

      // 4. Focus Books (Migrate from localStorage to IDB)
      let focus = await getIdbItem('vocab_focus_books');
      if (!focus) {
        const oldFocus = localStorage.getItem('vocab_focus_books');
        if (oldFocus) {
          focus = safeJsonParse(oldFocus, null);
          await setIdbItem('vocab_focus_books', focus);
          localStorage.removeItem('vocab_focus_books'); // free space
        }
      }
      let result = mergeFocusWithDefaults(focus);
      if (result.length === 1 && Array.isArray(result[0].words) && result[0].words.length === 10 && result[0].words.some((w: any) => w?.id === 'w1' && w?.word === 'Minimalism')) {
        result = [{ ...result[0], words: [], progress: 0, studyPass: 1 }];
      }
      setFocusBooks(result);

      setIsStorageReady(true);
    }
    loadStorage();
  }, [storageRefreshTick]);

  // Async sync for books to IDB safely avoiding the 5MB limit
  useEffect(() => {
    if (isStorageReady) {
      setIdbItem('vocab_focus_books', focusBooks).catch(console.error);
    }
  }, [focusBooks, isStorageReady]);

  // 兜底：若主攻书仍在但 dailyPlanWords 丢失，自动从本地计划回填，避免误提示“请重新选书/选档位”。
  useEffect(() => {
    const fb = focusBooks[0];
    if (!fb) return;
    if (fb.dailyPlanWords === 150 || fb.dailyPlanWords === 300 || fb.dailyPlanWords === 1000) return;
    const pw = plan.words;
    if (pw !== 150 && pw !== 300 && pw !== 1000) return;
    const next = focusBooks.map((b, i) => (i === 0 ? ({ ...b, dailyPlanWords: pw } as FocusBookRow) : b));
    setFocusBooks(next);
  }, [focusBooks, plan.words]);

  const [vocabList, setVocabList] = useState<Word[]>([]);
  /** 词库拉取的「今日一批」扫词，避免被默认 DEFAULT_VOCAB 逻辑覆盖 */
  const [corpusBatch, setCorpusBatch] = useState<Word[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  /** 渲染期兜底：索引偶发大于列表长度时仍指向合法词，避免「有批次数却无大字」一帧闪空 */
  const safeVocabIndex = useMemo(() => {
    if (vocabList.length === 0) return 0;
    return Math.min(Math.max(0, currentIndex), vocabList.length - 1);
  }, [vocabList, currentIndex]);
  /** 须早于任意依赖它的 useEffect，避免 TDZ：`Cannot access 'scanCorpusPending' before initialization` */
  const currentWord = vocabList[safeVocabIndex];
  const scanCorpusPending =
    activeMode === 'scan' && viewState === 'scanning' && corpusBatch === null;
  /** 本批开始时的 getStudyCursor(bookId)，续学快照校验用 */
  const sessionStartCursorRef = useRef(0);
  /** 本批 corpus 是「续学恢复」还是「新拉一批」：避免 corpus 同步 effect 在 React Strict 下跑两次时第二次把 currentIndex 误清零 */
  const corpusLoadIntentRef = useRef<'resume' | 'fresh' | null>(null);
  const pendingResumeIndexRef = useRef<number | null>(null);
  /** 仅在实际「换主攻书」时清空 batch/续学；挂载/切 tab 不算换书，否则会在 useLayoutEffect 续学之后被本 effect 清掉 */
  const prevFocusBookIdForResumeRef = useRef<string | undefined>(undefined);

  // --- Dictation Mode Full List Logic ---
  const [dictationFullList, setDictationFullList] = useState<Word[]>([]);
  const [isDictationLoading, setIsDictationLoading] = useState(false);

  // 单词默写状态 [DICTATION] — 须在 orderedDictationList 等逻辑之上，避免 TDZ
  const [dictationInputs, setDictationInputs] = useState<Record<string, string>>({});
  const [dictationShowResults, setDictationShowResults] = useState<Record<string, boolean>>({});
  const [dictationHideChinese, setDictationHideChinese] = useState(false);
  const [dictationInWriteMode, setDictationInWriteMode] = useState(false);
  const [dictationLocalPronunciation, setDictationLocalPronunciation] = useState(true);
  const [dictationShuffleOn, setDictationShuffleOn] = useState(false);
  const [dictationShufflePerm, setDictationShufflePerm] = useState<number[]>([]);
  const [dictationMeaningRevealed, setDictationMeaningRevealed] = useState<Record<string, boolean>>({});
  const [dictationPeekWord, setDictationPeekWord] = useState<string | null>(null);
  const [dictationHints, setDictationHints] = useState<Record<string, number>>({});
  const [dictationRowAttempted, setDictationRowAttempted] = useState<Record<string, boolean>>({});
  const dictationPeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dictationBookIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (activeMode !== 'dictation') return;
    const fb = focusBooks[0];
    if (!fb?.id) return;

    // If we already have the list and it matches the current book, don't re-fetch
    if (dictationFullList.length > 0 && dictationFullList[0].bookId === fb.id) return;

    let cancelled = false;
    const loadFull = async () => {
      setIsDictationLoading(true);
      try {
        const raw = await loadRawCorpusForBook(fb);
        if (cancelled) return;
        
        // Convert BookWordPreview to Word structure for dictation usage
        const words: Word[] = raw.map(p => ({
          id: p.id,
          word: p.word,
          meaning: p.meaning,
          phonetic: p.phonetic,
          bookId: fb.id, // helpful to track source
          status: 'new'
        }));
        
        setDictationFullList(words);
      } catch (err) {
        console.error('[Dictation] Failed to load full corpus:', err);
      } finally {
        if (!cancelled) setIsDictationLoading(false);
      }
    };

    void loadFull();
    return () => { cancelled = true; };
  }, [activeMode, focusBooks[0]?.id]);
  // --------------------------------------

  const orderedDictationList = useMemo(() => {
    if (
      dictationShuffleOn &&
      dictationShufflePerm.length === dictationFullList.length &&
      dictationFullList.length > 0
    ) {
      return dictationShufflePerm.map((i) => dictationFullList[i]);
    }
    return dictationFullList;
  }, [dictationFullList, dictationShuffleOn, dictationShufflePerm]);

  useEffect(() => {
    if (activeMode !== 'dictation') return;
    const bid = focusBooks[0]?.id;
    if (dictationBookIdRef.current === bid) return;
    dictationBookIdRef.current = bid;
    setDictationInputs({});
    setDictationShowResults({});
    setDictationRowAttempted({});
    setDictationMeaningRevealed({});
    setDictationHints({});
    setDictationPeekWord(null);
    setDictationShuffleOn(false);
    setDictationShufflePerm([]);
    if (dictationPeekTimerRef.current) {
      clearTimeout(dictationPeekTimerRef.current);
      dictationPeekTimerRef.current = null;
    }
  }, [activeMode, focusBooks[0]?.id]);

  useEffect(() => {
    return () => {
      if (dictationPeekTimerRef.current) clearTimeout(dictationPeekTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (activeMode !== 'dictation') return;
    setDictationMeaningRevealed({});
  }, [activeMode, dictationHideChinese]);

  useEffect(() => {
    const id = focusBooks[0]?.id;
    if (prevFocusBookIdForResumeRef.current !== undefined && prevFocusBookIdForResumeRef.current !== id) {
      setCorpusBatch(null);
      clearScanResumeStorage();
    }
    prevFocusBookIdForResumeRef.current = id;
  }, [focusBooks[0]?.id]);

  useEffect(() => {
    prefetchSpeechVoices();
    const syn = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!syn) return;
    const onVoices = () => prefetchSpeechVoices();
    syn.addEventListener('voiceschanged', onVoices);
    return () => syn.removeEventListener('voiceschanged', onVoices);
  }, []);

  useEffect(() => {
    const w = focusBooks[0]?.dailyPlanWords;
    if (w === 150 || w === 300 || w === 1000) {
      setPlan((prev) => ({ ...prev, words: w, time: wordsToPlanTimeMin(w) }));
    }
  }, [focusBooks[0]?.id, focusBooks[0]?.dailyPlanWords]);

  useEffect(() => {
    if (activeMode !== 'review') {
      setReviewTargetWordIds(null);
      setReviewBatchHint(null);
      return;
    }

    const book = focusBooks[0];
    if (!book?.id) {
      setReviewTargetWordIds(new Set());
      setReviewBatchHint(null);
      return;
    }

    const daily =
      book.dailyPlanWords === 150 || book.dailyPlanWords === 300 || book.dailyPlanWords === 1000
        ? book.dailyPlanWords
        : plan.words;
    if (daily !== 150 && daily !== 300 && daily !== 1000) {
      setReviewTargetWordIds(new Set());
      setReviewBatchHint(null);
      return;
    }

    let cancelled = false;

    const loadReviewTargets = async () => {
      try {
        const raw = await loadRawCorpusForBook(book);
        if (cancelled) return;

        const pass = getEffectiveStudyPass(book);
        const queue = buildStudyQueueForPass(raw, book.words, pass, book.id);
        const cursor = getStudyCursor(book.id);
        const lastLearnedBatchIndex = Math.max(0, Math.floor((Math.max(cursor, 1) - 1) / daily));

        let batchIndexes: number[] = [];
        if (currentDay === 2) {
          batchIndexes = [lastLearnedBatchIndex % 2 === 0 ? lastLearnedBatchIndex : Math.max(0, lastLearnedBatchIndex - 1)];
        } else if (currentDay === 4) {
          batchIndexes = [lastLearnedBatchIndex % 2 === 1 ? lastLearnedBatchIndex : Math.max(0, lastLearnedBatchIndex - 1)];
        } else if (currentDay === 5) {
          const nodeBase = Math.floor(lastLearnedBatchIndex / 2) * 2;
          batchIndexes = [nodeBase, nodeBase + 1];
        }

        const ids = new Set<string>();
        for (const batchIndex of batchIndexes) {
          const start = batchIndex * daily;
          const slice = queue.slice(start, start + daily);
          for (const item of slice) ids.add(item.id);
        }
        setReviewTargetWordIds(ids);
        const batchLabel = (bi: number) => `${bi}（${bi % 2 === 0 ? 'A 槽·Day1' : 'B 槽·Day3'}）`;
        const batchesText = batchIndexes.length ? batchIndexes.map(batchLabel).join(' + ') : '—';
        setReviewBatchHint(`第 ${pass} 轮 · 批次 ${batchesText} · ${daily} 词/批 · 本次 ${ids.size} 词`);
      } catch {
        if (!cancelled) {
          setReviewTargetWordIds(new Set());
          setReviewBatchHint(null);
        }
      }
    };

    void loadReviewTargets();
    return () => {
      cancelled = true;
    };
  }, [activeMode, currentDay, focusBooks, plan.words]);

  // Filter words based on day and mode
  useEffect(() => {
    // 默写 / 词书库 / 统计 不走扫词画布：切勿把 focusBooks.words 写入 vocabList，
    // 否则全屏 canvas 会因 vocabList.length>0 变为不透明，盖住默写界面（表现为灰白空屏）。
    if (activeMode === 'dictation' || activeMode === 'library' || activeMode === 'stats') {
      setVocabList([]);
      setCurrentIndex(0);
      return;
    }

    if (
      corpusBatch !== null &&
      corpusBatch.length > 0 &&
      activeMode === 'scan' &&
      viewState === 'scanning'
    ) {
      const dayTag = `Day ${currentDay}`;
      if (corpusBatch.some((w) => canonicalCycleDayLabel(w.addedOn) == null)) {
        const patched = corpusBatch.map((w) => ({
          ...w,
          addedOn: canonicalCycleDayLabel(w.addedOn) ?? dayTag,
        }));
        setCorpusBatch(patched);
        return;
      }
      const filtered = corpusBatch.filter((w) => canonicalCycleDayLabel(w.addedOn) === dayTag);
      // 严格按当前循环日对齐：若批次与当前日不一致，清空旧批并让 bootstrap 重新加载，避免串到 Day3 词。
      if (filtered.length === 0) {
        setCorpusBatch(null);
        setVocabList([]);
        setCurrentIndex(0);
        return;
      }
      const list = filtered;
      const intent = corpusLoadIntentRef.current;
      if (intent === 'resume') {
        corpusLoadIntentRef.current = null;
        const pi = pendingResumeIndexRef.current;
        pendingResumeIndexRef.current = null;
        setVocabList(list);
        const target = pi != null ? pi : 0;
        setCurrentIndex(Math.min(Math.max(0, target), Math.max(0, list.length - 1)));
        return;
      }
      if (intent === 'fresh') {
        corpusLoadIntentRef.current = null;
        setVocabList(list);
        setCurrentIndex(0);
        return;
      }
      setVocabList(list);
      setCurrentIndex((i) => Math.min(i, Math.max(0, list.length - 1)));
      return;
    }

    const baseList = focusBooks[0]?.words || [];
    let filtered = [...baseList];
    
    if (activeMode === 'scan') {
      filtered = filtered.filter(w => w.addedOn === `Day ${currentDay}`);
    } else if (activeMode === 'review') {
      // 优先使用“本循环日应复习的批次 id 集合”，避免 Day 标签在不同轮次/Part 之间复用导致混批。
      // reviewTargetWordIds 由 buildStudyQueueForPass + 游标切片得出，天然与当前轮次(pass)对齐。
      if (reviewTargetWordIds) {
        filtered = filtered.filter((w) => reviewTargetWordIds.has(w.id));
      } else {
      if (currentDay === 1 || currentDay === 3) {
        filtered = [];
      } else if (currentDay === 2) {
        filtered = filtered.filter(w => w.addedOn === 'Day 1');
      } else if (currentDay === 4) {
        filtered = filtered.filter(w => w.addedOn === 'Day 3');
      } else if (currentDay === 5) {
        filtered = filtered.filter(w => w.addedOn === 'Day 1' || w.addedOn === 'Day 3');
      } else {
        filtered = [];
      }
      }
      // 循环复习仅回看「未全熟」：全熟（familiar_100）不再出现
      filtered = filtered.filter((w) => (w.status ?? 'new') !== 'familiar_100');
    }

    const bookId = focusBooks[0]?.id;
    setVocabList(filtered);

    if (activeMode === 'review' && bookId && filtered.length > 0) {
      const saved = readCycleReviewSession({ bookId, cycleDay: currentDay });
      let nextIndex = 0;
      if (saved) {
        const byId = filtered.findIndex((w) => w.id === saved.wordId);
        if (byId >= 0) nextIndex = byId;
        else nextIndex = Math.min(saved.currentIndex, filtered.length - 1);
      }
      setCurrentIndex(nextIndex);
    } else {
      setCurrentIndex(0);
    }
  }, [currentDay, activeMode, focusBooks, corpusBatch, viewState, reviewTargetWordIds]);

  /** corpus 已就绪但 vocabList 未同步时（Strict/竞态/addedOn 曾异常）立即补全，避免「有进度无单词」 */
  useLayoutEffect(() => {
    if (activeMode !== 'scan' || viewState !== 'scanning') return;
    if (vocabList.length > 0) return;
    if (!corpusBatch?.length) return;
    const dayTag = `Day ${currentDay}`;
    const list = corpusBatch.filter((w) => canonicalCycleDayLabel(w.addedOn) === dayTag);
    if (list.length === 0) return;
    setVocabList(list);
    setCurrentIndex((i) => Math.min(Math.max(0, i), list.length - 1));
  }, [activeMode, viewState, corpusBatch, currentDay, vocabList.length]);

  /** 防止续学索引大于列表长度时 currentWord 为空 */
  useLayoutEffect(() => {
    if (vocabList.length === 0) return;
    if (currentIndex <= vocabList.length - 1) return;
    setCurrentIndex(vocabList.length - 1);
  }, [vocabList.length, currentIndex]);

  // 循环复习：退出再进入时恢复进度（与 readReviewCompletion 同一天维度一致）
  useEffect(() => {
    if (activeMode !== 'review' || viewState !== 'scanning') return;
    const bookId = focusBooks[0]?.id;
    if (!bookId || vocabList.length === 0) return;
    const w = vocabList[currentIndex];
    if (!w?.id) return;
    saveCycleReviewSession({
      bookId,
      cycleDay: currentDay,
      currentIndex,
      wordId: w.id,
    });
  }, [activeMode, viewState, currentDay, currentIndex, vocabList, focusBooks[0]?.id]);

  useEffect(() => {
    if (currentDay !== plan.day) {
      setPlan(prev => ({ ...prev, day: currentDay }));
    }
  }, [currentDay, plan.day]);
  const [lastWordSwitchTime, setLastWordSwitchTime] = useState<number>(0);
  const [showMeaning, setShowMeaning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(10);
  const [maxTime, setMaxTime] = useState(10);
  
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [introScanLoading, setIntroScanLoading] = useState(() => initialMode === 'scan');
  
  const [isStatusDetermined, setIsStatusDetermined] = useState(false);
  // 用 ref 解决 setState 异步导致的“刚判定熟度但 moveToNext 仍以为未判定”的问题
  const isStatusDeterminedRef = useRef(false);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const isTimerActiveRef = useRef(false);
  const timeLeftRef = useRef(0);
  const [currentStatus, setCurrentStatus] = useState<WordStatus | null>(null);

  const accent = propAccent || getPronunciationAccent();
  
  const [stats, setStats] = useState(() => {
    const saved = localStorage.getItem('vocab_stats');
    const defaultStats = { 
      new: 0, 
      familiar_70: 0, 
      familiar_100: 0,
      history: {} as Record<
        string,
        { new: number; familiar_70: number; familiar_100: number; studyTime: number; reviewed?: number }
      >
    };
    const parsed = safeJsonParse<Record<string, unknown> | null>(saved, null);
    if (!parsed || typeof parsed !== 'object') return defaultStats;
    // Migration for old stats format
    if (!parsed.history) {
      return { ...defaultStats, ...parsed, history: {} };
    }
    return parsed as typeof defaultStats;
  });

  const [studyTimeToday, setStudyTimeToday] = useState(readPersistedStudySecondsForToday);
  const studyTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const inLearningView =
      (activeMode === 'scan' || activeMode === 'review') &&
      viewState === 'scanning' &&
      !isPaused;
    if (inLearningView) {
      studyTimerRef.current = setInterval(() => {
        setStudyTimeToday((prev) => prev + 1);
      }, 1000);
    } else {
      if (studyTimerRef.current) clearInterval(studyTimerRef.current);
    }
    return () => {
      if (studyTimerRef.current) clearInterval(studyTimerRef.current);
    };
  }, [activeMode, viewState, isPaused]);

  // Update history when stats or studyTimeToday changes
  // 2) 实时保存：每当 stats (总体或历史) 变化时，立刻同步到 localStorage
  useEffect(() => {
    localStorage.setItem('vocab_stats', JSON.stringify(stats));
    dispatchVocabStatsUpdated();
  }, [stats]);

  // 3) 定时保存：将今日增加的学习时长同步到今日历史中
  useEffect(() => {
    const today = getBeijingDateKey();
    setStats(prev => {
      const h = { ...prev.history };
      if (!h[today]) {
        h[today] = { new: 0, familiar_70: 0, familiar_100: 0, studyTime: 0, reviewed: 0 };
      }
      h[today] = { ...h[today], studyTime: studyTimeToday };
      return { ...prev, history: h };
    });
  }, [studyTimeToday]);

  // 1. 基础数据结构定义 (Data Schema)
  const wordList = useMemo(() => focusBooks[0]?.words || [], [focusBooks]);

  const [showImportSheet, setShowImportSheet] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [collectionBooks, setCollectionBooks] = useState<any[]>([]);
  const [customBooks, setCustomBooks] = useState<any[]>([]);
  const [collectionShelfTab, setCollectionShelfTab] = useState<CollectionShelfTab>('all');

  const visibleCollectionShelves = useMemo(() => {
    if (collectionShelfTab === 'all') return COLLECTION_SHELVES;
    const shelfId = COLLECTION_SHELF_TAB_SINGLE[collectionShelfTab];
    return COLLECTION_SHELVES.filter((s) => s.id === shelfId);
  }, [collectionShelfTab]);

  useEffect(() => {
    if (isStorageReady) {
      setIdbItem('vocab_custom_books', customBooks).catch(console.error);
      dispatchVocabStatsUpdated();
    }
  }, [customBooks, isStorageReady]);

  useEffect(() => {
    if (isStorageReady) {
      localStorage.setItem('vocab_collection_books', JSON.stringify(collectionBooks));
    }
  }, [collectionBooks, isStorageReady]);

  const [selectedBookForAction, setSelectedBookForAction] = useState<any>(null);
  const [showBookActionSheet, setShowBookActionSheet] = useState(false);
  /** 5 日循环分配：独立弹层，避免挤在主书详情里 */
  const [showBookCycleScheduleSheet, setShowBookCycleScheduleSheet] = useState(false);
  /** 用户在选购档后进入「打字确认」，非 null 时展示确认区 */
  const [dailyPlanPending, setDailyPlanPending] = useState<DailyPlanWords | null>(null);
  const [dailyPlanConfirmInput, setDailyPlanConfirmInput] = useState('');
  const [showBookWordList, setShowBookWordList] = useState(false);
  /** 输入框展示值；真正参与筛选的是 wordListQuery，避免平板中文输入法组字时用拼音字母筛掉全部词 */
  const [wordListSearchDraft, setWordListSearchDraft] = useState('');
  const [wordListQuery, setWordListQuery] = useState('');
  const [wordListStatusFilter, setWordListStatusFilter] = useState<'all' | 'new' | 'familiar_70' | 'familiar_100'>('all');
  const wordListComposingRef = useRef(false);
  const [wordListPage, setWordListPage] = useState(1);
  const [remoteWordList, setRemoteWordList] = useState<BookWordPreview[] | null>(null);
  const [remoteWordListBookId, setRemoteWordListBookId] = useState<string | null>(null);
  const [remoteWordListLoading, setRemoteWordListLoading] = useState(false);
  const [remoteWordListError, setRemoteWordListError] = useState<string | null>(null);

  const WORDS_PAGE_SIZE = 200;

  useEffect(() => {
    if (!showBookActionSheet) {
      setDailyPlanPending(null);
      setDailyPlanConfirmInput('');
      setShowBookCycleScheduleSheet(false);
    }
  }, [showBookActionSheet]);

  useEffect(() => {
    if (!showBookCycleScheduleSheet || !selectedBookForAction) return;
    const d = selectedBookForAction.dailyPlanWords ?? dailyPlanPending ?? null;
    if (d == null) setShowBookCycleScheduleSheet(false);
  }, [
    showBookCycleScheduleSheet,
    selectedBookForAction,
    selectedBookForAction?.dailyPlanWords,
    dailyPlanPending,
  ]);

  useEffect(() => {
    if (!showBookWordList || !selectedBookForAction) return;
    const book = selectedBookForAction;
    if (book.words?.length) return;

    if (!hasBuiltInVocabFile(book.id)) return;

    if (remoteWordListBookId === book.id && remoteWordList && remoteWordList.length > 0) return;

    let cancelled = false;
    setRemoteWordListLoading(true);
    setRemoteWordListError(null);
    fetchBuiltInCorpusCached(book.id)
      .then((data) => {
        if (cancelled) return;
        setRemoteWordList(data);
        setRemoteWordListBookId(book.id);
      })
      .catch(() => {
        if (cancelled) return;
        setRemoteWordListError('词表加载失败');
        setRemoteWordList(null);
      })
      .finally(() => {
        if (!cancelled) setRemoteWordListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showBookWordList, selectedBookForAction?.id, selectedBookForAction?.words?.length]);

  useEffect(() => {
    if (!showBookWordList) {
      setWordListSearchDraft('');
      setWordListQuery('');
      setWordListStatusFilter('all');
    }
  }, [showBookWordList]);

  const bookWordResolved = useMemo(() => {
    if (!selectedBookForAction) return null;
    if (selectedBookForAction.words?.length) {
      return resolveBookWordList(selectedBookForAction);
    }
    if (remoteWordList && remoteWordListBookId === selectedBookForAction.id) {
      return {
        list: remoteWordList,
        totalInBook: remoteWordList.length,
        isFullCorpus: true,
      };
    }
    if (remoteWordListError && hasBuiltInVocabFile(selectedBookForAction.id)) {
      const fb = getFallbackSampleList(selectedBookForAction.id);
      return {
        list: fb,
        totalInBook: selectedBookForAction.count ?? fb.length,
        isFullCorpus: false,
      };
    }
    return resolveBookWordList(selectedBookForAction);
  }, [selectedBookForAction, remoteWordList, remoteWordListBookId, remoteWordListError]);

  /** 对齐当前选定词书的学习状态：从 focusBooks 数组中找到对应 ID 的书籍记录，以支持内置书的熟度显示 */
  const focusBookStatusMap = useMemo(() => {
    const bookId = selectedBookForAction?.id;
    if (!bookId) return new Map<string, string>();
    const studyRecord = (focusBooks as any[]).find(b => b.id === bookId);
    if (!studyRecord?.words?.length) return new Map<string, string>();
    return new Map(
      (studyRecord.words as { id: string; status?: string }[]).map((w) => [w.id, w.status ?? 'new'])
    );
  }, [selectedBookForAction?.id, focusBooks]);

  /** 各熟度分类词数（未被扫过的词默认为 new） */
  const wordListStatusCounts = useMemo(() => {
    const counts = { all: 0, new: 0, familiar_70: 0, familiar_100: 0 };
    if (!bookWordResolved) return counts;
    for (const w of bookWordResolved.list) {
      counts.all++;
      const st = (w as any).status ?? focusBookStatusMap.get(w.id) ?? 'new';
      if (st === 'familiar_100') counts.familiar_100++;
      else if (st === 'familiar_70') counts.familiar_70++;
      else counts.new++;
    }
    return counts;
  }, [bookWordResolved, focusBookStatusMap]);

  const bookWordFiltered = useMemo(() => {
    if (!bookWordResolved) return [];
    let list: typeof bookWordResolved.list = bookWordResolved.list;
    // 熟度筛选
    if (wordListStatusFilter !== 'all') {
      list = list.filter((w) => {
        const st = (w as any).status ?? focusBookStatusMap.get(w.id) ?? 'new';
        return st === wordListStatusFilter;
      });
    }
    const qNorm = normalizeWordListSearch(wordListQuery);
    const q = qNorm.toLowerCase();
    if (!q) return list;
    return list.filter(
      (w) =>
        w.word.toLowerCase().includes(q) ||
        (w.meaning && w.meaning.toLowerCase().includes(q)) ||
        (w.phonetic && w.phonetic.toLowerCase().includes(q))
    );
  }, [bookWordResolved, wordListQuery, wordListStatusFilter, focusBookStatusMap]);

  const wordListTotalPages = Math.max(1, Math.ceil(bookWordFiltered.length / WORDS_PAGE_SIZE));

  const paginatedWordList = useMemo(() => {
    const start = (wordListPage - 1) * WORDS_PAGE_SIZE;
    return bookWordFiltered.slice(start, start + WORDS_PAGE_SIZE);
  }, [bookWordFiltered, wordListPage]);

  useEffect(() => {
    setWordListPage(1);
  }, [wordListQuery, selectedBookForAction?.id, wordListStatusFilter]);

  useEffect(() => {
    if (wordListPage > wordListTotalPages) setWordListPage(wordListTotalPages);
  }, [wordListPage, wordListTotalPages]);

  const showRemoteWordListSpinner =
    remoteWordListLoading &&
    selectedBookForAction &&
    !selectedBookForAction.words?.length &&
    hasBuiltInVocabFile(selectedBookForAction.id) &&
    !(remoteWordList && remoteWordListBookId === selectedBookForAction.id);

  const isInitialFocusMount = useRef(true);
  useEffect(() => {
    if (!isStorageReady) return;
    if (isInitialFocusMount.current) {
      isInitialFocusMount.current = false;
      return;
    }
    localStorage.setItem('vocab_focus_books', JSON.stringify(focusBooks));
    dispatchVocabStatsUpdated();
  }, [focusBooks, isStorageReady]);

  // --- 外部同步监听 (云端/多标签页) ---
  // 必须放在所有 useState 声明之后，以避免 TDZ 错误
  useEffect(() => {
    const handleExternalSync = () => {
      console.log('[VocabularyModule] 监听到外部同步事件，正在刷新本地状态...');
      
      // 1. 刷新统计数据
      const savedStats = localStorage.getItem('vocab_stats');
      const nextStats = safeJsonParse<any>(savedStats, null);
      if (nextStats && JSON.stringify(nextStats) !== JSON.stringify(stats)) {
        setStats(nextStats);
      }

      // 2. 刷新计划
      const savedPlan = localStorage.getItem('vocab_plan');
      const nextPlan = safeJsonParse<any>(savedPlan, null);
      if (nextPlan && JSON.stringify(nextPlan) !== JSON.stringify(plan)) {
        setPlan(nextPlan);
      }

      // 3. 刷新词库列表 (主攻/书库/自建)
      const savedFocus = localStorage.getItem('vocab_focus_books');
      const nextFocus = mergeFocusWithDefaults(safeJsonParse(savedFocus, null));
      if (JSON.stringify(nextFocus) !== JSON.stringify(focusBooks)) {
        setFocusBooks(nextFocus);
      }

      const savedColl = localStorage.getItem('vocab_collection_books');
      const nextColl = mergeCollectionWithDefaults(safeJsonParse(savedColl, null));
      if (JSON.stringify(nextColl) !== JSON.stringify(collectionBooks)) {
        setCollectionBooks(nextColl);
      }

      const savedCustom = localStorage.getItem('vocab_custom_books');
      const nextCustom = safeJsonParse<any[]>(savedCustom, []);
      if (JSON.stringify(nextCustom) !== JSON.stringify(customBooks)) {
        setCustomBooks(nextCustom);
      }
    };

    window.addEventListener(VOCAB_STATS_UPDATED_EVENT, handleExternalSync);
    return () => window.removeEventListener(VOCAB_STATS_UPDATED_EVENT, handleExternalSync);
  }, [stats, plan, focusBooks, collectionBooks, customBooks]);

  const isInitialCollMount = useRef(true);
  useEffect(() => {
    if (isInitialCollMount.current) {
      isInitialCollMount.current = false;
      return;
    }
    localStorage.setItem('vocab_collection_books', JSON.stringify(collectionBooks));
    dispatchVocabStatsUpdated();
  }, [collectionBooks]);

  const handleSetAsCurrentGoal = (book: any) => {
    const currentFocus = focusBooks[0];
    
    if (currentFocus && book.id === currentFocus.id) {
      setShowBookActionSheet(false);
      return;
    }

    // A simple approach: swap the objects in their respective arrays.
    const inCollection = collectionBooks.findIndex(b => b.id === book.id);
    const inCustom = customBooks.findIndex(b => b.id === book.id);

    if (inCollection !== -1) {
      const newCollection = [...collectionBooks];
      if (currentFocus) {
        newCollection[inCollection] = patchBuiltInBookMeta(currentFocus as FocusBookRow);
      } else {
        newCollection.splice(inCollection, 1);
      }
      setCollectionBooks(newCollection);
    } else if (inCustom !== -1) {
      if (currentFocus && isUserCustomVocabBook(currentFocus)) {
      const newCustom = [...customBooks];
      newCustom[inCustom] = currentFocus;
      setCustomBooks(newCustom);
      } else {
        // 旧主攻是内置书时绝不能占用自建专区格子，否则考研等会「跑进」Private Section
        const newCustom = [...customBooks];
        newCustom.splice(inCustom, 1);
        setCustomBooks(newCustom);
        if (currentFocus) {
          setCollectionBooks((prev) => {
            const next = [...prev];
            const j = next.findIndex((b) => b.id === currentFocus.id);
            const restored = patchBuiltInBookMeta(currentFocus as FocusBookRow);
            if (j !== -1) {
              next[j] = restored;
              return next;
            }
            if (BUILT_IN_BOOK_META.has(currentFocus.id)) {
              next.push(restored);
            }
            return next;
          });
        }
      }
    }

    setFocusBooks([patchBuiltInBookMeta(book as FocusBookRow)]);
    setShowBookActionSheet(false);
    if (onBookSelect) onBookSelect(book);
    
    if (book.words && book.words.length > 0) {
      setVocabList(book.words);
    } else {
      setVocabList([]);
    }
    setCurrentIndex(0);
  };

  const handleDeleteCustomBook = (bookId: string) => {
    if (!isUserCustomVocabBook({ id: bookId })) return;
    if (!window.confirm('确定删除这本自建词书？词表与本书进度将一并移除，且无法恢复。')) return;
    clearStudyCursor(bookId);
    setCustomBooks((prev) => prev.filter((b) => b.id !== bookId));
    // 换主攻时自建书可能被暂时放进「我的书库」，仅删 customBooks 会删不干净
    setCollectionBooks((prev) => prev.filter((b) => b.id !== bookId));
    setFocusBooks((prev) => {
      if (prev[0]?.id !== bookId) return prev;
      return [];
    });
    setShowBookActionSheet(false);
  };

  const handleResetProgress = (bookId: string) => {
    const ok = window.confirm(
      '纠错回滚：将清空本书熟度标注/遍数/进度/今日已扫，并清空学习统计（热力图等），回到 Day 1。确定继续？'
    );
    if (!ok) return;
    clearScanResumeStorage();
    clearTodayScanForBook(bookId);
    clearStudyCursor(bookId);

    // 严规式“硬回滚”：内置书清空已合并词表；自建书保留词表但熟度打回初始。
    const clearMergedWords = hasBuiltInVocabFile(bookId);
    const reset = (b: any) => {
      if (b.id !== bookId) return b;
      const nextWords = clearMergedWords
        ? []
        : Array.isArray(b.words)
          ? b.words.map((w: any) => {
              if (!w || typeof w !== 'object') return w;
              return { ...w, status: 'new', review_count: 0, stuckCycles: 0 };
            })
          : b.words;
      return {
        ...b,
        progress: 0,
        dailyPlanWords: undefined,
        studyPass: 1,
        words: nextWords,
      };
    };
    setFocusBooks(prev => prev.map(reset));
    setCollectionBooks(prev => prev.map(reset));
    setCustomBooks(prev => prev.map(reset));

    // 学习统计清空（与严规失败一致）；顺带移除旧版默写页进度键
    try {
      localStorage.removeItem('vocab_stats');
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('vocab_dictation_progress_v1_')) localStorage.removeItem(k);
      }
    } catch {
      // ignore
    }
    setStats({
      new: 0,
      familiar_70: 0,
      familiar_100: 0,
      history: {},
    });
    dispatchVocabStatsUpdated();

    // Cycle 回 Day 1（与严规失败一致）
    try {
      localStorage.setItem('vocab_current_day', '1');
    } catch {
      // ignore
    }
    setShowBookActionSheet(false);
  };

  const handleCommitDailyPlan = (n: DailyPlanWords) => {
    const b = selectedBookForAction;
    if (!b) return;
    if (isDailyPlanLocked(b)) {
      setFeedback('本书尚未背完（未满 100%），不能更改每日背诵量');
      setTimeout(() => setFeedback(null), 2600);
      return;
    }
    const patch = (x: any) => (x.id === b.id ? { ...x, dailyPlanWords: n } : x);
    setCollectionBooks((prev) => prev.map(patch));
    setCustomBooks((prev) => prev.map(patch));
    setFocusBooks((prev) => prev.map(patch));
    setSelectedBookForAction({ ...b, dailyPlanWords: n });
    if (focusBooks[0]?.id === b.id) {
      setPlan((p) => ({ ...p, words: n, time: wordsToPlanTimeMin(n) }));
    }
    setFeedback(`已选择每日 ${n} 词；未满 100% 前请仅在词库查看，不可改计划`);
    setTimeout(() => setFeedback(null), 2400);
  };

  const processImportedText = async (text: string, name: string) => {
    setIsImporting(true);
    setFeedback(null);
    try {
      const { items, skippedCount, totalLines, structuredRowCount } =
        parseImportedVocabularyUnified(text);
      if (items.length === 0) {
        setFeedback(
          '未识别到有效词条。请用 UTF-8 保存 .txt / .csv；每行一条，支持 Tab、|、多空格或「词—释义」等常见排版。'
        );
        return;
      }

      const words = items.map((w, i) => ({
        id: `custom-${Date.now()}-${i}`,
        word: w.word,
        meaning: w.meaning,
        phonetic: w.phonetic,
      }));

        const newBook = {
          id: `custom-${Date.now()}`,
          title: name,
          count: words.length,
          progress: 0,
          color: ['#2D3436', '#4A4A4A', '#8c8881', '#b58362'][Math.floor(Math.random() * 4)],
          isCustom: true,
        words
        };
        setCustomBooks(prev => [...prev, newBook]);
      const skipHint = skippedCount > 0 ? `，${skippedCount} 行未计入` : '';
      const structHint =
        structuredRowCount !== words.length
          ? `；结构化识别 ${structuredRowCount} 条`
          : '';
      setFeedback(
        `已导入 ${words.length} 词（${totalLines} 行${skipHint}${structHint}，本地解析）`
      );
        setTimeout(() => {
          setShowImportSheet(false);
          setFeedback(null);
        }, 2000);
    } catch (error) {
      console.error("Import processing error:", error);
      setFeedback("解析失败，请检查文本格式");
    } finally {
      setIsImporting(false);
    }
  };

  const handleLibraryFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Increased practical limit dramatically since IndexedDB can handle it, but capping at 20MB for browser responsiveness
    const maxBytes = 20 * 1024 * 1024;
    if (file.size > maxBytes) {
      setFeedback('文件过大（超过 20MB），请拆成多个词表后再导入。');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;
      let text = '';
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch (err) {
        // Fallback to GBK/ANSI if UTF-8 strictly fails (often true for Chinese Windows txt files)
        console.warn('UTF-8 decode failed, falling back to GBK');
        text = new TextDecoder('gbk').decode(buffer);
      }
      const base = file.name.replace(/\.(txt|csv)$/i, '');
      await processImportedText(text, base || '我的词库');
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  /** 同步路由 Tab 对应的 mode；勿在每次挂载时 setCorpusBatch(null)，否则会抹掉 useLayoutEffect 里刚恢复的续学 */
  const prevInitialModeRef = useRef<ModuleMode | null>(null);
  useEffect(() => {
    const bookId = focusBooks[0]?.id;

    // 如果今天/当前循环日的「循环复习」已完成，进入 review 时直接展示完成页
    if (initialMode === 'review' && bookId) {
      const saved = readReviewCompletion({ bookId, cycleDay: currentDay });
      if (saved) {
        setActiveMode('review');
        setViewState('finished');
        setScanFinishedReason(null);
        setFinishedScanSummary(saved);
        setCorpusBatch(null);
        prevInitialModeRef.current = initialMode;
        return;
      }
    }

    setActiveMode(initialMode);
    setViewState('scanning');
    setScanFinishedReason(null);
    setFinishedScanSummary(null);
    if (prevInitialModeRef.current !== null && prevInitialModeRef.current !== initialMode) {
      setCorpusBatch(null);
    }
    prevInitialModeRef.current = initialMode;
  }, [initialMode, currentDay, focusBooks[0]?.id]);

  /** 把误入自建专区的内置书迁回「我的书库」（修复旧版 swap 逻辑污染的数据） */
  useEffect(() => {
    if (activeMode !== 'library') return;
    setCustomBooks((prev) => {
      const strays = prev.filter((b) => !isUserCustomVocabBook(b));
      if (strays.length === 0) return prev;
      setCollectionBooks((collPrev) => {
        const next = [...collPrev];
        for (const b of strays) {
          const j = next.findIndex((x) => x.id === b.id);
          const p = patchBuiltInBookMeta(b as FocusBookRow);
          if (j !== -1) next[j] = p;
          else if (BUILT_IN_BOOK_META.has(b.id)) next.push(p);
        }
        return next;
      });
      return prev.filter(isUserCustomVocabBook);
    });
  }, [activeMode]);

  /** 本轮扫词各档计数（与全局 stats 分离，避免完成页显示历史累计） */
  const scanSessionOutcomeRef = useRef({ new: 0, familiar_70: 0, familiar_100: 0 });
  /** 与当批词条同步镜像（含手势档位），合并进书时用此快照，避免 React 批处理丢最后一词的 status */
  const scanMergeWordsRef = useRef<Word[]>([]);
  const [finishedScanSummary, setFinishedScanSummary] = useState<{
    new: number;
    familiar_70: number;
    familiar_100: number;
  } | null>(null);

  // 兜底：今日计划已完成时直接进入完成页（主攻书在 / 不在 React 状态都要覆盖）。
  useEffect(() => {
    if (activeMode !== 'scan' || viewState !== 'scanning') return;
    if (corpusBatch !== null) return;
    const bid = focusBooks[0]?.id ?? getPrimaryFocusBookId();
    const ok = bid
      ? isPrimaryFocusDailyPlanDoneToday(bid)
      : !!findAnyCompletedBookIdOnDate(getBeijingDateKey());
    if (!ok) return;
    setScanFinishedReason('dailyPlanDone');
    setFinishedScanSummary({ new: 0, familiar_70: 0, familiar_100: 0 });
    setViewState('finished');
  }, [activeMode, viewState, focusBooks, corpusBatch]);

  useScanCorpusBootstrap({
    isStorageReady,
    focusBook: focusBooks[0],
    currentDay,
    activeMode,
    viewState,
    corpusBatch,
    scanSessionTrigger,
    setCorpusBatch,
    setCurrentIndex,
    setViewState,
    setIntroScanLoading,
    setFeedback,
    scanSessionOutcomeRef,
    sessionStartCursorRef,
    corpusLoadIntentRef,
    pendingResumeIndexRef,
    scanMergeWordsRef,
    setFinishedScanSummary,
    setScanFinishedReason,
  });

  const startScanningBook = (book: any) => {
    if (book.words && book.words.length > 0) {
      setVocabList(book.words);
    } else {
      setVocabList([]);
    }
    setCurrentIndex(0);
    setLastWordSwitchTime(Date.now());
    setViewState('scanning');
    setActiveMode('scan');
  };
  const [reviewTasks, setReviewTasks] = useState<{day: number, count: number}[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onGestureMarkRef = useRef<(status: WordStatus) => void>(() => {});
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-pause track refs
  const lastReviewInteractionRef = useRef<number>(Date.now());
  const activeModeTrackRef = useRef<ModuleMode | null>(null);

  useEffect(() => {
    activeModeTrackRef.current = activeMode as ModuleMode;
    lastReviewInteractionRef.current = Date.now();
  }, [activeMode]);

  useEffect(() => {
    const handleInteraction = () => {
      lastReviewInteractionRef.current = Date.now();
    };
    document.addEventListener('pointerdown', handleInteraction, { passive: true });
    document.addEventListener('pointermove', handleInteraction, { passive: true });
    // Touch events as fallback
    document.addEventListener('touchstart', handleInteraction, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', handleInteraction);
      document.removeEventListener('pointermove', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);
    };
  }, []);

  const isInitialStatsMount = useRef(true);
  useEffect(() => {
    if (isInitialStatsMount.current) {
      isInitialStatsMount.current = false;
      return;
    }
    localStorage.setItem('vocab_stats', JSON.stringify(stats));
    dispatchVocabStatsUpdated();
  }, [stats]);

  const isInitialPlanMount = useRef(true);
  useEffect(() => {
    if (isInitialPlanMount.current) {
      isInitialPlanMount.current = false;
      return;
    }
    localStorage.setItem('vocab_plan', JSON.stringify(plan));
  }, [plan]);

  useEffect(() => {
    if (stats.new > 0 || stats.familiar_70 > 0) {
      setReviewTasks([
        { day: Math.max(1, currentDay - 1), count: Math.floor((stats.new + stats.familiar_70) * 0.6) },
        { day: Math.max(1, currentDay - 2), count: Math.floor((stats.new + stats.familiar_70) * 0.3) }
      ].filter(t => t.count > 0));
    }
  }, [stats, currentDay]);

  useEffect(() => {
    if (corpusBatch === null || activeMode !== 'scan' || viewState !== 'scanning') return;
    const dayTag = `Day ${currentDay}`;
    const filtered = corpusBatch.filter((w) => canonicalCycleDayLabel(w.addedOn) === dayTag);
    scanMergeWordsRef.current = filtered.map((w) => ({ ...w }));
  }, [corpusBatch, currentDay, activeMode, viewState]);

  useScanResumePersistence({
    activeMode,
    viewState,
    corpusBatch,
    currentIndex,
    currentDay,
    focusBook: focusBooks[0],
    scanMergeWordsRef,
    sessionStartCursorRef,
    scanSessionOutcomeRef,
  });

  const canvasLayoutRetriesRef = useRef(0);

  useEffect(() => {
    const MIN_CSS = 32;
    const MAX_LAYOUT_RETRIES = 90;

    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rawDpr = window.devicePixelRatio || 1;
      const dpr = Math.min(Math.max(rawDpr, 1), 3);

      let w = canvas.clientWidth;
      let h = canvas.clientHeight;
      if (w < 1 || h < 1) {
        const rect = container.getBoundingClientRect();
        w = rect.width;
        h = rect.height;
      }

      // 布局未就绪时 client 可能接近 0，原逻辑用 Math.max(1,·) 会得到 1×1 位图，全屏拉伸后笔迹呈巨大马赛克。
      if (w < MIN_CSS || h < MIN_CSS) {
        if (canvasLayoutRetriesRef.current < MAX_LAYOUT_RETRIES) {
          canvasLayoutRetriesRef.current += 1;
          requestAnimationFrame(() => updateCanvasSize());
        }
        return;
      }
      canvasLayoutRetriesRef.current = 0;

      const nextW = Math.max(1, Math.round(w * dpr));
      const nextH = Math.max(1, Math.round(h * dpr));
      if (canvas.width === nextW && canvas.height === nextH) {
        const ctx = canvas.getContext('2d');
        ctx?.setTransform(1, 0, 0, 1, 0, 0);
        return;
      }

      canvas.width = nextW;
      canvas.height = nextH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.imageSmoothingEnabled = true;
      }
    };

    canvasLayoutRetriesRef.current = 0;
    updateCanvasSize();
    const ro =
      typeof ResizeObserver !== 'undefined' && containerRef.current
        ? new ResizeObserver(() => updateCanvasSize())
        : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', updateCanvasSize);
    requestAnimationFrame(() => updateCanvasSize());
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [viewState, activeMode, corpusBatch, vocabList.length]);

  isTimerActiveRef.current = isTimerActive;
  timeLeftRef.current = timeLeft;

  useEffect(() => {
    if (scanCorpusPending || vocabList.length === 0 || !currentWord) return;
    if (activeMode !== 'scan' && activeMode !== 'review') return;
    if (viewState !== 'scanning') return;
    if (isPaused) return;
    if (audioEnabled === false) return; // 依全局开关

    const text = displayWordLowerFirst(currentWord.word);
    if (!text) return;

    let cancelled = false;
    const tid = window.setTimeout(() => {
      if (cancelled) return;
      
      if (audioRepeatMode === 'once') {
        // 单次播报
        void pronounceWordPreferHuman(text, () => cancelled || isPausedRef.current);
      } else {
        // 循环持续播放
        startPronunciationLoop(text, () => {
          if (cancelled) return false;
          if (isPausedRef.current) return false;
          return true;
        });
      }
    }, 10);

    return () => {
      cancelled = true;
      window.clearTimeout(tid);
      cancelEnglishSpeech();
    };
  }, [
    currentWord?.id,
    currentIndex,
    scanCorpusPending,
    vocabList.length,
    activeMode,
    viewState,
    isPaused,
    accent,
    audioEnabled,
    audioRepeatMode,
  ]);

  useEffect(
    () => () => {
      cancelEnglishSpeech();
    },
    []
  );

  const { clearCanvas, startDrawing } = useScanGestureCanvas({
    canvasRef,
    activeMode: activeMode as ModuleMode,
    scanCorpusPending,
    vocabListLength: vocabList.length,
    isStatusDetermined,
    lastWordSwitchTime,
    onGestureMarkRef,
  });

  useEffect(() => {
    if (viewState === 'scanning' && vocabList.length > 0) {
      const word = vocabList[currentIndex];
      
      if (activeMode === 'review') {
        // Review mode: Automatic playback based on status（与扫词一致：生词 10s、七分熟 2s；第 5 天不再缩短）
        let duration = 10;
        // 循环复习：不做分类高亮（分类只在初次扫描完成）
        setCurrentStatus(null);
        if (word.status === 'familiar_70') duration = 2;
        else if (word.status === 'new') duration = 10;

        startTimer(duration);
        setShowMeaning(true); // Always show meaning in review mode
      } else {
        // Scan mode：仅「尚未手势定档」时回到待机；定档后 vocabList 会因写回 status 而变，不能再清计时器，否则画圈后的 10s / 七分熟 2s 会被立刻关掉
        if (!isStatusDeterminedRef.current) {
        setIsTimerActive(false);
        setTimeLeft(0);
        setMaxTime(10);
        setShowMeaning(false);
      }
    }
    }
  }, [currentIndex, viewState, activeMode, vocabList, isStatusDetermined]);

  const startTimer = (duration: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(duration);
    setMaxTime(duration);
    setIsPaused(false);
    isPausedRef.current = false;
    setIsTimerActive(true);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (isPausedRef.current) return prev;

        // 长时间无交互自动暂停（仅在复习模式下，15秒无任何交互则视作摸鱼）
        if (activeModeTrackRef.current === 'review') {
          if (Date.now() - lastReviewInteractionRef.current > 15000) {
            setIsPaused(true);
            isPausedRef.current = true;
            setFeedback('长时间无书写，已自动暂停');
            setTimeout(() => setFeedback(null), 3000);
            cancelEnglishSpeech();
            return prev;
          }
        }

        if (prev <= 0.05) {
          clearInterval(timerRef.current!);
          handleWordCompletion();
          return 0;
        }
        return prev - 0.05;
      });
    }, 50);
  };

  const handleWordCompletion = () => {
    if (activeMode === 'review') {
      // 循环复习：只放映/书写，不在复习阶段修改分类与遍数
      const isLastWord = currentIndex === vocabList.length - 1;
      moveToNext(isLastWord ? [...vocabList] : undefined);
      return;
    }
    moveToNext();
  };

  const togglePause = () => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    isPausedRef.current = nextPaused;
    if (nextPaused) cancelEnglishSpeech();
  };

  // 防抖：同一个 currentIndex 在极短时间内可能触发两次 moveToNext（例如：手势触发 + 计时器触发）
  // 加锁后保证“每个词最多推进一次”，避免出现 1->3->5 这种跳号。
  const moveNextLockRef = useRef<number | null>(null);
  const moveToNext = (reviewVocabSnapshot?: Word[]) => {
    if (moveNextLockRef.current === currentIndex) return;
    moveNextLockRef.current = currentIndex;

    // 循环复习：倒计时每过完一词记一次 reviewed（不依赖 viewState，避免定时器闭包漏记）
    if (activeMode === 'review' && vocabList[currentIndex]) {
      const today = getBeijingDateKey();
      setStats((prev) => {
        const newHistory = { ...prev.history };
        if (!newHistory[today]) {
          newHistory[today] = { new: 0, familiar_70: 0, familiar_100: 0, studyTime: 0, reviewed: 0 };
        }
        const cur = newHistory[today];
        newHistory[today] = {
          ...cur,
          reviewed: (cur.reviewed ?? 0) + 1,
        };
        return { ...prev, history: newHistory };
      });
    }

    // Record stats if no status was determined (default to 'new') in scan mode
    if (activeMode === 'scan' && !isStatusDeterminedRef.current && vocabList[currentIndex]) {
      const idx = currentIndex;
      const snap = scanMergeWordsRef.current;
      if (snap[idx]) snap[idx] = { ...snap[idx], status: 'new' };
      setVocabList((prev) => {
        const next = [...prev];
        if (next[idx]) next[idx] = { ...next[idx], status: 'new' as WordStatus };
        return next;
      });
      scanSessionOutcomeRef.current.new += 1;
      const today = getBeijingDateKey();
      setStats(prev => {
        const newHistory = { ...prev.history };
        if (!newHistory[today]) {
          newHistory[today] = { new: 0, familiar_70: 0, familiar_100: 0, studyTime: 0, reviewed: 0 };
        }
        const currentTodayStats = newHistory[today];
        newHistory[today] = {
          ...currentTodayStats,
          new: currentTodayStats.new + 1,
          studyTime: studyTimeToday
        };

        return {
          ...prev,
          new: prev.new + 1,
          history: newHistory
        };
      });
    }

    if (currentIndex < vocabList.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setLastWordSwitchTime(Date.now());
      setShowMeaning(activeMode === 'review');
      setIsStatusDetermined(false);
      isStatusDeterminedRef.current = false;
      setIsTimerActive(false);
      setCurrentStatus(null);
      clearCanvas();
      if (timerRef.current) clearInterval(timerRef.current);
    } else {
      if (activeMode === 'scan' && corpusBatch !== null && focusBooks[0]) {
        clearScanResumeStorage();
        const fb = focusBooks[0] as FocusBookRow;
        const mergeSource =
          scanMergeWordsRef.current.length > 0 &&
          scanMergeWordsRef.current.length === vocabList.length
            ? scanMergeWordsRef.current
            : vocabList;
        const patch = computeScanBatchBookPatch({
          existingBookWords: fb.words,
          mergeSource,
          batchWordCount: vocabList.length,
          studyCursorBefore: getStudyCursor(fb.id),
          bookWordCountEstimate: fb.count,
        });
        // 保底：在异步加载词书前先落盘 cursor 和今日通关状态
        // （防止 await 期间用户返回时 cursor 仍是旧值、或「今日已完成」判断失效，导致从第1词重来）
        setStudyCursor(fb.id, patch.nextStudyCursor);
        recordTodayScanBatchCompleted(fb.id, vocabList.length);
        clampTodayScannedWordCount(fb.id, plan.words);
        markPlanBatchChallengeCompletedIfNeeded(fb.id);
        void (async () => {
          try {
            const mergedWords = patch.mergedWords;
            let finalCursor = patch.nextStudyCursor;
            let progressPercent = patch.progressPercent;
            let studyPassNext: number | undefined;

            const raw = await loadRawCorpusForBook(fb);
            const pass = getEffectiveStudyPass(fb);
            const queue = buildStudyQueueForPass(raw, mergedWords, pass, fb.id);

            if (raw.length > 0 && pass === 1 && patch.nextStudyCursor >= raw.length) {
              if (countNotFullyMasteredFromCorpus(raw, mergedWords) === 0) {
                setFeedback('第一轮已完成：本书词均已全熟。');
                progressPercent = 100;
              } else {
                finalCursor = 0;
                studyPassNext = 2;
                progressPercent = computeMasteryProgressPercent(mergedWords, fb.count || raw.length);
                setFeedback('已进入第 2 轮：未全熟词已重新排课（遍数与状态保留）。');
                setTimeout(() => setFeedback(null), 4200);
              }
            } else if (raw.length > 0 && pass >= 2 && patch.nextStudyCursor >= queue.length) {
              const np = pass + 1;
              const qn = buildStudyQueueForPass(raw, mergedWords, np, fb.id);
              if (qn.length === 0) {
                setFeedback(`第 ${pass} 轮已完成：已无未全熟词。`);
                setTimeout(() => setFeedback(null), 4200);
                progressPercent = computeMasteryProgressPercent(mergedWords, fb.count || raw.length);
              } else {
                finalCursor = 0;
                studyPassNext = np;
                progressPercent = computeMasteryProgressPercent(mergedWords, fb.count || raw.length);
                setFeedback(`已进入第 ${np} 轮。`);
                setTimeout(() => setFeedback(null), 4200);
              }
            } else if (pass > 1) {
              progressPercent = computeMasteryProgressPercent(mergedWords, fb.count || raw.length);
            }

            setStudyCursor(fb.id, finalCursor);
            const progPatch = (x: FocusBookRow) => {
              if (x.id !== fb.id) return x;
              const u: FocusBookRow = { ...x, progress: progressPercent, words: mergedWords };
              if (studyPassNext != null) u.studyPass = studyPassNext;
              return u;
            };
            setFocusBooks((prev) => prev.map(progPatch));
            setCollectionBooks((prev) => prev.map(progPatch));
            setCustomBooks((prev) => prev.map(progPatch));
          } catch {
            setStudyCursor(fb.id, patch.nextStudyCursor);
            const progPatch = (x: FocusBookRow) =>
              x.id === fb.id ? { ...x, progress: patch.progressPercent, words: patch.mergedWords } : x;
            setFocusBooks((prev) => prev.map(progPatch));
            setCollectionBooks((prev) => prev.map(progPatch));
            setCustomBooks((prev) => prev.map(progPatch));
          }
          recordTodayScanBatchCompleted(fb.id, vocabList.length);
          const fbGoal = fb.dailyPlanWords === 150 || fb.dailyPlanWords === 300 || fb.dailyPlanWords === 1000 ? fb.dailyPlanWords : plan.words;
          clampTodayScannedWordCount(fb.id, fbGoal);
          markPlanBatchChallengeCompletedIfNeeded(fb.id);
          setScanFinishedReason('batch');
          setFinishedScanSummary({ ...scanSessionOutcomeRef.current });
          setViewState('finished');
        })();
        return;
      }
      if (activeMode === 'scan') {
        setScanFinishedReason('batch');
        setFinishedScanSummary({ ...scanSessionOutcomeRef.current });
      } else {
        const list = reviewVocabSnapshot ?? vocabList;
        // 整批循环复习过完：当日 reviewed 至少为本批词数（与逐词累计一致，并兜底漏记）
        if (activeMode === 'review' && list.length > 0) {
          const today = getBeijingDateKey();
          setStats((prev) => {
            const newHistory = { ...prev.history };
            if (!newHistory[today]) {
              newHistory[today] = { new: 0, familiar_70: 0, familiar_100: 0, studyTime: 0, reviewed: 0 };
            }
            const cur = newHistory[today];
            const n = list.length;
            newHistory[today] = { ...cur, reviewed: Math.max(cur.reviewed ?? 0, n) };
            return { ...prev, history: newHistory };
          });
        }
        const dist = { new: 0, familiar_70: 0, familiar_100: 0 };
        for (const w of list) {
          const s = w.status || 'new';
          if (s === 'familiar_70') dist.familiar_70 += 1;
          else if (s === 'familiar_100') dist.familiar_100 += 1;
          else dist.new += 1;
        }
        setFinishedScanSummary(dist);
        const bookId = focusBooks[0]?.id;
        if (bookId) {
          // 复习完成标记：防止你从首页再点「循环复习」时重复从第一个单词开始
          markReviewCompleted({ bookId, cycleDay: currentDay, summary: dist });
          clearCycleReviewSession({ bookId, cycleDay: currentDay });
          // 保留原逻辑：也同步 dailyChallenge.completedOnDate（用于首页解锁/兜底）
          markPlanBatchChallengeCompletedIfNeeded(bookId);
        }
      }

      moveNextLockRef.current = null;
      setViewState('finished');
    }
  };

  const applyMarkAndStay = (status: WordStatus) => {
    if (isStatusDeterminedRef.current) return;

    const idx = currentIndex;
    const today = getBeijingDateKey();

    // 1) 手势写回当前词 status（scan / review 都要写入）
    if (idx >= 0) {
      if (activeMode === 'scan') {
        const key = status as 'new' | 'familiar_70' | 'familiar_100';
        scanSessionOutcomeRef.current[key] += 1;
        const snap = scanMergeWordsRef.current;
        if (snap[idx]) snap[idx] = { ...snap[idx], status };
      }

      setVocabList((prev) => {
        const next = [...prev];
        if (next[idx]) {
          // 核心加固：划勾（全熟）直接给 10 遍，确保其永久脱离破冰循环
          const rc = status === 'familiar_100' ? 10 : status === 'familiar_70' ? 1 : 0;
          next[idx] = { ...next[idx], status, review_count: rc };
        }
        return next;
      });

      // 实时同步统计数据 (Real-time synchronization)
      setStats((prev: any) => {
      const newHistory = { ...prev.history };
      if (!newHistory[today]) {
        newHistory[today] = { new: 0, familiar_70: 0, familiar_100: 0, studyTime: 0, reviewed: 0 };
      }
      const currentTodayStats = newHistory[today];
        const key = status as 'new' | 'familiar_70' | 'familiar_100';

      return {
        ...prev,
          [key]: (prev[key] || 0) + 1,
          history: {
            ...newHistory,
            [today]: {
              ...currentTodayStats,
              [key]: (currentTodayStats[key] || 0) + 1,
            }
          }
      };
    });
    }

    setIsStatusDetermined(true);
    isStatusDeterminedRef.current = true;
    setShowMeaning(true);
    
    // 3) 底部高亮与节奏（全熟不再弹提示，只静默进入下一词）
    if (status !== 'familiar_100') {
      setCurrentStatus(status);
    const feedbackMap = {
        new: '标记为生词 (10s 倒计时)',
        familiar_70: '七分熟 (2s 倒计时)',
      } as const;
      setFeedback(feedbackMap[status as 'new' | 'familiar_70']);
    setTimeout(() => setFeedback(null), 1000);
    } else {
      setCurrentStatus(null);
      setFeedback(null);
    }

    if (status === 'familiar_100') {
      moveToNext();
    } else if (status === 'familiar_70') {
      // 与约定一致：下横线/七分熟 = 严格 2s 倒计时后再进下一词
      startTimer(2);
    } else if (status === 'new') {
      // 与约定一致：画圈/生词 = 严格 10s 倒计时后再进下一词
      startTimer(10);
    }
  };
  onGestureMarkRef.current = applyMarkAndStay;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (!isStorageReady) {
    return (
      <div className="flex-1 flex flex-col min-h-0 items-center justify-center bg-[#FDFCF9]">
        <Loader2 className="w-8 h-8 md:w-10 md:h-10 text-[#d4c4b0] animate-spin mb-4" />
        <p className="text-[#8c8881] font-serif text-sm">正在加载书库...</p>
      </div>
    );
  }

  if (activeMode === 'stats') {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-[#F4F3ED] font-sans overflow-x-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar flex flex-col items-stretch">
          <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 md:py-12 pb-24 flex-1 flex flex-col gap-8 md:gap-10">
            <LearningStatsOverview stats={stats} history={stats.history} />
            <LearningHeatmap history={stats.history} />
          </div>
        </div>
      </div>
    );
  }

  if (activeMode === 'library') {
    return (
      <div className="flex-1 flex flex-col bg-[#FDFCF9] overflow-y-auto hide-scrollbar">
        <div className="max-w-6xl mx-auto w-full p-6 md:p-16 space-y-12 md:space-y-20">
          
          {/* Header */}
          <div className="space-y-1 md:space-y-2 text-center md:text-left">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-[#1f1e1d]">备考词书库</h2>
            <p className="text-[10px] text-[#8c8881] tracking-[0.4em] uppercase font-medium">Modern Minimalist Bookshelf</p>
          </div>

          {/* Layer 1: Current Focus */}
          <section className="space-y-6 md:space-y-8 relative bg-white/40 p-6 md:p-10 rounded-3xl md:rounded-[3rem] border border-black/5 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-[#fae5d3] pb-3 md:pb-4">
              <h3 className="text-xs md:text-sm font-serif italic text-[#8c8881]">01 / 正在攻克 Current Focus</h3>
              <div className="text-[8px] md:text-[10px] text-[#b58362] font-bold tracking-widest uppercase">Priority 01</div>
            </div>
            
            <div className="flex flex-col md:flex-row items-center md:items-end gap-8 md:gap-12">
              {(() => {
                const book = focusBooks[0];
                if (!book) {
                  return (
                    <div className="w-full py-8 text-center flex flex-col items-center justify-center gap-3">
                      <p className="text-sm md:text-base text-[#8c8881] italic font-serif">尚未选定主攻词书</p>
                      <p className="text-[10px] text-[#a8a29a] uppercase tracking-widest">请从下方书库选取一本开始挑战</p>
                    </div>
                  );
                }
                const goal =
                  book.dailyPlanWords === 150 || book.dailyPlanWords === 300 || book.dailyPlanWords === 1000
                    ? book.dailyPlanWords
                    : plan.words;
                const scanned = clampTodayScannedWordCount(book.id, goal);
                const progressSub =
                  goal > 0
                    ? scanned >= goal
                      ? scanned === goal
                        ? ' · 已达今日目标'
                        : ` · 超出今日目标 ${scanned - goal} 个`
                      : ` · 还差 ${goal - scanned} 个`
                    : '';
                return (
                <div key={book.id} className="flex flex-col md:flex-row items-center md:items-end gap-6 md:gap-8 w-full">
                  <Book
                    {...book}
                    size="lg"
                    libraryStats={buildBookLibraryCardStatsLines(book)}
                    onClick={() => {
                    setSelectedBookForAction(book);
                    setShowBookActionSheet(true);
                  }}
                  />
                  <div className="pb-2 md:pb-4 space-y-2 md:space-y-4 max-w-xs text-center md:text-left">
                      {isUserCustomVocabBook(book) && (
                        <p className="text-[10px] text-[#8c8881] leading-relaxed">
                          自建词书：点击左侧封面打开详情，滑到最下方可「删除该书」。
                        </p>
                      )}
                    <div className="space-y-1">
                        <p className="text-xl md:text-2xl font-serif font-bold text-[#1f1e1d]">今日目标: {goal} 词</p>
                        <p className="text-xs md:text-sm text-[#8c8881]">
                          本日已扫完 {scanned} 词{progressSub}
                        </p>
                        <p className="text-[10px] text-[#c4bfb7] mt-1 leading-relaxed">
                          按北京时间自然日累计；每<strong className="font-medium text-[#a8a29a]">整批</strong>
                          扫词结束后计入（与是否标成「生词」无关）。
                        </p>
                    </div>
                  </div>
                </div>
                );
              })()}
            </div>
          </section>

          {/* Layer 2: My Collection */}
          <section className="space-y-6 md:space-y-8 bg-[#FDF6F0]/30 p-6 md:p-10 rounded-3xl md:rounded-[3rem] border border-[#fae5d3]/50">
            <div className="flex flex-col gap-3 border-b border-[#fae5d3] pb-3 md:pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h3 className="text-xs md:text-sm font-serif italic text-[#8c8881]">02 / 我的书库 My Collection</h3>
                <div
                  className="flex flex-wrap gap-1.5 md:gap-2"
                  role="tablist"
                  aria-label="书库学段"
                >
                  {(
                    [
                      { id: 'all' as const, label: '全部' },
                      { id: 'junior' as const, label: '初中' },
                      { id: 'senior' as const, label: '高中' },
                      { id: 'university' as const, label: '大学' },
                      { id: 'kaoyan' as const, label: '考研' },
                      { id: 'abroad' as const, label: '留学' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={collectionShelfTab === tab.id}
                      onClick={() => setCollectionShelfTab(tab.id)}
                      className={cn(
                        'rounded-full px-3 py-1.5 md:px-3.5 text-[10px] md:text-[11px] font-medium tracking-tight transition-colors border',
                        collectionShelfTab === tab.id
                          ? 'bg-[#1f1e1d] text-[#fdf6f0] border-[#1f1e1d] shadow-sm'
                          : 'bg-white/70 text-[#6b5b4d] border-[#e8dfd0] hover:border-[#d4c4b0] hover:bg-white',
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-10 md:space-y-12">
              {visibleCollectionShelves.map((shelf) => {
                const row = orderCollectionBooksForShelf(collectionBooks, shelf.bookIds);
                if (row.length === 0) return null;
                return (
                  <div key={shelf.id} className="space-y-4">
                    <div className="border-b border-[#fae5d3]/70 pb-2.5">
                      <h4 className="text-sm md:text-base font-serif font-bold text-[#1f1e1d] tracking-tight">
                        {shelf.title}
                      </h4>
                      {shelf.hint ? (
                        <p className="text-[10px] md:text-[11px] text-[#8c8881] mt-1.5 leading-relaxed max-w-3xl">
                          {shelf.hint}
                        </p>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:flex md:flex-wrap gap-6 md:gap-12 justify-items-center">
                      {row.map((book) => (
                        <Book
                          key={book.id}
                          {...book}
                          libraryStats={buildBookLibraryCardStatsLines(book)}
                          onClick={() => {
                            setSelectedBookForAction(book);
                            setShowBookActionSheet(true);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {collectionShelfTab === 'all' &&
                (() => {
                const rest = collectionBooks.filter((b) => !COLLECTION_SHELF_BOOK_IDS.has(b.id));
                if (rest.length === 0) return null;
                return (
                  <div className="space-y-4">
                    <div className="border-b border-[#fae5d3]/70 pb-2.5">
                      <h4 className="text-sm md:text-base font-serif font-bold text-[#1f1e1d]">其它书目</h4>
                      <p className="text-[10px] md:text-[11px] text-[#8c8881] mt-1.5 leading-relaxed">
                        来自本地缓存的额外条目，未归入上分架。
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:flex md:flex-wrap gap-6 md:gap-12 justify-items-center">
                      {rest.map((book) => (
                        <Book
                          key={book.id}
                          {...book}
                          libraryStats={buildBookLibraryCardStatsLines(book)}
                          onClick={() => {
                            setSelectedBookForAction(book);
                            setShowBookActionSheet(true);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="rounded-2xl border border-dashed border-[#e8dfd0] bg-[#fdfaf5]/70 px-4 py-3.5 md:px-5 text-[10px] md:text-[11px] text-[#6b5b4d] leading-relaxed max-w-3xl space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-[#5c5346]">更多词汇分类（按需自建导入）</p>
                  <button 
                    onClick={() => {
                      const templateTxt = `apple n. 苹果\npick up, 捡起\nbanana[bəˈnɑ:nə] n. 香蕉\n"orange", "橘子"`;
                      const blob = new Blob([templateTxt], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = '自建词表模板_糯糯背单词.txt';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="text-[10px] bg-[#f0e8dc] text-[#5c4030] px-2 py-0.5 rounded font-medium hover:bg-[#e6d8c8] transition-colors flex items-center gap-1"
                  >
                    下载 TXT 模板
                  </button>
                </div>
                <p>
                  如果您需要背诵内置书库以外的词汇（例如：<strong>小学英语、KET / PET、医学 / 法律相关</strong>等），请使用下方的 <strong>03 自建专区</strong> 导入。系统采用了极高容错的解析引擎，您只需直接复制粘贴或导入 <strong>TXT 文件</strong>（暂不支持 Excel 直接导入）。
                </p>
                <div className="mt-2 bg-white/50 rounded-lg p-3 border border-[#f0e8dc]">
                  <p className="font-bold text-[#5c4030] mb-1.5 flex items-center gap-1.5"><List size={12}/> 支持的智能识别格式参考：</p>
                  <ul className="list-disc pl-4 space-y-1.5 text-[10px]">
                    <li><strong>基础空格/制表符：</strong><code className="text-[#8c7462] bg-[#fdf8f4] px-1 py-0.5 rounded">apple n. 苹果</code></li>
                    <li><strong>支持词组与符号：</strong><code className="text-[#8c7462] bg-[#fdf8f4] px-1 py-0.5 rounded">in order to, 为了</code> 或 <code className="text-[#8c7462] bg-[#fdf8f4] px-1 py-0.5 rounded">pick up ; 捡起</code></li>
                    <li><strong>带音标紧贴：</strong><code className="text-[#8c7462] bg-[#fdf8f4] px-1 py-0.5 rounded">apple[æpl]n.苹果</code> （自动正确切割）</li>
                    <li><strong>双引号包裹格式：</strong><code className="text-[#8c7462] bg-[#fdf8f4] px-1 py-0.5 rounded">"word", "meaning"</code> （自动去双引号）</li>
                    <li><strong>智能过滤排版：</strong>自动过滤掉无关的中文句子、表头说明（如 Word List 1），不再产生乱七八糟的乱字符单词。</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* Layer 3: Private Section */}
          <section className="space-y-6 md:space-y-8 pb-10 bg-white/30 p-6 md:p-10 rounded-3xl md:rounded-[3rem] border border-black/5">
            <div className="flex items-center justify-between border-b border-[#fae5d3] pb-3 md:pb-4">
              <h3 className="text-xs md:text-sm font-serif italic text-[#8c8881]">03 / 自建专区 Private Section</h3>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 md:flex md:flex-wrap gap-6 md:gap-12 justify-items-center">
              <Book isImport onClick={() => setShowImportSheet(true)} />
              {customBooks.map((book, i) => (
                <Book
                  key={book.id}
                  {...book}
                  isCustom
                  libraryStats={buildBookLibraryCardStatsLines(book)}
                  onClick={() => {
                  setSelectedBookForAction(book);
                  setShowBookActionSheet(true);
                }}
                />
              ))}
            </div>
          </section>
        </div>

        {/* Book Action Sheet */}
        <AnimatePresence>
          {showBookActionSheet && selectedBookForAction && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                onClick={() => setShowBookActionSheet(false)}
                className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-[60]"
              />
              <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={SHEET_SPRING}
                className="fixed bottom-0 left-0 right-0 max-h-[92dvh] overflow-y-auto bg-[#f5f0e6] rounded-t-[2rem] md:rounded-t-[3rem] shadow-[0_-12px_48px_rgba(0,0,0,0.12)] z-[70] p-6 md:p-10 pb-[max(2rem,env(safe-area-inset-bottom,0px))]"
              >
                <div className="max-w-2xl mx-auto">
                  <motion.div
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    className="flex flex-col md:flex-row gap-6 md:gap-10 items-center md:items-start"
                  >
                    {/* Left: Thumbnail（与列表非共享布局，避免双份 layoutId） */}
                    <div className="shrink-0">
                      <Book
                        {...selectedBookForAction}
                        size="md"
                        interactive={false}
                        libraryStats={buildBookLibraryCardStatsLines(selectedBookForAction)}
                        onClick={() => {}}
                      />
                    </div>

                    {/* Right: Info & Actions */}
                    <div className="flex-1 space-y-6 md:space-y-8 w-full">
                      <div className="space-y-1 md:space-y-2 text-center md:text-left">
                        {selectedBookForAction.tag && (
                          <p className="text-[10px] md:text-xs text-[#b58362] font-bold tracking-widest uppercase">
                            {selectedBookForAction.tag}
                          </p>
                        )}
                        <h2 className="text-2xl md:text-3xl font-serif font-bold text-[#1f1e1d]">{selectedBookForAction.title}</h2>
                        {selectedBookForAction.blurb && (
                          <p className="text-xs md:text-sm text-[#8c8881] leading-relaxed max-w-md mx-auto md:mx-0">
                            {selectedBookForAction.blurb}
                          </p>
                        )}
                        <div className="flex flex-col gap-1.5 text-xs md:text-sm text-[#8c8881] pt-1">
                          <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-4 gap-y-1">
                          <span>总词汇: {selectedBookForAction.count}</span>
                            <span className="w-1 h-1 rounded-full bg-[#fae5d3] hidden sm:inline" />
                            <span>
                              学习轮次: 第 {getEffectiveStudyPass(selectedBookForAction)} 轮
                              {getEffectiveStudyPass(selectedBookForAction) === 1 ? '（破冰）' : '（重扫未全熟）'}
                            </span>
                            <span className="w-1 h-1 rounded-full bg-[#fae5d3] hidden sm:inline" />
                          <span>当前进度: {selectedBookForAction.progress}%</span>
                            {selectedBookForAction.dailyPlanWords != null && (
                              <>
                                <span className="w-1 h-1 rounded-full bg-[#fae5d3] hidden sm:inline" />
                                <span>每日 {selectedBookForAction.dailyPlanWords} 词</span>
                              </>
                            )}
                          </div>
                          {typeof selectedBookForAction.count === 'number' &&
                            selectedBookForAction.count > 0 &&
                            selectedBookForAction.dailyPlanWords != null &&
                            (() => {
                              const est = estimateFirstPassNodesAndDays(
                                selectedBookForAction.count,
                                selectedBookForAction.dailyPlanWords
                              );
                              return (
                                <div className="space-y-1 text-center md:text-left">
                                  <p className="text-[10px] md:text-xs text-[#b58362]/90 leading-relaxed">
                                    第一轮（破冰）过完整词表粗算约{' '}
                                    <span className="font-bold tabular-nums text-[#1f1e1d]">{est.daysMin}</span> 天（
                                    {est.nodes} 个 5 日节点；按每日推进 1 个循环日计）
                                  </p>
                                  <p className="text-[9px] md:text-[10px] text-[#8c8881] leading-relaxed">
                                    指第一次从词表扫到尾，不是「马上再背一遍」。全书通关后会从 Part A 再开二刷、三刷，遍数与状态保留。
                                  </p>
                                </div>
                              );
                            })()}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div
                          className="covenant-scroll paper-texture relative rounded-sm border-[3px] border-double border-[#a67c52]/50 px-4 py-5 md:px-7 md:py-7"
                          role="region"
                          aria-label="每日背诵立约"
                        >
                          <div
                            className="pointer-events-none absolute top-3 right-3 h-14 w-14 rounded-full border border-[#b03030]/25 bg-[radial-gradient(circle_at_30%_30%,rgba(255,220,200,0.5),transparent_50%),radial-gradient(circle_at_70%_60%,#9a2828,#6a1515)] opacity-[0.18] shadow-inner"
                            aria-hidden
                          />
                          <header className="relative border-b border-[#8b6914]/20 pb-4 text-center">
                            {selectedBookForAction.tag ? (
                              <p className="text-[9px] md:text-[10px] tracking-[0.35em] text-[#7a5c28] font-serif">
                                {selectedBookForAction.tag}
                              </p>
                            ) : null}
                            <p className="mt-1 text-[10px] md:text-xs tracking-[0.55em] text-[#8b6914] font-serif">立书为约</p>
                            <h3 className="mt-2 font-serif text-lg md:text-xl font-bold text-[#2c2417] tracking-wide">每日诵书之契</h3>
                            <p className="mx-auto mt-1.5 max-w-md text-[10px] text-[#8c8881] leading-relaxed">
                              选定「每天背多少词」并确认后，会写进学习计划；仪式感下面三步做完即可。
                            </p>
                            <div className="mx-auto mt-2 max-w-md rounded-lg border border-[#c45c26]/30 bg-[#fff7f0]/90 px-3 py-2.5 text-left">
                              <p className="text-[9px] md:text-[10px] font-bold text-[#8b3418] tracking-wide">
                                严规 · 闯关制（请必读）
                              </p>
                              <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[9px] md:text-[10px] leading-relaxed text-[#5c4030] marker:text-[#b45328]">
                                <li>
                                  选定档位即承诺：须在<strong>北京时间同一自然日</strong>内，把<strong>当日一整批</strong>（词数等于所选
                                  150 / 300 / 1000）在「今日扫词」里<strong>全部过完</strong>。少一个词、或到次日仍未完成整批，一律视为<strong>闯关失败</strong>。
                                </li>
                                <li>
                                  失败时：本书词表<strong>熟度全部打回生词</strong>、遍数清零；<strong>学习统计</strong>（热力图、历史格子等）与<strong>全局累计</strong>一并清空；游标归零；5 日循环锁回第 1 天。只背了一部分，这些记录也不会保留。
                                </li>
                                <li>拿不稳就不要选大档位；一旦下面钤印确认，即按上条执行。</li>
                              </ol>
                            </div>
                            <ol className="mx-auto mt-3 max-w-md list-decimal space-y-1.5 pl-4 text-left text-[10px] md:text-[11px] leading-relaxed text-[#3d3428] marker:text-[#8b6914]">
                              <li>
                                <strong className="text-[#5c4030]">先选一档：</strong>甲 = 每天 150 词，乙 = 300 词，丙 = 1000 词（三选一）。
                              </li>
                              <li>
                                <strong className="text-[#5c4030]">再输入数字：</strong>在横线上输入<strong className="tabular-nums">与你选的档位相同</strong>的数字（例如选 150 就输入 150），防止手滑点错。
                              </li>
                              <li>
                                <strong className="text-[#5c4030]">最后按红钮「钤印」：</strong>表示你确认锁定。锁定后，<strong>本书进度未满 100%</strong>不能改档位；真要改，只能先用「清空进度」再重选。
                              </li>
                            </ol>
                          </header>

                          {typeof selectedBookForAction.count === 'number' && selectedBookForAction.count > 0 && (
                            <div className="relative mt-4 border-l-2 border-[#b58362]/35 pl-3 md:pl-4">
                              <p className="text-[9px] md:text-[10px] font-bold text-[#5c5346]">下面「约多少天」怎么算的？</p>
                              <p className="mt-1 text-[9px] md:text-[10px] leading-relaxed text-[#5c5346]">
                                学习按 <strong>5 天一个小周期</strong>排课；每个周期里大约会新学 <strong>2 × 你选的每日词数</strong>。
                                表里是<strong>第一次把整本书过完一遍（第一轮 / 破冰）</strong>大概要多少<strong>自然日</strong>——按你<strong>每天都完成当天那一环</strong>来粗算。停学几天就会变长，这里不细算。
                              </p>
                              <p className="mt-1.5 text-[9px] md:text-[10px] leading-relaxed text-[#5c5346]">
                                <strong className="text-[#8b4513]">二刷、三刷</strong>要等这本书<strong>第一轮学完（全书通关）</strong>之后才会开始，和表里的天数不是一回事。
                              </p>
                              <p className="mt-2 text-[9px] text-[#7a6a58]">三档对照（本书总词 {selectedBookForAction.count.toLocaleString()}）：</p>
                              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] md:text-[11px] text-[#3d3428]">
                                {(
                                  [
                                    [150, '甲'],
                                    [300, '乙'],
                                    [1000, '丙'],
                                  ] as const
                                ).map(([n, label]) => {
                                  const { daysMin, nodes } = estimateFirstPassNodesAndDays(
                                    selectedBookForAction.count,
                                    n
                                  );
                                  return (
                                    <span key={n} className="tabular-nums">
                                      <span className="font-serif text-[#8b6914]">{label}</span>（{n} 词/天）→ 第一轮约{' '}
                                      <span className="font-bold">{daysMin}</span> 天 · {nodes} 个 5 日周期
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          <div className="mt-5 flex gap-2 md:gap-3">
                            {(
                              [
                                [150, '甲'],
                                [300, '乙'],
                                [1000, '丙'],
                              ] as const
                            ).map(([n, label]) => {
                              const isSelected = selectedBookForAction.dailyPlanWords === n;
                              const planLocked = isDailyPlanLocked(selectedBookForAction);
                              const isPendingChoice = dailyPlanPending === n;
                              return (
                                <button
                                  key={n}
                                  type="button"
                                  disabled={planLocked}
                                  aria-pressed={isSelected}
                                  onClick={() => {
                                    if (planLocked) return;
                                    if (isSelected) return;
                                    setDailyPlanPending(n);
                                    setDailyPlanConfirmInput('');
                                  }}
                                  className={cn(
                                    'flex-1 flex flex-col items-center justify-center gap-1 py-3 md:py-3.5 min-h-[5rem] md:min-h-[5.25rem] rounded border-2 transition-all font-serif',
                                    'bg-[#faf6ec]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]',
                                    isSelected
                                      ? 'border-[#8b5a2b] bg-[#f0e4d4] text-[#2c2417] ring-2 ring-[#a67c52]/50 ring-offset-2 ring-offset-[#f7f2e4] shadow-md'
                                      : 'border-[#c4a574]/45 text-[#6b5b4d] hover:border-[#a67c52]/70 hover:bg-[#fff9f0]',
                                    !isSelected && isPendingChoice && 'ring-2 ring-amber-600/50 ring-offset-2 ring-offset-[#f7f2e4] border-amber-700/40',
                                    planLocked && !isSelected && 'opacity-45 cursor-not-allowed hover:bg-[#faf6ec]/90 hover:border-[#c4a574]/45'
                                  )}
                                >
                                  <span className="text-[10px] md:text-xs tracking-[0.2em] text-[#8b6914]">
                                    {label}（{n} 词/天）
                                  </span>
                                  <span className="flex items-center justify-center gap-1.5">
                                    {isSelected && (
                                      <Check
                                        className="w-4 h-4 text-[#8b5a2b] shrink-0"
                                        strokeWidth={2.75}
                                        aria-hidden
                                      />
                                    )}
                                    <span className={cn('text-sm md:text-base tabular-nums font-bold', isSelected && 'text-[#1f140c]')}>
                                      {n} 词/天
                                    </span>
                                  </span>
                                  {isSelected ? (
                                    <span className="text-[9px] font-bold text-[#8b4513]">当前已选</span>
                                  ) : planLocked ? (
                                    <span className="text-[8px] text-[#9a8b7a]">未满 100% 不能改</span>
                                  ) : isPendingChoice ? (
                                    <span className="text-[8px] font-bold text-amber-900">去下面输入数字</span>
                                  ) : (
                                    <span className="text-[8px] text-[#7a6a58] tabular-nums">
                                      {typeof selectedBookForAction.count === 'number' && selectedBookForAction.count > 0
                                        ? `第一轮约 ${estimateFirstPassNodesAndDays(selectedBookForAction.count, n).daysMin} 天`
                                        : '点选后继续'}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {(() => {
                            const previewDaily =
                              selectedBookForAction.dailyPlanWords ?? dailyPlanPending ?? null;
                            if (previewDaily == null) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => setShowBookCycleScheduleSheet(true)}
                                className="mt-5 w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-[#d4c4b0]/55 bg-[#fdfaf5]/90 text-sm font-serif font-bold text-[#5c4030] shadow-sm hover:bg-[#fff9f0] hover:border-[#a67c52]/45 transition-colors"
                              >
                                <CalendarDays className="w-4 h-4 text-[#b58362] shrink-0" strokeWidth={2} aria-hidden />
                                查看 5 日循环分配
                              </button>
                            );
                          })()}

                          {dailyPlanPending != null && !isDailyPlanLocked(selectedBookForAction) && (
                            <div
                              className="mt-5 space-y-4 border-t border-dashed border-[#a67c52]/35 pt-5"
                              role="region"
                              aria-label="签押钤印确认每日背诵量"
                            >
                              <p className="text-center font-serif text-sm font-bold text-[#2c2417]">确认锁定</p>
                              <p className="mx-auto mt-1 max-w-md text-center text-[10px] text-[#8c8881]">
                                红色按钮 = 最终确认，与上面「签字画押」同一步
                              </p>
                              <p className="text-[11px] md:text-xs leading-relaxed text-[#5c5346]">
                                锁定后，本书将固定为每天背 <strong className="text-[#8b4513]">{dailyPlanPending}</strong> 个词，直到全书进度{' '}
                                <strong>100%</strong>。未满 100% 不能换档；要换请先「清空进度」。
                              </p>
                              {typeof selectedBookForAction.count === 'number' && selectedBookForAction.count > 0 && (
                                <p className="text-center text-[10px] text-[#7a5c3a] font-medium tabular-nums">
                                  {(() => {
                                    const est = estimateFirstPassNodesAndDays(
                                      selectedBookForAction.count,
                                      dailyPlanPending
                                    );
                                    return `按当前档位，第一轮过完本书约 ${est.daysMin} 天（${est.nodes} 个 5 日周期）`;
                                  })()}
                                </p>
                              )}
                              <div className="space-y-2">
                                <label
                                  htmlFor="daily-plan-confirm-input"
                                  className="block text-center text-[10px] text-[#6b5344] leading-relaxed"
                                >
                                  在横线处输入 <span className="text-[#9a2828] font-bold tabular-nums">{dailyPlanPending}</span>（须与所选档位一致）
                                </label>
                                <div className="relative">
                                  <input
                                    id="daily-plan-confirm-input"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="off"
                                    value={dailyPlanConfirmInput}
                                    onChange={(e) => setDailyPlanConfirmInput(e.target.value.replace(/\D/g, ''))}
                                    className="w-full border-0 border-b-2 border-[#8b6914]/35 bg-transparent py-3 text-center font-mono text-xl font-bold tracking-[0.35em] text-[#2c2417] placeholder:text-[#c4b8a8] focus:border-[#9a2828]/55 focus:outline-none focus:ring-0"
                                    placeholder={String(dailyPlanPending)}
                                  />
                                  <div
                                    className="pointer-events-none absolute -bottom-1 left-0 right-0 h-px bg-[#c4a574]/30"
                                    aria-hidden
                                  />
                                </div>
                              </div>
                              <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDailyPlanPending(null);
                                    setDailyPlanConfirmInput('');
                                  }}
                                  className="py-2.5 text-center text-sm font-serif text-[#6b5b4d] underline decoration-[#c4a574]/60 underline-offset-4 hover:text-[#2c2417]"
                                >
                                  返回重选档位
                                </button>
                                <button
                                  type="button"
                                  disabled={dailyPlanConfirmInput.trim() !== String(dailyPlanPending)}
                                  onClick={() => {
                                    if (dailyPlanConfirmInput.trim() !== String(dailyPlanPending)) return;
                                    handleCommitDailyPlan(dailyPlanPending);
                                    setDailyPlanPending(null);
                                    setDailyPlanConfirmInput('');
                                  }}
                                  className={cn(
                                    'wax-seal-interactive group relative mx-auto flex min-h-[5.5rem] w-full max-w-[220px] flex-col items-center justify-center gap-1 rounded-full border-2 border-[#5c1818]/30 sm:mx-0 sm:ml-auto',
                                    'bg-[radial-gradient(circle_at_30%_25%,#e85d5d,#9a2828_45%,#5c1515_90%)]',
                                    'shadow-[0_6px_16px_rgba(90,20,20,0.45),inset_0_2px_8px_rgba(255,200,180,0.25)]',
                                    'text-[#fff8f0] disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale',
                                    'sm:min-w-[200px]'
                                  )}
                                >
                                  <span
                                    className="pointer-events-none absolute inset-0 rounded-full opacity-30 mix-blend-overlay"
                                    style={{
                                      background:
                                        'radial-gradient(circle at 70% 80%, transparent 40%, rgba(0,0,0,0.35) 100%)',
                                    }}
                                    aria-hidden
                                  />
                                  <span className="relative font-serif text-xs font-bold tracking-[0.35em] text-[#ffe8e0] drop-shadow-sm">
                                    钤印确认
                                  </span>
                                  <span className="relative text-[10px] font-bold tracking-wider opacity-95">
                                    锁定每天 {dailyPlanPending} 词
                                  </span>
                                </button>
                              </div>
                            </div>
                          )}

                          {isDailyPlanLocked(selectedBookForAction) && (
                            <div className="mt-5 flex flex-col items-center gap-2 border-t border-dashed border-[#a67c52]/35 pt-4">
                              <div
                                className="flex h-16 w-16 rotate-[-6deg] items-center justify-center rounded border-2 border-[#a82a2a]/55 bg-[radial-gradient(circle_at_35%_30%,rgba(255,220,210,0.35),transparent_45%),linear-gradient(145deg,#c43c3c,#7a1818)] shadow-[0_4px_12px_rgba(120,30,30,0.35),inset_0_1px_0_rgba(255,200,190,0.35)]"
                                aria-hidden
                              >
                                <span className="border border-[#f5c4c4]/50 px-1.5 py-0.5 font-serif text-[11px] font-bold tracking-widest text-[#fff5f0]">
                                  已定
                                </span>
                              </div>
                              <p className="text-center text-[10px] text-[#8b4513]">已锁定：未满全书 100% 不能改每日词量</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3 md:space-y-4">
                        <button
                          type="button"
                          onClick={() => {
                            setWordListSearchDraft('');
                            setWordListQuery('');
                            setShowBookWordList(true);
                            setShowBookActionSheet(false);
                          }}
                          className="w-full py-3.5 md:py-4 bg-white border-2 border-[#fae5d3] text-[#1f1e1d] rounded-xl md:rounded-2xl text-sm md:text-base font-serif font-bold hover:bg-[#FDF6F0] transition-all flex items-center justify-center gap-2 shadow-sm"
                        >
                          <List className="w-4 h-4 md:w-5 md:h-5 text-[#b58362]" strokeWidth={2} />
                          查看词表
                        </button>

                        <button 
                          onClick={() => handleSetAsCurrentGoal(selectedBookForAction)}
                          className="w-full py-4 md:py-5 bg-[#1a1a1a] text-white rounded-xl md:rounded-2xl text-base md:text-lg font-bold hover:bg-black transition-all shadow-lg shadow-black/10"
                        >
                          设为当前攻克目标
                        </button>

                        <div className="flex gap-3 md:gap-4">
                          <button 
                            onClick={() => handleResetProgress(selectedBookForAction.id)}
                            className="flex-1 py-3.5 md:py-4 bg-[#FDF6F0] text-[#8c8881] rounded-xl text-xs md:text-sm font-medium hover:text-[#1f1e1d] transition-all flex items-center justify-center gap-2"
                          >
                          <RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4" /> 清空进度
                        </button>
                        {isUserCustomVocabBook(selectedBookForAction) && (
                          <button 
                            onClick={() => handleDeleteCustomBook(selectedBookForAction.id)}
                            className="flex-1 py-3.5 md:py-4 bg-red-50 text-red-400 rounded-xl text-xs md:text-sm font-medium hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                          >
                            <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" /> 删除该书
                          </button>
                        )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                  </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* 5 日循环分配（独立弹层；勿依赖 showBookActionSheet，避免竞态导致不渲染） */}
        <AnimatePresence>
          {showBookCycleScheduleSheet &&
            selectedBookForAction &&
            (() => {
              const previewDaily =
                selectedBookForAction.dailyPlanWords ?? dailyPlanPending ?? null;
              if (previewDaily == null) return null;
              const fb0 = focusBooks[0];
              const previewBook =
                fb0?.id === selectedBookForAction.id
                  ? { ...selectedBookForAction, ...fb0 }
                  : selectedBookForAction;
              return (
                <motion.div
                  key="book-cycle-schedule-layer"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="book-cycle-schedule-title"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-[85] flex items-end justify-center md:items-center md:p-4"
                >
                  <button
                    type="button"
                    aria-label="关闭"
                    className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
                    onClick={() => setShowBookCycleScheduleSheet(false)}
                  />
                  <motion.div
                    initial={{ y: 36, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 24, opacity: 0 }}
                    transition={{ type: 'spring', damping: 32, stiffness: 380 }}
                    className="relative z-10 flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-[#e8dfd0] border-b-0 bg-[#f5f0e6] shadow-[0_-12px_48px_rgba(0,0,0,0.2)] md:max-h-[40rem] md:rounded-2xl md:border-b"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className="shrink-0 flex items-center justify-between gap-3 border-b border-[#e8dfd0] bg-[#fdfaf5]/95 px-4 pb-3"
                      style={{
                        paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))',
                      }}
                    >
                      <div className="min-w-0">
                        <p className="text-[10px] text-[#b58362] font-bold tracking-widest uppercase truncate">
                          词书排课
                        </p>
                        <h3
                          id="book-cycle-schedule-title"
                          className="text-base font-serif font-bold text-[#1f1e1d] truncate"
                        >
                          5 日循环分配
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowBookCycleScheduleSheet(false)}
                        className="shrink-0 w-10 h-10 rounded-full bg-white/90 border border-[#fae5d3] flex items-center justify-center text-[#8c8881] hover:text-[#1f1e1d] transition-colors"
                        aria-label="关闭"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div
                      className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
                      style={{
                        paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
                      }}
                    >
                      <BookCycleSchedulePreview
                        book={previewBook}
                        dailyPlanWords={previewDaily}
                        variant="sheet"
                      />
                    </div>
                  </motion.div>
                </motion.div>
              );
            })()}
        </AnimatePresence>

        {/* 词表浏览 */}
        <AnimatePresence>
          {showBookWordList && selectedBookForAction && bookWordResolved && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setShowBookWordList(false);
                  setWordListSearchDraft('');
                  setWordListQuery('');
                  setWordListPage(1);
                }}
                className="fixed inset-0 bg-black/25 backdrop-blur-sm z-[75]"
              />
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                className="fixed inset-0 z-[80] flex flex-col bg-[#FDFCF9] md:max-w-2xl md:mx-auto md:my-6 md:rounded-[2rem] md:shadow-2xl md:border md:border-black/5 overflow-hidden"
              >
                <div className="shrink-0 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3 border-b border-[#fae5d3]/80 bg-[#FDFCF9]">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <p className="text-[10px] text-[#b58362] font-bold tracking-widest uppercase truncate">词表</p>
                      <h3 className="text-lg md:text-xl font-serif font-bold text-[#1f1e1d] truncate">{selectedBookForAction.title}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowBookWordList(false);
                        setWordListSearchDraft('');
                        setWordListQuery('');
                        setWordListPage(1);
                      }}
                      className="shrink-0 w-10 h-10 rounded-full bg-[#FDF6F0] flex items-center justify-center text-[#8c8881] hover:text-[#1f1e1d] transition-colors"
                      aria-label="关闭"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  {remoteWordListError && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
                      {remoteWordListError}，已改为示例词。可在项目目录执行 <code className="font-mono text-[10px]">npm run build:vocab</code> 重新生成词表。
                    </p>
                  )}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#b58362]/70 pointer-events-none" />
                    <input
                      type="search"
                      enterKeyHint="search"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      value={wordListSearchDraft}
                      onCompositionStart={() => {
                        wordListComposingRef.current = true;
                      }}
                      onCompositionEnd={(e) => {
                        wordListComposingRef.current = false;
                        const v = e.currentTarget.value;
                        setWordListSearchDraft(v);
                        setWordListQuery(normalizeWordListSearch(v));
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                        setWordListSearchDraft(v);
                        if (!wordListComposingRef.current) {
                          setWordListQuery(normalizeWordListSearch(v));
                        }
                      }}
                      placeholder="搜索单词、释义或音标…"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white border border-[#fae5d3] text-sm text-[#1f1e1d] placeholder:text-[#c4bfb7] focus:outline-none focus:ring-2 focus:ring-[#b58362]/25"
                    />
                  </div>
                  {/* 熟度筛选 Tab */}
                  {bookWordResolved && (
                    <div className="flex gap-1.5 mt-3 overflow-x-auto pb-0.5 hide-scrollbar">
                      {(['all', 'new', 'familiar_70', 'familiar_100'] as const).map((key) => {
                        const labels: Record<typeof key, string> = { all: '全部', new: '生词', familiar_70: '七分熟', familiar_100: '全熟' };
                        const count = wordListStatusCounts[key];
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setWordListStatusFilter(key)}
                            className={cn(
                              'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all',
                              wordListStatusFilter === key
                                ? 'bg-[#b58362] text-white shadow-sm'
                                : 'bg-[#FDF6F0] text-[#8c8881] border border-[#fae5d3] hover:bg-white'
                            )}
                          >
                            {labels[key]}
                            <span className="text-[10px] font-mono opacity-75 tabular-nums">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-2 hide-scrollbar">
                  {showRemoteWordListSpinner ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3 text-[#8c8881]">
                      <Loader2 className="w-8 h-8 animate-spin text-[#b58362]" />
                      <span className="text-sm">正在加载完整词表…</span>
                    </div>
                  ) : (
                    <>
                      {paginatedWordList.map((w) => {
                        const wSt = (w as any).status ?? focusBookStatusMap.get(w.id) ?? null;
                        return (
                          <div
                            key={w.id}
                            className="p-3 md:p-4 rounded-xl bg-white border border-black/5 shadow-[0_1px_0_rgba(0,0,0,0.03)]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0 shrink-0">
                                <span className="text-base md:text-lg font-serif font-bold text-[#1f1e1d]">
                                  {displayWordLowerFirst(w.word)}
                                </span>
                                {wSt === 'familiar_100' && (
                                  <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 leading-none">全熟</span>
                                )}
                                {wSt === 'familiar_70' && (
                                  <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100 leading-none">七分熟</span>
                                )}
                              </div>
                              {w.phonetic ? (
                                <span className="text-[10px] md:text-xs font-mono text-[#b58362]/80 text-right break-all">{w.phonetic}</span>
                              ) : null}
                            </div>
                            {w.meaning ? (
                              <p className="text-xs md:text-sm text-[#5c5852] mt-1.5 leading-relaxed">
                                {stripDuplicateLeadingPhoneticFromMeaning(w.meaning, w.phonetic)}
                              </p>
                            ) : (
                              <p className="text-[10px] md:text-xs text-[#c4bfb7] mt-1.5 italic">释义与音标可在扫词学习时补全</p>
                            )}
                          </div>
                        );
                      })}
                      {!showRemoteWordListSpinner && bookWordFiltered.length === 0 && (
                        <div className="text-center py-16 text-sm text-[#8c8881] px-2 space-y-2">
                          <p>没有匹配的单词，换个关键词试试。</p>
                          <p className="text-xs text-[#c4bfb7]">
                            使用中文输入法时，请先<strong className="text-[#8c8881]">选字上屏</strong>
                            后再看结果；组字过程中的拼音不会参与搜索。
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {wordListTotalPages > 1 && !showRemoteWordListSpinner && (
                  <div className="shrink-0 flex items-center justify-center gap-4 py-2 border-t border-[#fae5d3]/40 bg-[#FDFCF9] text-sm text-[#5c5852]">
                    <button
                      type="button"
                      disabled={wordListPage <= 1}
                      onClick={() => setWordListPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1.5 rounded-lg bg-white border border-[#fae5d3] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#FDF6F0]"
                    >
                      上一页
                    </button>
                    <span className="text-xs font-mono tabular-nums">
                      {wordListPage} / {wordListTotalPages}
                    </span>
                    <button
                      type="button"
                      disabled={wordListPage >= wordListTotalPages}
                      onClick={() => setWordListPage((p) => Math.min(wordListTotalPages, p + 1))}
                      className="px-3 py-1.5 rounded-lg bg-white border border-[#fae5d3] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#FDF6F0]"
                    >
                      下一页
                    </button>
                  </div>
                )}

                <div className="shrink-0 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[#fae5d3]/60 bg-white/80 text-[10px] md:text-xs text-[#8c8881] text-center leading-relaxed space-y-1">
                  {showRemoteWordListSpinner ? (
                    <p>词表文件较大，请稍候…</p>
                  ) : bookWordResolved.isFullCorpus ? (
                    <>
                      <p>
                        共收录 <span className="font-bold text-[#1f1e1d]">{bookWordResolved.list.length}</span> 词（可翻页浏览全部）
                        {(wordListQuery.trim() || wordListStatusFilter !== 'all') && (
                          <> · 筛选结果 <span className="font-bold text-[#1f1e1d]">{bookWordFiltered.length}</span> 条</>
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      全书约 <span className="font-bold text-[#1f1e1d]">{bookWordResolved.totalInBook}</span> 词 · 当前为预览样本{' '}
                      <span className="font-bold text-[#b58362]">{bookWordResolved.list.length}</span> 条
                      {(wordListQuery.trim() || wordListStatusFilter !== 'all') && (
                        <> · 筛选后 {bookWordFiltered.length} 条</>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Import Bottom Sheet */}
        <AnimatePresence>
          {showImportSheet && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowImportSheet(false)}
                className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50"
              />
              <motion.div 
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="fixed bottom-0 left-0 right-0 bg-white rounded-t-[3rem] shadow-2xl z-50 p-8 md:p-12 max-h-[90vh] overflow-y-auto"
              >
                <div className="max-w-2xl mx-auto space-y-8 md:space-y-10">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1 md:space-y-2">
                      <h2 className="text-2xl md:text-3xl font-serif font-bold text-[#1f1e1d]">导入私人词库</h2>
                      <p className="text-[#8c8881] text-[10px] md:text-sm">
                        仅文本文件（.txt / .csv），请使用 UTF-8 编码；在本机解析入库，不联网。
                      </p>
                    </div>
                    <button 
                      onClick={() => setShowImportSheet(false)}
                      className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-[#FDF6F0] flex items-center justify-center text-gray-400 hover:text-black transition-all"
                    >
                      <X className="w-4.5 h-4.5 md:w-5 md:h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div className="p-4 md:p-6 rounded-2xl md:rounded-3xl bg-[#FDF6F0] border border-[#fae5d3] space-y-3 md:space-y-4">
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-white flex items-center justify-center text-[#b58362]">
                        <Wand2 className="w-4.5 h-4.5 md:w-5 md:h-5" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-xs md:text-sm font-bold text-[#1f1e1d]">推荐排版</h4>
                        <p className="text-[10px] md:text-xs text-[#8c8881] leading-relaxed">
                          Tab、竖线 |、多空格分列；行首序号会自动去掉；释义前的 /音标/、[音标] 会写入音标字段，不混进中文释义。
                        </p>
                      </div>
                    </div>
                    <div className="p-4 md:p-6 rounded-2xl md:rounded-3xl bg-[#FDF6F0] border border-[#fae5d3] space-y-3 md:space-y-4">
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-white flex items-center justify-center text-[#b58362]">
                        <BookOpen className="w-4.5 h-4.5 md:w-5 md:h-5" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-xs md:text-sm font-bold text-[#1f1e1d]">兼容行</h4>
                        <p className="text-[10px] md:text-xs text-[#8c8881] leading-relaxed">
                          「词—释义」、词后接中文、一行多词（逗号分隔）等会与上类结果合并；同一词保留更长释义与已有音标。
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="relative group">
                    <input 
                      type="file" 
                      accept=".txt,.csv,text/plain" 
                      onChange={handleLibraryFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="w-full py-8 md:py-12 border-2 border-dashed border-[#fae5d3] rounded-2xl md:rounded-[2.5rem] flex flex-col items-center justify-center space-y-3 md:space-y-4 group-hover:bg-[#FDF6F0] transition-all">
                      {isImporting ? (
                        <>
                          <Loader2 className="animate-spin text-[#b58362] w-7 h-7 md:w-8 md:h-8" />
                          <p className="text-xs md:text-sm font-medium text-[#b58362]">正在解析词库，请稍候...</p>
                        </>
                      ) : feedback ? (
                        <>
                          <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-green-50 flex items-center justify-center text-green-500">
                            <Check className="w-7 h-7 md:w-8 md:h-8" />
                          </div>
                          <p className="text-xs md:text-sm font-medium text-green-600">{feedback}</p>
                        </>
                      ) : (
                        <>
                          <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-[#FDF6F0] flex items-center justify-center text-[#b58362]">
                            <Upload className="w-7 h-7 md:w-8 md:h-8" />
                          </div>
                          <div className="text-center">
                            <p className="text-base md:text-lg font-serif font-bold text-[#1f1e1d]">点击或拖拽文件至此</p>
                            <p className="text-[10px] md:text-xs text-[#8c8881] mt-1">.txt / .csv · UTF-8 · 最大 5MB</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 text-center">
                    <p className="text-[10px] text-[#8c8881] tracking-widest uppercase">Powered by Nuonuo AI Engine</p>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (viewState === 'finished' && activeMode !== 'dictation') {
    const session = finishedScanSummary ?? { new: 0, familiar_70: 0, familiar_100: 0 };
    const sessionTotal = session.new + session.familiar_70 + session.familiar_100;
    const bookLabel = focusBooks[0]?.title?.trim() || '极速扫词';
    const isDailyPlanDoneOnly = scanFinishedReason === 'dailyPlanDone';
    const isPlanSizedBatch = plan.words > 0 && sessionTotal === plan.words;
    const underPlan = plan.words > 0 ? Math.max(0, plan.words - sessionTotal) : 0;
    const planLockedForToday = !!focusBooks[0]?.dailyPlanWords;

    const startExtraBatch = () => {
      if (planLockedForToday) return;
      setScanFinishedReason(null);
      setFinishedScanSummary(null);
      setCorpusBatch(null);
      setViewState('scanning');
      setIntroScanLoading(true);
      setScanSessionTrigger((k) => k + 1);
    };

    const exitToAppHome = () => {
      setScanFinishedReason(null);
      setFinishedScanSummary(null);
      setCorpusBatch(null);
      onRequestHome?.();
    };

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 bg-gradient-to-b from-[#FFFDFB] via-[#FDFCF9] to-[#FAF5F0] paper-texture">
              <motion.div 
          initial={{ scale: 0.96, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="w-full max-w-md bg-white/90 backdrop-blur-sm rounded-3xl md:rounded-[2.5rem] p-6 md:p-10 shadow-[0_20px_50px_-20px_rgba(181,131,98,0.25)] border border-[#f5e6d8] text-center"
        >
          <div className="relative mx-auto mb-6 w-[4.5rem] h-[4.5rem] md:w-20 md:h-20">
            <div
              className="absolute inset-0 rounded-full bg-gradient-to-br from-[#fff9f5] to-[#F8EBE3] shadow-inner border border-[#fae5d3]"
              aria-hidden
            />
            <div className="relative flex h-full w-full items-center justify-center rounded-full ring-2 ring-[#fae5d3]/80 ring-offset-2 ring-offset-white">
              <Check
                className="text-[#b58362] w-[2.1rem] h-[2.1rem] md:w-10 md:h-10"
                strokeWidth={2.5}
                aria-hidden
              />
                  </div>
                  </div>
          <p className="text-[11px] md:text-xs text-[#b58362] font-medium tracking-wide mb-1.5">{bookLabel}</p>
          <h2 className="text-xl md:text-2xl font-serif font-bold text-[#1f1e1d] mb-2 leading-snug">
            {isDailyPlanDoneOnly
              ? '今日扫词计划已完成'
              : `循环第 ${currentDay} 天 · 词汇完成`}
          </h2>
          <p className="text-[10px] md:text-[11px] text-[#a8a29a] mb-2 tracking-wide">
            {isDailyPlanDoneOnly
              ? '本自然日（北京时间）内首组已通关，无需再刷同一计划。'
              : '本次扫词已结束，休息一下吧'}
          </p>
          {!isDailyPlanDoneOnly && (
            <>
              <p className="text-[10px] md:text-xs text-[#8c8881] mb-2 leading-relaxed">
                本批共 <span className="font-semibold text-[#5c5348]">{sessionTotal}</span> 词 · 当前档位 {plan.words} 词/日
              </p>
              <p className="text-[9px] md:text-[10px] text-[#a8a29a] mb-2 leading-relaxed px-1">
                {isPlanSizedBatch
                  ? '本批词数与当日计划档位一致（首组计划批次）。'
                  : underPlan > 0
                      ? `本批较当日档位少 ${underPlan} 词，多见于续学接回或中断后重入。`
                      : '本批词数与当日档位口径存在差异，已按当日档位做严格封顶校准。'}
              </p>
              <p className="text-[9px] md:text-[10px] text-[#a8a29a] mb-8 md:mb-10 leading-relaxed px-1">
                本批已写入本书（含加练）。词条按「5 日循环 · 第 {currentDay} 天」入账；遍数累计跨日不清零。
              </p>

              <div className="grid grid-cols-3 gap-3 md:gap-4 mb-8 md:mb-10">
                <div className="bg-[#FDF6F0]/90 p-3 md:p-4 rounded-xl md:rounded-2xl border border-[#fae5d3]/60">
                  <div className="text-xl md:text-2xl font-serif font-bold text-[#b58362]">{session.new}</div>
                  <div className="text-[8px] md:text-[10px] text-[#8c8881] uppercase tracking-tighter mt-1">生词</div>
                        </div>
                <div className="bg-[#FDF6F0]/90 p-3 md:p-4 rounded-xl md:rounded-2xl border border-[#fae5d3]/60">
                  <div className="text-xl md:text-2xl font-serif font-bold text-[#b58362]">{session.familiar_70}</div>
                  <div className="text-[8px] md:text-[10px] text-[#8c8881] uppercase tracking-tighter mt-1">七分熟</div>
                        </div>
                <div className="bg-[#FDF6F0]/90 p-3 md:p-4 rounded-xl md:rounded-2xl border border-[#fae5d3]/60">
                  <div className="text-xl md:text-2xl font-serif font-bold text-[#b58362]">{session.familiar_100}</div>
                  <div className="text-[8px] md:text-[10px] text-[#8c8881] uppercase tracking-tighter mt-1">全熟</div>
                      </div>
                    </div>
            </>
          )}
          {isDailyPlanDoneOnly && (
            <p className="text-[9px] md:text-[10px] text-[#a8a29a] mb-8 md:mb-10 leading-relaxed px-1">
              今日档位已完成，已禁止继续加练（避免多刷）。
            </p>
          )}

          <div className="flex flex-col gap-3">
          {/* 返回首页按钮已按需移除，统由 header 个人中心或左滑手势处理 */}
          
          <button 
              type="button"
              onClick={startExtraBatch}
              disabled={planLockedForToday}
              className={cn(
                "w-full py-3 md:py-3.5 rounded-full text-sm font-medium border-2 transition-colors flex items-center justify-center gap-2",
                planLockedForToday
                  ? "text-[#b9b2a8] border-[#ece6de] bg-[#f8f6f2] cursor-not-allowed"
                  : "text-[#5c5346] border-[#e8ddd4] bg-white hover:bg-[#faf8f5]"
              )}
          >
              <RotateCcw className="w-4 h-4 opacity-95" /> {planLockedForToday ? '今日已达上限' : '加练一批'}
          </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex-1 flex flex-col min-h-0 bg-[#FDFCF9] paper-texture relative overflow-hidden transition-colors duration-500',
        activeMode === 'dictation' && 'h-full'
      )}
      onPointerDownCapture={() => tryUnlockAudioPlayback()}
    >
      <div 
        className="absolute top-0 left-0 w-full h-1 bg-gray-100/50 z-50 transition-opacity duration-300"
        style={{ opacity: isTimerActive ? 1 : 0 }}
      >
        <motion.div 
          className={cn(
            "h-full bg-[#b58362] origin-left",
            timeLeft < 2 && timeLeft > 0 ? "animate-pulse brightness-75" : ""
          )}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: isTimerActive ? (timeLeft / maxTime) : 0 }}
          transition={{ duration: 0.1, ease: 'linear' }}
        />
      </div>

      {activeMode !== 'dictation' && (
        <div
          className="absolute right-4 z-50 flex flex-col items-end gap-1 max-w-[min(92vw,14rem)]"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
        >
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-[9px] text-[#b58362] tracking-widest uppercase font-serif bg-white/60 backdrop-blur-sm px-3 py-2 rounded-full border border-[#fae5d3] shadow-sm">
              {scanCorpusPending
                ? '…'
                : vocabList.length
                  ? `${safeVocabIndex + 1} / ${vocabList.length}${
                      safeVocabIndex === vocabList.length - 1 ? ' · 最后一词' : ''
                    }`
                  : '—'}
            </div>
            <button
              type="button"
              onClick={togglePause}
              className="w-10 h-10 bg-white/80 backdrop-blur-sm border border-[#fae5d3] rounded-full flex items-center justify-center text-[#b58362] shadow-sm hover:bg-white transition-all shrink-0"
            >
              {isPaused ? (
                <Zap size={18} fill="currentColor" />
              ) : (
                <div className="flex gap-1">
                  <div className="w-1 h-4 bg-current rounded-full" />
                  <div className="w-1 h-4 bg-current rounded-full" />
                </div>
              )}
            </button>
          </div>
          {activeMode === 'review' && reviewBatchHint && (
            <div className="text-[8px] md:text-[9px] text-[#8c8881] bg-white/60 backdrop-blur-sm px-3 py-1.5 rounded-xl border border-[#fae5d3]/70 shadow-sm text-right leading-snug">
              {reviewBatchHint}
            </div>
          )}
          {activeMode === 'scan' &&
            viewState === 'scanning' &&
            !scanCorpusPending &&
            vocabList.length > 0 &&
            corpusBatch !== null && (
              <p className="text-[7px] md:text-[8px] text-[#a8a29a] text-right leading-snug pr-0.5">
                进度会自动保存；再进「今日扫词」可从上次接着背（同一天、同一本书、未换每日词量即可；顶轮天数变了也会尽量续上）。整批完成后才进复习池。
              </p>
            )}
        </div>
      )}

      <div
        ref={containerRef}
        className={cn(
          'flex-1 flex flex-col px-8 relative touch-none',
          activeMode === 'dictation'
            ? 'items-stretch justify-start overflow-y-auto px-0 md:px-4 pt-14 md:pt-16 pb-8 bg-[#FDFBF7] touch-auto min-h-0'
            : 'items-center justify-center',
          !(scanCorpusPending || vocabList.length === 0) &&
            activeMode === 'scan' &&
            'cursor-crosshair'
        )}
        onPointerDown={activeMode === 'dictation' ? undefined : startDrawing}
      >
        {activeMode === 'dictation' ? (
          renderDictationView()
        ) : (
          <AnimatePresence mode="wait">
          <motion.div
            key={
              scanCorpusPending
                ? 'pending'
                : vocabList.length === 0
                  ? 'empty-list'
                  : `word-${safeVocabIndex}`
            }
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ 
              x: timeLeft <= 0.1 ? -500 : 0,
              opacity: 0,
            }}
            className="text-center w-full z-10 relative flex flex-col items-center"
          >
            {scanCorpusPending ? (
              introScanLoading ? (
                <div className="flex flex-col items-center gap-4 py-16 md:py-24">
                  <Loader2 className="animate-spin w-10 h-10 md:w-12 md:h-12 text-[#b58362]" />
                  <p className="text-sm text-[#8c8881]">加载词表…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-5 py-12 md:py-20 px-4 max-w-md mx-auto">
                  {feedback ? (
                    <p className="text-sm text-[#b58362] leading-relaxed">{feedback}</p>
                  ) : (
                    <p className="text-sm text-[#8c8881]">
                      请先在「备考词书库」为主攻书选择每日 150 / 300 / 1000 词。
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIntroScanLoading(true);
                      setScanSessionTrigger((k) => k + 1);
                    }}
                    className="w-full max-w-xs py-3 rounded-full bg-[#1a1a1a] text-white text-sm font-medium"
                  >
                    重试加载
                  </button>
                </div>
              )
            ) : vocabList.length === 0 ? (
              <div className="py-16 md:py-24 text-sm text-[#8c8881] px-4">
                {activeMode === 'scan'
                  ? '当前暂无可扫单词，可切换顶部「5 日循环」天数或回词书库查看进度。'
                  : '当前无复习内容，可切换顶部「5 日循环」天数或返回首页。'}
              </div>
            ) : (
              <>
                {/* 单词区不再横向 drag，避免与画布手写分类抢同一套指针 */}
                <div className="w-full touch-none select-none">
                  <div className="flex justify-center items-center gap-3 mb-3 md:mb-4">
                    {activeMode === 'review' && currentWord?.status && (
                      <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#FDF3E7] text-[11px] md:text-xs text-[#b58362] border border-[#f5e0c8] shadow-[0_0_0_1px_rgba(255,255,255,0.6)]">
                        {currentWord.status === 'new'
                          ? '生词'
                          : currentWord.status === 'familiar_70'
                          ? '七分熟'
                          : currentWord.status === 'familiar_100'
                          ? '全熟'
                          : ''}
                      </div>
                    )}
                    <div className="text-[10px] text-[#b58362] tracking-[0.35em] uppercase font-serif opacity-30">
              Part {Math.floor(safeVocabIndex / 5) + 1}
                    </div>
            </div>
            
                  <div className="relative flex flex-col items-center gap-3 md:gap-4 mb-1 md:mb-2 w-full max-w-2xl mx-auto">
                    <div className="flex items-end justify-center gap-2 md:gap-4 flex-wrap max-w-full">
                      <h1
                        className="text-5xl md:text-8xl font-serif font-bold text-[#1f1e1d] tracking-tight text-center"
                        style={{ fontFamily: '"Times New Roman", serif' }}
                      >
                        {displayWordLowerFirst(currentWord?.word)}
                      </h1>
                    </div>
                    {currentWord?.phonetic ? (
                      <div className="text-base md:text-lg text-[#8c8881] font-serif italic text-center">
                        {currentWord.phonetic}
                      </div>
                    ) : null}
                  </div>
            </div>

                <div className="relative z-30 mt-4 md:mt-6 min-h-[5rem] md:min-h-[6rem] flex flex-col items-center justify-center w-full max-w-lg mx-auto px-2">
              <AnimatePresence>
                {feedback && (
                  <motion.div
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: -40, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute top-0 text-[10px] md:text-sm font-bold text-[#b58362] bg-[#FDF6F0] px-3 py-1 rounded-full border border-[#fae5d3] shadow-sm"
                  >
                    {feedback}
                  </motion.div>
                )}
              </AnimatePresence>

              {showMeaning ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                      className="text-xl md:text-3xl font-serif text-[#b58362] px-1"
                >
                      {stripDuplicateLeadingPhoneticFromMeaning(currentWord?.meaning, currentWord?.phonetic)}
                </motion.div>
              ) : (
                <button 
                      type="button"
                  onClick={() => setShowMeaning(true)}
                      className="relative z-40 text-[10px] md:text-xs text-gray-500 tracking-[0.2em] uppercase hover:text-[#b58362] transition-colors py-3 px-4 rounded-lg"
                >
                  点击查看释义
                </button>
              )}
            </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <canvas
          ref={canvasRef}
          aria-hidden
          className={cn(
            'absolute inset-0 w-full h-full z-20 pointer-events-none touch-none',
            activeMode === 'dictation' ||
              scanCorpusPending ||
              vocabList.length === 0
              ? 'opacity-0'
              : 'opacity-100 cursor-crosshair'
          )}
          style={{ mixBlendMode: 'multiply' }}
        />

        <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-0" style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px)', backgroundSize: '100% 3rem' }}></div>
      </div>

      {activeMode === 'scan' && (
      <div className="h-11 md:h-12 shrink-0 flex items-center justify-around px-2 md:px-4 border-t border-[#f0ede4] bg-white/50 backdrop-blur-sm z-30">
        <motion.div 
          animate={{ scale: currentStatus === 'new' ? 1.08 : 1 }}
          className={cn(
            "flex flex-col items-center gap-0.5 md:gap-1 transition-opacity leading-none",
            currentStatus === 'new' ? "opacity-100" : "opacity-40"
          )}
        >
          <div className="w-5 h-5 md:w-6 md:h-6 rounded-full border border-dashed border-gray-400 flex items-center justify-center">
            <div className="w-3 h-3 md:w-3.5 md:h-3.5 rounded-full border-2 border-gray-400"></div>
          </div>
          <span className="text-[7px] md:text-[8px] tracking-wide text-gray-500">画圈 (生词)</span>
        </motion.div>
        <motion.div 
          animate={{ scale: currentStatus === 'familiar_70' ? 1.08 : 1 }}
          className={cn(
            "flex flex-col items-center gap-0.5 md:gap-1 transition-opacity leading-none",
            currentStatus === 'familiar_70' ? "opacity-100" : "opacity-40"
          )}
        >
          <div className="w-5 h-5 md:w-6 md:h-6 rounded-full border border-dashed border-gray-400 flex items-center justify-center">
            <div className="w-3 h-0.5 md:w-3.5 md:h-0.5 bg-gray-400"></div>
          </div>
          <span className="text-[7px] md:text-[8px] tracking-wide text-gray-500">下划线 (七分熟)</span>
        </motion.div>
        <div className="flex flex-col items-center gap-0.5 md:gap-1 opacity-40 leading-none">
          <div className="w-5 h-5 md:w-6 md:h-6 rounded-full border border-dashed border-gray-400 flex items-center justify-center">
            <Check className="text-gray-400 w-2.5 h-2.5 md:w-3 md:h-3" />
          </div>
          <span className="text-[7px] md:text-[8px] tracking-wide text-gray-500">打勾 (全熟)</span>
      </div>
      </div>
      )}
    </div>
  );

  function renderDictationView() {
    const dictAccent = 'border-[#c5d4b8] bg-[#e8efe3] text-[#2f3d2a]';
    const dictPill =
      'rounded-full px-3 py-2 text-[11px] md:text-xs font-semibold transition-all border border-[#EAEAEA] bg-white/90 text-[#5c5955] hover:bg-[#f7f5f1] active:scale-[0.99] shrink-0';
    const canDictationPlay = audioEnabled !== false && dictationLocalPronunciation;

    const toggleDictationShuffle = () => {
      if (dictationShuffleOn) {
        setDictationShuffleOn(false);
        setDictationShufflePerm([]);
        return;
      }
      const n = dictationFullList.length;
      const arr = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      setDictationShufflePerm(arr);
      setDictationShuffleOn(true);
    };

    const triggerSerialPeek = (w: Word) => {
      if (!dictationInWriteMode || dictationShowResults[w.word]) return;
      setDictationHints((prev) => ({ ...prev, [w.word]: (prev[w.word] ?? 0) + 1 }));
      setDictationPeekWord(w.word);
      if (dictationPeekTimerRef.current) clearTimeout(dictationPeekTimerRef.current);
      dictationPeekTimerRef.current = setTimeout(() => {
        setDictationPeekWord(null);
        dictationPeekTimerRef.current = null;
      }, 2000);
    };

    if (scanCorpusPending) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[16rem] bg-[#FDFBF7] w-full">
          <Loader2 className="animate-spin w-8 h-8 text-[#9aaa8f] opacity-60" />
        </div>
      );
    }
    if (isDictationLoading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[16rem] gap-3 text-[#8c8881] bg-[#FDFBF7] w-full">
          <Loader2 className="animate-spin w-8 h-8 text-[#9aaa8f]" />
          <p className="text-sm font-sans">正在准备全书词表…</p>
        </div>
      );
    }

    const dictationList = orderedDictationList.length > 0 ? orderedDictationList : [];
    const listTitle = focusBooks[0]?.title ?? '词书';
    const doneCount = Object.values(dictationShowResults).filter(Boolean).length;

    if (dictationList.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-[#8c8881] py-20 bg-[#FDFBF7] w-full">
          <div className="w-16 h-16 rounded-full bg-[#f0eee9] border border-[#EAEAEA] flex items-center justify-center mb-4">
            <BookOpen size={24} className="opacity-25 text-[#9aaa8f]" />
          </div>
          <p className="text-sm font-sans tracking-wide">暂无默写任务，请先在词书库选择主攻书</p>
        </div>
      );
    }

    return (
      <div className="w-full max-w-5xl mx-auto min-h-0 flex flex-col bg-[#FDFBF7] animate-in fade-in duration-300">
        <div className="sticky top-0 z-40 bg-[#FDFBF7]/96 backdrop-blur-md border-b border-[#EAEAEA] shadow-[0_1px_0_rgba(0,0,0,0.02)]">
          <div className="px-3 md:px-5 pt-3 pb-2 flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <h1 className="text-xl md:text-2xl font-bold text-[#2a2826] tracking-tight font-sans leading-tight pr-2">
                {listTitle}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={cn(dictPill, !dictationHideChinese && dictAccent)}
                  onClick={() => setDictationHideChinese(false)}
                >
                  中英对照
                </button>
                <button
                  type="button"
                  className={cn(dictPill, dictationHideChinese && dictAccent)}
                  onClick={() => setDictationHideChinese(true)}
                >
                  隐藏中文
                </button>
                <button
                  type="button"
                  className={cn(dictPill, dictationInWriteMode && dictAccent, 'font-bold')}
                  onClick={() => setDictationInWriteMode((v) => !v)}
                >
                  {dictationInWriteMode ? '退出默写' : '进入默写'}
                </button>
                <button
                  type="button"
                  className={cn(dictPill, dictationLocalPronunciation && dictAccent)}
                  onClick={() => setDictationLocalPronunciation((v) => !v)}
                  title={
                    dictationLocalPronunciation
                      ? '点击关闭本页发音'
                      : '点击开启本页发音'
                  }
                >
                  <span className="inline-flex items-center gap-1.5">
                    {dictationLocalPronunciation && audioEnabled !== false ? (
                      <Volume2 className="w-3.5 h-3.5 opacity-80" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5 opacity-80" />
                    )}
                    发音
                  </span>
                </button>
                <button
                  type="button"
                  className={cn(dictPill, dictationShuffleOn && dictAccent)}
                  onClick={toggleDictationShuffle}
                  title="乱序排列"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Shuffle className="w-3.5 h-3.5 opacity-80" />
                    乱序
                  </span>
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8c8881] font-sans pb-1">
              <span>
                已完成{' '}
                <span className="text-[#5a6b52] font-semibold tabular-nums">
                  {doneCount}
                </span>{' '}
                / {dictationList.length}
              </span>
              {Object.keys(dictationHints).length > 0 && (
                <span className="text-[#a8a29a]">已用序号提示累计 {Object.values(dictationHints).reduce((a, b) => a + b, 0)} 次</span>
              )}
            </div>
          </div>

          <div
            className="grid grid-cols-[14px_2.75rem_minmax(0,1fr)_minmax(0,1.85fr)_2.5rem] md:grid-cols-[16px_3rem_minmax(0,1fr)_minmax(0,1.85fr)_2.75rem] gap-x-2 md:gap-x-3 items-end px-3 md:px-5 py-2.5 border-t border-[#EAEAEA] bg-[#f7f5f0]/80"
            role="row"
          >
            <span className="sr-only">状态</span>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-[0.12em] text-[#6b6864] font-sans">
                #
              </span>
            </div>
            <div className="min-w-0 flex flex-col gap-0.5">
              <span className="text-[11px] md:text-xs font-bold text-[#3d3a36] font-sans tracking-wide">Word</span>
              <span className="text-[9px] md:text-[10px] text-[#9aaa8f] font-sans leading-tight">
                点击序号看单词
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-[11px] md:text-xs font-bold text-[#3d3a36] font-sans tracking-wide">Meaning</span>
            </div>
            <div className="text-center">
              {dictationInWriteMode ? (
                <span className="text-[9px] text-[#a8a29a] font-sans hidden md:inline">判定</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pb-24 px-0 md:px-1">
          {dictationList.map((word, idx) => {
            const userInput = dictationInputs[word.word] || '';
            const isFinished = dictationShowResults[word.word];
            const attempted = dictationRowAttempted[word.word];
            const meaningText = stripDuplicateLeadingPhoneticFromMeaning(word.meaning, word.phonetic);
            const showMeaning =
              !dictationHideChinese || dictationMeaningRevealed[word.word];
            const isWrong =
              dictationInWriteMode &&
              attempted &&
              !isFinished &&
              userInput.trim().length > 0 &&
              userInput.trim().toLowerCase() !== word.word.trim().toLowerCase();
            const rowKey = word.id ? `${word.id}-${idx}` : `${word.word}-${idx}`;

            const gutterIcon =
              (word.stuckCycles ?? 0) > 1 ? (
                <AlertCircle className="w-3.5 h-3.5 text-[#c9a227]/80" strokeWidth={1.5} aria-hidden />
              ) : word.review_count != null && word.review_count >= 8 ? (
                <Star className="w-3.5 h-3.5 text-[#c4b896] stroke-[1.5]" aria-hidden />
              ) : null;

            return (
              <div
                key={rowKey}
                role="row"
                className={cn(
                  'grid grid-cols-[14px_2.75rem_minmax(0,1fr)_minmax(0,1.85fr)_2.5rem] md:grid-cols-[16px_3rem_minmax(0,1fr)_minmax(0,1.85fr)_2.75rem] gap-x-2 md:gap-x-3 items-center px-3 md:px-5 py-3 border-b border-[#EAEAEA] transition-colors',
                  'hover:bg-[#f2f0eb]/90',
                  isFinished && 'bg-[#f3f8f1]/70'
                )}
              >
                <div className="flex justify-center">{gutterIcon}</div>

                <button
                  type="button"
                  onClick={() => triggerSerialPeek(word)}
                  disabled={!dictationInWriteMode || isFinished}
                  title={
                    dictationInWriteMode && !isFinished ? '点击闪现单词（计提示）' : undefined
                  }
                  className={cn(
                    'w-8 h-8 md:w-9 md:h-9 rounded-full text-[12px] md:text-sm font-semibold font-sans transition-colors shrink-0 justify-self-center',
                    'bg-[#ebe8e2] text-[#5c5955] border border-[#e3e0da]',
                    dictationInWriteMode && !isFinished && 'hover:bg-[#dfe8d8] hover:border-[#c5d4b8] cursor-pointer',
                    (!dictationInWriteMode || isFinished) && 'opacity-60 cursor-default'
                  )}
                >
                  {idx + 1}
                </button>

                <div className="min-w-0 relative">
                  {dictationInWriteMode ? (
                    <div className="relative">
                      <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={userInput}
                        disabled={isFinished}
                        placeholder={isFinished ? '' : '点击开始默写'}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDictationInputs((prev) => ({ ...prev, [word.word]: val }));
                          if (val.trim().toLowerCase() === word.word.trim().toLowerCase()) {
                            setDictationShowResults((prev) => ({ ...prev, [word.word]: true }));
                            if (canDictationPlay) void pronounceWordPreferHuman(word.word);
                          }
                        }}
                        onBlur={(e) => {
                          const v = e.target.value;
                          setDictationRowAttempted((prev) => ({ ...prev, [word.word]: true }));
                          if (v.trim().toLowerCase() === word.word.trim().toLowerCase()) {
                            setDictationShowResults((prev) => ({ ...prev, [word.word]: true }));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          const v = (e.target as HTMLInputElement).value;
                          setDictationRowAttempted((prev) => ({ ...prev, [word.word]: true }));
                          if (v.trim().toLowerCase() === word.word.trim().toLowerCase()) {
                            setDictationShowResults((prev) => ({ ...prev, [word.word]: true }));
                          }
                        }}
                        className={cn(
                          'w-full rounded-md bg-[#f3f1ec]/80 border-0 px-2 py-2 text-[15px] md:text-base font-sans text-[#2a2826] placeholder:text-[#b0aca5] placeholder:font-normal focus:outline-none focus:ring-1 focus:ring-[#c5d4b8]/80',
                          isFinished && 'text-[#2d6a4f] font-semibold bg-[#eef4ec]'
                        )}
                      />
                      {dictationPeekWord === word.word && (
                        <div
                          className="absolute inset-0 flex items-center px-2 rounded-md bg-[#FDFBF7]/95 border border-[#e8e6e1] pointer-events-none z-10"
                          aria-live="polite"
                        >
                          <span className="font-sans text-[15px] md:text-base font-semibold text-[#2a2826] tracking-wide">
                            {word.word}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => canDictationPlay && void pronounceWordPreferHuman(word.word)}
                      className={cn(
                        'text-left w-full px-1 py-2 rounded-md font-sans text-[15px] md:text-base text-[#2a2826] tracking-wide',
                        canDictationPlay && 'hover:bg-[#f0eee9]/80'
                      )}
                    >
                      {word.word}
                    </button>
                  )}
                </div>

                <div className="min-w-0 pl-0 md:pl-1">
                  {showMeaning ? (
                    <button
                      type="button"
                      onClick={() => canDictationPlay && void pronounceWordPreferHuman(word.word)}
                      className={cn(
                        'text-left w-full rounded-md py-1.5 transition-colors',
                        canDictationPlay && 'hover:bg-[#f0eee9]/60'
                      )}
                    >
                      <DictationMeaningRich text={meaningText} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setDictationMeaningRevealed((prev) => ({
                          ...prev,
                          [word.word]: true,
                        }))
                      }
                      className="w-full min-h-[2.5rem] rounded-md border border-[#EAEAEA] bg-[#f0eee9] px-3 py-2 text-left hover:bg-[#eae8e3] transition-colors"
                      aria-label="点击显示本行中文"
                    >
                      <div
                        className="h-2 rounded-sm bg-[#dcd8d0]"
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(90deg, #cfc9c0 0px, #cfc9c0 6px, transparent 6px, transparent 12px)',
                        }}
                      />
                    </button>
                  )}
                </div>

                <div className="flex justify-center items-center min-h-[2.25rem]">
                  {dictationInWriteMode &&
                    (isFinished ? (
                      <DictationStatusCorrectIcon className="text-emerald-600" />
                    ) : isWrong ? (
                      <DictationStatusWrongIcon className="text-[#c45c5c]" />
                    ) : null)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}
