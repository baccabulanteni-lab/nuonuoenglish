import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './components/UI';
import {
  ChevronLeft,
  Zap,
  RotateCcw,
  BookOpen,
  Bookmark,
  BarChart3,
  X,
  User,
  Languages,
  RotateCw,
  PlayCircle,
  ShieldCheck,
  Activity,
  Volume2,
  PenTool,
} from 'lucide-react';
import { safeJsonParse } from './utils/safeJsonParse';
import {
  VOCAB_STATS_UPDATED_EVENT,
  readMasteredWordCount,
  dispatchVocabStatsUpdated,
} from './utils/vocabStatsEvents';
import { VOCAB_STORAGE_QUOTA_EVENT } from './utils/vocabStorageEvents';
import {
  VOCAB_BACKUP_STORAGE_KEYS,
} from './utils/vocabDataBackup';
import {
  checkCalendarRollover,
  applyDailyChallengeFailureReset,
  applyNewDayAfterSuccess,
  getPrimaryFocusBookId,
  getBookChallenge,
  getMaxUnlockedCycleDay,
  primaryBookHasDailyPlan,
  DAILY_CHALLENGE_EVENT,
} from './utils/dailyChallenge';
import { getBeijingDateKey } from './utils/beijingDate';
import { prefetchBuiltInCorpus } from './utils/vocabCorpusCache';
import { tryUnlockAudioPlayback, cancelEnglishSpeech } from './utils/speakEnglishWord';
import {
  getPronunciationAccent,
  setPronunciationAccent,
  getPronunciationEnabled,
  setPronunciationEnabled,
  getPronunciationRepeatMode,
  setPronunciationRepeatMode,
  type EnglishAccent,
  type PronunciationRepeatMode,
} from './utils/pronunciationAccent';
import AuthScreen from './components/AuthScreen';
import {
  getSavedSession,
  logout,
  snapshotLocalProgress,
  snapshotLocalProgressAsync,
  applyProgressToLocal,
  loadCloudProgress,
  cloudProgressPayloadHasNonDayData,
  type AuthSession,
} from './utils/authClient';
import VocabularyModule from './components/VocabularyModule';
import { getIdbItem } from './utils/idbStorage';

type Tab = 'home' | 'vocabulary' | 'review' | 'library' | 'stats';

export default function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getSavedSession());

  const [authReady, setAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const pendingTabAfterAuthRef = useRef<Tab | null>(null);
  const historyTabRef = useRef<Tab>('home');
  const handlingBrowserBackRef = useRef(false);

  const [challengeResetKey, setChallengeResetKey] = useState(0);
  const [challengeToast, setChallengeToast] = useState<string | null>(null);
  const [challengeLetter, setChallengeLetter] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const [homeStatsTick, setHomeStatsTick] = useState(0);
  const [maxUnlockedCycleDay, setMaxUnlockedCycleDay] = useState(5);

  const [profileOpen, setProfileOpen] = useState(false);
  const [pronunciationAccent, setPronunciationAccentState] = useState<EnglishAccent>(() =>
    getPronunciationAccent()
  );
  const [audioEnabled, setAudioEnabled] = useState<boolean>(() =>
    getPronunciationEnabled()
  );
  const [audioRepeatMode, setAudioRepeatMode] = useState<PronunciationRepeatMode>(() =>
    getPronunciationRepeatMode()
  );

  /** 云同步仍更新状态，供将来扩展；首页不再展示同步指示灯 */
  const [, setSyncStatus] = useState<'synced' | 'syncing' | 'error'>('synced');

  // 云同步上传调度：用“指纹 + debounce”避免重复 upsert。
  const authSessionRef = useRef<AuthSession | null>(null);
  const authReadyRef = useRef(false);
  const lastUploadedFingerprintRef = useRef<string | null>(null);
  const uploadDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const computeLocalVocabFingerprint = (snap: Record<string, string | null>) => {
    // VOCAB_BACKUP_STORAGE_KEYS 的顺序在导出/采集里固定，因此指纹稳定。
    return VOCAB_BACKUP_STORAGE_KEYS.map((k) => `${k}=${snap[k] ?? ''}`).join('|');
  };

  const flushUpload = async () => {
    const s = authSessionRef.current;
    if (!s || !authReadyRef.current || !s.user.licenseActivated) return;
    
    // 异步采集包含 IndexedDB 的完整快照
    const snap = await snapshotLocalProgressAsync();
    const fp = computeLocalVocabFingerprint(snap);
    if (fp === lastUploadedFingerprintRef.current) return;

    setSyncStatus('syncing');
    const ok = await saveCloudProgress(s.token, snap);
    if (ok) {
      lastUploadedFingerprintRef.current = fp;
      setSyncStatus('synced');
    } else {
      setSyncStatus('error');
    }
  };

  const scheduleUpload = () => {
    if (uploadDebounceTimerRef.current) clearTimeout(uploadDebounceTimerRef.current);
    uploadDebounceTimerRef.current = setTimeout(() => {
      void flushUpload();
    }, 1200);
  };

  useEffect(() => {
    authSessionRef.current = authSession;
    authReadyRef.current = authReady;
  }, [authSession, authReady]);

  const refreshStatesFromStorage = useCallback(async () => {
    // 强制重新读取关键状态，确保云端同步后 UI 响应
    try {
      const daySaved = localStorage.getItem('vocab_current_day');
      const dayRaw = daySaved ? parseInt(daySaved, 10) : 1;
      const dayBase = Number.isFinite(dayRaw) && dayRaw >= 1 && dayRaw <= 5 ? dayRaw : 1;
      
      // 优先从 IndexedDB 读取词书，因为大数据会被迁移到那里
      let books = await getIdbItem<unknown[]>('vocab_focus_books');
      
      // 如果 IDB 没有，再看旧的 localStorage
      if (!books) {
        books = safeJsonParse<unknown[] | null>(
          localStorage.getItem('vocab_focus_books'),
          null
        );
      }

      if (books && Array.isArray(books) && books[0] && typeof books[0] === 'object') {
        const b = books[0] as { title?: string, id?: string };
        const bookTitle = typeof b.title === 'string' ? b.title : '糯糯单词';
        const bookId = typeof b.id === 'string' ? b.id : null;
        
        setSelectedBook({ title: bookTitle });
        const max = getMaxUnlockedCycleDay(bookId);
        setCurrentDay(Math.min(dayBase, max));
        setMaxUnlockedCycleDay(max);
      } else {
        setSelectedBook({ title: '糯糯单词' });
        setCurrentDay(dayBase);
      }
      
      setHomeStatsTick(t => t + 1);
    } catch (e) {
      console.error('[Sync] 刷新本地状态失败:', e);
    }
  }, []);

  const handleAuthed = useCallback(
    async (session: AuthSession, isNewUser?: boolean) => {
      setAuthSession(session);

      const resetLocalProgressForNewUser = () => {
        if (typeof localStorage === 'undefined') return;
        for (const k of VOCAB_BACKUP_STORAGE_KEYS) {
          localStorage.removeItem(k);
        }
        localStorage.setItem('vocab_current_day', '1');
      };

      if (isNewUser) {
        try {
          resetLocalProgressForNewUser();
          const initSnap = snapshotLocalProgress();
          lastUploadedFingerprintRef.current = computeLocalVocabFingerprint(initSnap);
          setAuthReady(true);
          void saveCloudProgress(session.token, snapshotLocalProgress()).then((ok) => {
            if (ok) {
              lastUploadedFingerprintRef.current = computeLocalVocabFingerprint(snapshotLocalProgress());
            }
          });
        } catch {
          setSyncStatus('error');
          setAuthReady(true);
        }
      } else {
        setSyncStatus('syncing');
        setAuthReady(true);
        void (async () => {
          try {
            const cloudRes = await loadCloudProgress(session.token);
            if (cloudRes && cloudProgressPayloadHasNonDayData(cloudRes.payload)) {
              console.log('[Sync] 云端发现进度，正在应用到本地...');
              await applyProgressToLocal(cloudRes.payload, cloudRes.updatedAt);
              
              const finalSnap = await snapshotLocalProgressAsync();
              lastUploadedFingerprintRef.current = computeLocalVocabFingerprint(finalSnap);
              
              await refreshStatesFromStorage();
              dispatchVocabStatsUpdated();
              window.dispatchEvent(new Event(DAILY_CHALLENGE_EVENT));
              setSyncStatus('synced');
            } else if (localHasData) {
              console.log('[Sync] 云端为空但本地有数据，正在强制上传初始化云端...');
              const ok = await saveCloudProgress(session.token, localSnap);
              if (ok) {
                lastUploadedFingerprintRef.current = computeLocalVocabFingerprint(localSnap);
                setSyncStatus('synced');
              } else {
                setSyncStatus('error');
              }
            } else {
              console.log('[Sync] 云端和本地均无有效进度。');
              setSyncStatus('synced');
            }
          } catch (e) {
            console.error('[Sync] handleAuthed 捕获异常:', e);
            setSyncStatus('error');
          }
          setHomeStatsTick((t) => t + 1);
        })();
      }

      setChallengeResetKey((k) => k + 1);
      setHomeStatsTick((t) => t + 1);
    },
    [refreshStatesFromStorage]
  );

  const openAuthModal = useCallback((tab?: Tab) => {
    pendingTabAfterAuthRef.current = tab ?? null;
    setAuthModalOpen(true);
  }, []);

  const selectTabFromHome = useCallback(
    (tab: Tab) => {
      if (tab === 'vocabulary' || tab === 'review' || tab === 'library' || tab === 'stats') {
        void tryUnlockAudioPlayback();
      }
      if (!authSession?.user.licenseActivated) {
        openAuthModal(tab);
        return;
      }
      setActiveTab(tab);
    },
    [authSession, openAuthModal]
  );

  const onModalAuthed = useCallback(
    async (session: AuthSession, isNewUser?: boolean) => {
      await handleAuthed(session, isNewUser);
      setAuthModalOpen(false);
      const t = pendingTabAfterAuthRef.current;
      pendingTabAfterAuthRef.current = null;
      if (t && t !== 'home') {
        setActiveTab(t);
      }
    },
    [handleAuthed]
  );

  const handleLogout = useCallback(() => {
    setAuthSession(null);
    setAuthReady(false);
    setActiveTab('home');
    setAuthModalOpen(false);
    pendingTabAfterAuthRef.current = null;
    logout();
  }, []);

  const requestHomeNavigation = useCallback(() => {
    if (activeTab === 'home') return;
    if (typeof window !== 'undefined' && historyTabRef.current !== 'home') {
      handlingBrowserBackRef.current = true;
      window.history.back();
      return;
    }
    setActiveTab('home');
  }, [activeTab]);

  useEffect(() => {
    if (!authSession || !authSession.user.licenseActivated) {
      setAuthReady(true);
      return;
    }
    void handleAuthed(authSession);
  }, [authSession, handleAuthed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const currentState =
      window.history.state && typeof window.history.state === 'object' ? window.history.state : {};

    if (activeTab === 'home') {
      if (handlingBrowserBackRef.current) {
        handlingBrowserBackRef.current = false;
      } else {
        window.history.replaceState({ ...currentState, nuonuoTab: 'home' }, '');
      }
      historyTabRef.current = 'home';
      return;
    }

    if (historyTabRef.current === 'home') {
      window.history.pushState({ ...currentState, nuonuoTab: activeTab }, '');
    } else {
      window.history.replaceState({ ...currentState, nuonuoTab: activeTab }, '');
    }
    historyTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onPopState = () => {
      if (authModalOpen) {
        setAuthModalOpen(false);
        pendingTabAfterAuthRef.current = null;
        return;
      }
      if (profileOpen) {
        setProfileOpen(false);
        return;
      }
      if (activeTab !== 'home') {
        handlingBrowserBackRef.current = true;
        setActiveTab('home');
        return;
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [activeTab, authModalOpen, profileOpen]);

  useEffect(() => {
    if (!authSession || !authReady || !authSession.user.licenseActivated) return;

    const save = async () => {
      const snap = await snapshotLocalProgressAsync();
      const fp = computeLocalVocabFingerprint(snap);
      if (fp === lastUploadedFingerprintRef.current) return;
      void saveCloudProgress(authSession.token, snap)
        .then((ok) => {
          if (ok) lastUploadedFingerprintRef.current = fp;
        })
        .catch(() => {});
    };

    const pull = async () => {
      try {
        setSyncStatus('syncing');
        const cloudRes = await loadCloudProgress(authSession.token);
        if (!cloudRes) {
          setSyncStatus('synced');
          return;
        }

        const localLastSync = localStorage.getItem('nuonuo_last_cloud_sync');
        if (!localLastSync || new Date(cloudRes.updatedAt).getTime() > new Date(localLastSync).getTime()) {
          console.log('[Sync] 检测到云端有更新，正在同步...');
          await applyProgressToLocal(cloudRes.payload, cloudRes.updatedAt);
          
          await refreshStatesFromStorage();
          dispatchVocabStatsUpdated();
          window.dispatchEvent(new Event(DAILY_CHALLENGE_EVENT));
        }
        setSyncStatus('synced');
      } catch (err) {
        console.warn('[Sync] 定时拉取失败:', err);
        setSyncStatus('error');
      }
    };

    const saveTimer = window.setInterval(save, 10000); // 10s 推送一次
    const pullTimer = window.setInterval(pull, 15000); // 15s 拉取一次

    const onVis = () => {
      if (document.visibilityState === 'hidden') save();
      if (document.visibilityState === 'visible') pull(); // 切回页面时也立即尝试拉取
    };

    const onClosing = async () => {
      const snap = await snapshotLocalProgressAsync();
      const fp = computeLocalVocabFingerprint(snap);
      if (fp === lastUploadedFingerprintRef.current) return;
      void saveCloudProgress(authSession.token, snap, { isClosing: true });
    };

    window.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', onClosing);

    return () => {
      window.clearInterval(saveTimer);
      window.clearInterval(pullTimer);
      window.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onClosing);
    };
  }, [authSession, authReady]);

  // 学习数据变更后防抖上传（缩短多设备看到旧数据的时间）
  useEffect(() => {
    const onDirty = () => scheduleUpload();
    if (!authSession || !authReady || !authSession.user.licenseActivated) return;
    window.addEventListener(VOCAB_STATS_UPDATED_EVENT, onDirty);
    window.addEventListener(DAILY_CHALLENGE_EVENT, onDirty);
    window.addEventListener(VOCAB_STORAGE_QUOTA_EVENT, onDirty);
    return () => {
      window.removeEventListener(VOCAB_STATS_UPDATED_EVENT, onDirty);
      window.removeEventListener(DAILY_CHALLENGE_EVENT, onDirty);
      window.removeEventListener(VOCAB_STORAGE_QUOTA_EVENT, onDirty);
      if (uploadDebounceTimerRef.current) clearTimeout(uploadDebounceTimerRef.current);
      uploadDebounceTimerRef.current = null;
    };
  }, [authSession, authReady]);

  // 跨标签页实时同步：监听 localStorage 变更
  useEffect(() => {
    const onStorageChange = (e: StorageEvent) => {
      if (e.key && VOCAB_BACKUP_STORAGE_KEYS.includes(e.key as any)) {
        console.log(`[Sync] 检测到标签页间同步 (${e.key})，正在刷新当前页面状态...`);
        scheduleUpload();
        // 当其他标签页修改了关键 key，本地也需要刷新重绘相关逻辑
        dispatchVocabStatsUpdated();
        window.dispatchEvent(new Event(DAILY_CHALLENGE_EVENT));
        setHomeStatsTick(t => t + 1);
      }
    };
    window.addEventListener('storage', onStorageChange);
    return () => window.removeEventListener('storage', onStorageChange);
  }, []);

  const masteredWordCount = useMemo(
    () => readMasteredWordCount(),
    [homeStatsTick, activeTab]
  );

  const [currentDay, setCurrentDay] = useState<number>(() => {
    try {
      const saved =
        typeof localStorage !== 'undefined' ? localStorage.getItem('vocab_current_day') : null;
      const raw = saved ? parseInt(saved, 10) : 1;
      const base = Number.isFinite(raw) && raw >= 1 && raw <= 5 ? raw : 1;
      const id = getPrimaryFocusBookId();
      const max = getMaxUnlockedCycleDay(id);
      return Math.min(base, max);
    } catch {
      return 1;
    }
  });

  const isScanDay = currentDay === 1 || currentDay === 3;

  useEffect(() => {
    try {
      const saved = localStorage.getItem('vocab_current_day');
      const raw = saved ? parseInt(saved, 10) : 1;
      const base = Number.isFinite(raw) && raw >= 1 && raw <= 5 ? raw : 1;
      const id = getPrimaryFocusBookId();
      const max = getMaxUnlockedCycleDay(id);
      setCurrentDay(Math.min(base, max));
    } catch {
      setCurrentDay(1);
    }
  }, [authSession, authReady]);

  useEffect(() => {
    if (activeTab !== 'vocabulary') return;
    if (isScanDay) return;
    setActiveTab('review');
    setChallengeToast('当前为复习日：已自动进入「循环复习」。');
    window.setTimeout(() => setChallengeToast(null), 2400);
  }, [activeTab, isScanDay]);

  /** 未登录不允许停留在子 Tab（仅首页可浏览；功能一律走登录弹窗） */
  useEffect(() => {
    if (authSession?.user.licenseActivated) return;
    if (activeTab === 'home') return;
    setActiveTab('home');
  }, [authSession?.user.licenseActivated, activeTab]);
  const [dragStart, setDragStart] = useState<{ x: number, y: number, edge: 'left' | 'right' } | null>(null);
  const [selectedBook, setSelectedBook] = useState<{ title: string } | null>(() => {
    try {
      const raw =
        typeof localStorage !== 'undefined' ? localStorage.getItem('vocab_focus_books') : null;
      const books = safeJsonParse<unknown[] | null>(raw, null);
      if (books && Array.isArray(books) && books[0] && typeof books[0] === 'object') {
        const b = books[0] as { title?: string };
        return { title: typeof b.title === 'string' ? b.title : '糯糯单词' };
      }
    } catch {
      /* ignore */
    }
    return { title: '糯糯单词' };
  });

  useEffect(() => {
    const bump = () => setHomeStatsTick((n) => n + 1);
    window.addEventListener(VOCAB_STATS_UPDATED_EVENT, bump);
    window.addEventListener(DAILY_CHALLENGE_EVENT, bump);
    const onVis = () => {
      if (document.visibilityState === 'visible') bump();
    };
    document.addEventListener('visibilitychange', onVis);
    const onQuota = () => {
      setChallengeToast('本地存储已满或不可用，扫词进度可能无法保存。请尝试清理浏览器数据或将每日词量调小。');
      window.setTimeout(() => setChallengeToast(null), 7200);
    };
    window.addEventListener(VOCAB_STORAGE_QUOTA_EVENT, onQuota);
    return () => {
      window.removeEventListener(VOCAB_STATS_UPDATED_EVENT, bump);
      window.removeEventListener(DAILY_CHALLENGE_EVENT, bump);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener(VOCAB_STORAGE_QUOTA_EVENT, onQuota);
    };
  }, []);

  const syncMaxUnlocked = useCallback(() => {
    const id = getPrimaryFocusBookId();
    setMaxUnlockedCycleDay(getMaxUnlockedCycleDay(id));
  }, []);

  useEffect(() => {
    syncMaxUnlocked();
    const onUpd = () => syncMaxUnlocked();
    window.addEventListener(DAILY_CHALLENGE_EVENT, onUpd);
    return () => window.removeEventListener(DAILY_CHALLENGE_EVENT, onUpd);
  }, [syncMaxUnlocked]);

  useEffect(() => {
    syncMaxUnlocked();
  }, [activeTab, syncMaxUnlocked]);

  useEffect(() => {
    if (currentDay > maxUnlockedCycleDay) {
      setCurrentDay(maxUnlockedCycleDay);
      localStorage.setItem('vocab_current_day', String(maxUnlockedCycleDay));
    }
  }, [maxUnlockedCycleDay, currentDay]);

  useEffect(() => {
    prefetchBuiltInCorpus(getPrimaryFocusBookId(), { eager: true });
  }, [activeTab, challengeResetKey]);

  const rolloverToastTimerRef = useRef<number | null>(null);

  const runCalendarRollover = useCallback(() => {
    if (rolloverToastTimerRef.current != null) {
      window.clearTimeout(rolloverToastTimerRef.current);
      rolloverToastTimerRef.current = null;
    }
    const bookId = getPrimaryFocusBookId();
    const result = checkCalendarRollover(bookId);
    if (result.type === 'failure' && bookId) {
      applyDailyChallengeFailureReset(bookId);
      await refreshStatesFromStorage();
      setChallengeResetKey((k) => k + 1);
      setChallengeLetter({
        title: '闯关未达标',
        body: '昨日未在北京时间内完成当日整批扫词。已按约定：本书熟度与进度已清空、学习统计（含热力图）已重置、扫词游标归零、5 日循环回到第 1 日；请先在备考词书库重新选择每日词量（立约）后再开始。',
      });
      syncMaxUnlocked();
      setHomeStatsTick((t) => t + 1);
      return;
    }
    if (result.type === 'newDayAfterSuccess' && bookId) {
      const saved = localStorage.getItem('vocab_current_day');
      const n = saved ? parseInt(saved, 10) : 1;
      const cur = Number.isFinite(n) && n >= 1 && n <= 5 ? n : 1;
      const next = cur >= 5 ? 1 : cur + 1;
      applyNewDayAfterSuccess(bookId, next);
      setCurrentDay(next);
      localStorage.setItem('vocab_current_day', String(next));
      await refreshStatesFromStorage();
      setChallengeLetter({
        title: '新自然日通知',
        body: `新自然日（北京时间）。昨日已完成计划，5 日循环已进入第 ${next} 天；词表仍从书中接续取词。第 1、3 天吃新词，第 2、4 天复习，第 5 天合卷且倒计时减半。`
      });
      setHomeStatsTick((t) => t + 1);
      syncMaxUnlocked();
    }
  }, [syncMaxUnlocked, refreshStatesFromStorage]);

  useEffect(() => {
    runCalendarRollover();
  }, [runCalendarRollover]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') runCalendarRollover();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [runCalendarRollover]);

  useEffect(() => {
    return () => {
      if (rolloverToastTimerRef.current != null) {
        window.clearTimeout(rolloverToastTimerRef.current);
      }
    };
  }, []);

  const handleBookSelect = (book: any) => {
    setSelectedBook(book);
    prefetchBuiltInCorpus(book?.id ?? getPrimaryFocusBookId(), { eager: true });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (activeTab === 'home') return;
    const touch = e.touches[0];
    if (touch.clientX < 40) {
      setDragStart({ x: touch.clientX, y: touch.clientY, edge: 'left' });
      return;
    }
    const vw = window.innerWidth || 0;
    if (vw > 0 && touch.clientX > vw - 40) {
      setDragStart({ x: touch.clientX, y: touch.clientY, edge: 'right' });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragStart || activeTab === 'home') return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - dragStart.x;
    const deltaY = Math.abs(touch.clientY - dragStart.y);

    const shouldExit =
      (dragStart.edge === 'left' && deltaX > 80) ||
      (dragStart.edge === 'right' && deltaX < -80);
    if (shouldExit && deltaY < 40) {
      setActiveTab('home');
      setDragStart(null);
    }
  };

  const handleTouchEnd = () => {
    setDragStart(null);
  };

  const getWrapperBg = () => {
    if (activeTab === 'home') return 'bg-[#F4F3ED]';
    if (activeTab === 'vocabulary') return 'bg-[#FDFCF9]';
    if (activeTab === 'review') return 'bg-[#faf9f6]';
    if (activeTab === 'library') return 'bg-[#FDFCF9]';
    if (activeTab === 'stats') return 'bg-[#F4F3ED]';
    return 'bg-[#F4F3ED]';
  };

  const fullyAuthed = Boolean(authSession?.user.licenseActivated);

  if (fullyAuthed && !authReady) {
    return (
      <div
        className="min-h-[100dvh] w-full flex flex-col items-center justify-center gap-3 bg-[radial-gradient(100%_100%_at_0%_0%,#f7f3ec_0%,#efe9df_62%,#e8e1d6_100%)] text-[#5c4030] px-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="h-8 w-8 rounded-full border-2 border-[#b58362]/30 border-t-[#b58362] animate-spin" aria-hidden />
        <p className="text-sm font-medium text-center">正在同步学习进度…</p>
        <p className="text-[11px] text-[#8c8881] text-center max-w-xs">首次加载会拉取云端备份，请稍候</p>
      </div>
    );
  }

  const isFullBleedTab = activeTab !== 'home' && fullyAuthed;

  return (
    <>
    <div 
      className={cn(
        'flex w-full min-h-[100svh] justify-center items-stretch font-sans text-gray-800 overflow-x-hidden overflow-y-auto',
        isFullBleedTab ? getWrapperBg() : "bg-[#EBE9E0] p-0 md:p-4 lg:p-8"
      )}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className={cn(
        "w-full min-w-0 min-h-0 flex flex-col relative overflow-hidden bg-white",
        isFullBleedTab 
          ? "min-h-[100svh] md:max-w-none border-none shadow-none"
          : "md:max-w-5xl lg:max-w-6xl min-h-[100svh] md:min-h-[100svh] md:rounded-[3rem] shadow-2xl border border-black/5",
        getWrapperBg()
      )}>
        {challengeToast && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[200] max-w-[min(92%,28rem)] px-4 py-2.5 rounded-2xl bg-[#2D3436] text-white text-[10px] md:text-xs text-center leading-relaxed shadow-xl border border-white/10">
            {challengeToast}
          </div>
        )}
        <AnimatePresence>
          {challengeLetter && (
            <motion.div
              className="absolute inset-0 z-[260] flex items-center justify-center p-4 md:p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="absolute inset-0 bg-black/35 backdrop-blur-[1px]" />
              <motion.div
                role="dialog"
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                className="relative w-full max-w-lg rounded-3xl border border-[#d8c2a8] bg-[linear-gradient(180deg,#fffdf8_0%,#f7efe3_100%)] shadow-2xl overflow-hidden"
              >
                <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-[#c79b76] via-[#b58362] to-[#c79b76]" />
                <div className="px-5 pt-6 pb-5 md:px-7 md:pt-7 md:pb-6">
                  <div className="text-[10px] tracking-[0.25em] text-[#9b7a5f] font-bold mb-2">NUONUO LETTER</div>
                  <h3 className="text-xl md:text-2xl font-serif font-bold text-[#3e2d1f] mb-3">
                    {challengeLetter.title}
                  </h3>
                  <p className="text-[13px] md:text-sm leading-relaxed text-[#5e4a39]">
                    {challengeLetter.body}
                  </p>
                  <div className="mt-5 md:mt-6 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setChallengeLetter(null)}
                        className="px-5 py-2.5 rounded-full bg-[#2D3436] text-white text-sm font-semibold hover:bg-black transition-colors"
                      >
                        已阅
                      </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {profileOpen && authSession && (
          <div
            className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/35 backdrop-blur-[1px]"
            onClick={() => setProfileOpen(false)}
          >
            <div
              className="w-full max-w-[95vw] sm:max-w-md md:max-w-lg lg:max-w-xl rounded-3xl border border-black/5 bg-[linear-gradient(180deg,#fffdf8_0%,#f7efe3_100%)] shadow-2xl overflow-hidden max-h-[88dvh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-black/[0.04] bg-white/20 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#b58362] to-[#8c674d] flex items-center justify-center text-white font-serif font-bold text-lg shadow-inner">
                    {authSession.user.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#2c2417] font-serif font-bold text-base leading-tight">
                        {authSession.user.username}
                      </span>
                      {authSession.user.licenseActivated && (
                        <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#fdf2e9] border border-[#f5e0c8] text-[#b58362] opacity-90">
                          <ShieldCheck size={10} strokeWidth={2.5} />
                          <span className="text-[9px] font-bold tracking-tight">VIP</span>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-[#8c8881] font-mono leading-none mt-1 opacity-70">
                      ID: {authSession.user.id}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setProfileOpen(false)}
                  className="rounded-full p-2 text-[#8c8881] hover:bg-black/5 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                <div className="grid grid-cols-1 gap-3">
                  <div className="bg-white/40 backdrop-blur-sm rounded-2xl p-3 border border-black/[0.03] shadow-sm flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-[#8c8881]">
                      <Activity size={14} className="text-[#b58362]/60" />
                      <span className="text-[10px] font-bold tracking-widest uppercase opacity-70">学习状态</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[13px] font-bold text-[#2c2417]">
                        {authSession.user.licenseActivated ? '特权体验中' : '普通模式'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-white/50 backdrop-blur-md rounded-[2rem] p-5 md:p-6 border border-black/[0.04] shadow-sm space-y-6">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1 h-3 bg-[#b58362] rounded-full" />
                    <span className="text-[11px] text-[#2c2417] font-bold tracking-widest uppercase opacity-80">助听偏好 (Listening Preferences)</span>
                  </div>

                  {/* Accent Preference */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="w-8 h-8 rounded-xl bg-[#b58362]/10 flex items-center justify-center text-[#b58362]">
                        <Languages size={18} strokeWidth={1.5} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[12px] font-bold text-[#2c2417]">单词口音 (Accent)</span>
                        <span className="text-[9px] text-[#8c8881] opacity-60 italic">优先播真人 MP3 录音</span>
                      </div>
                    </div>
                    <div className="flex h-9 min-w-[140px] items-center bg-black/[0.03] rounded-full p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
                      <button
                        type="button"
                        onClick={() => {
                          setPronunciationAccent('us');
                          setPronunciationAccentState('us');
                          cancelEnglishSpeech();
                        }}
                        className={cn(
                          'flex-1 h-full flex items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300',
                          pronunciationAccent === 'us' ? 'bg-[#b58362] text-white shadow-md' : 'text-[#8c8881] hover:text-gray-600'
                        )}
                      >
                        美音
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPronunciationAccent('uk');
                          setPronunciationAccentState('uk');
                          cancelEnglishSpeech();
                        }}
                        className={cn(
                          'flex-1 h-full flex items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300',
                          pronunciationAccent === 'uk' ? 'bg-[#b58362] text-white shadow-md' : 'text-[#8c8881] hover:text-gray-600'
                        )}
                      >
                        英音
                      </button>
                    </div>
                  </div>

                  {/* Repeat Mode Preference */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="w-8 h-8 rounded-xl bg-[#b58362]/10 flex items-center justify-center text-[#b58362]">
                        <RotateCw size={18} strokeWidth={1.5} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[12px] font-bold text-[#2c2417]">播放模式 (Repeat)</span>
                        <span className="text-[9px] text-[#8c8881] opacity-60 italic">自动放映时的朗读逻辑</span>
                      </div>
                    </div>
                    <div className="flex h-9 min-w-[140px] items-center bg-black/[0.03] rounded-full p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
                      <button
                        type="button"
                        onClick={() => {
                          setPronunciationRepeatMode('once');
                          setAudioRepeatMode('once');
                        }}
                        className={cn(
                          'flex-1 h-full flex items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300',
                          audioRepeatMode === 'once' ? 'bg-[#b58362] text-white shadow-md' : 'text-[#8c8881] hover:text-gray-600'
                        )}
                      >
                        朗读一次
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPronunciationRepeatMode('loop');
                          setAudioRepeatMode('loop');
                        }}
                        className={cn(
                          'flex-1 h-full flex items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300',
                          audioRepeatMode === 'loop' ? 'bg-[#b58362] text-white shadow-md' : 'text-[#8c8881] hover:text-gray-600'
                        )}
                      >
                        重复循环
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 pt-4 sm:pt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      requestHomeNavigation();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-[#b58362] text-white text-[13px] font-bold hover:bg-[#a67556] transition-all"
                  >
                    返回首页 Home
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      handleLogout();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[#f8f6f2] text-[#8c8881] text-[12px] font-medium transition-all"
                  >
                    退出登录 Logout
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab !== 'home' && fullyAuthed && (
          <div className="h-14 md:h-16 flex items-center justify-between px-4 md:px-6 shrink-0 z-20 bg-inherit border-b border-black/5 md:border-none">
            <button 
              onClick={requestHomeNavigation} 
              className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center rounded-2xl bg-white/40 backdrop-blur-md border border-black/5 hover:scale-105 transition-all shadow-sm group"
            >
              <ChevronLeft size={22} className="text-[#8c8881] group-hover:text-[#b58362]" />
            </button>
            <div className="flex items-center gap-2 md:gap-4">
              <div className="flex items-center bg-black/5 rounded-full px-2 md:px-3 py-1">
                <span className="text-[10px] font-bold text-gray-500 mr-2">循环</span>
                {[1, 2, 3, 4, 5].map((d) => (
                  <span
                    key={d}
                    className={cn(
                      'w-5 h-5 rounded-full text-[9px] flex items-center justify-center',
                      currentDay === d ? 'bg-[#b58362] text-white' : 'text-[#b58362]/40 bg-[#b58362]/5'
                    )}
                  >
                    {d}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!authSession?.user.licenseActivated) {
                    openAuthModal();
                    return;
                  }
                  setProfileOpen(true);
                }}
                className="text-[10px] md:text-xs text-[#8c8881] underline uppercase tracking-tighter"
              >
                个人 Profile
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 relative flex flex-col min-h-0">
          {activeTab === 'home' && (
            <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
              <HomeCover
                onSelect={selectTabFromHome}
                isFullyAuthed={fullyAuthed}
                onRequestSignIn={openAuthModal}
                selectedBook={selectedBook}
                currentDay={currentDay}
                maxUnlockedCycleDay={maxUnlockedCycleDay}
                masteredWordCount={masteredWordCount}
                homeStatsTick={homeStatsTick}
              />
            </div>
          )}
          {activeTab === 'vocabulary' && fullyAuthed && (
            <div className="flex flex-1 flex-col min-h-0 h-full">
              <VocabularyModule
                key={challengeResetKey}
                mode="scan"
                currentDay={currentDay}
                accent={pronunciationAccent}
                audioEnabled={audioEnabled}
                audioRepeatMode={audioRepeatMode}
                onRequestHome={requestHomeNavigation}
              />
            </div>
          )}
          {activeTab === 'review' && fullyAuthed && (
            <div className="flex flex-1 flex-col min-h-0 h-full">
              <VocabularyModule
                key={challengeResetKey}
                mode="review"
                currentDay={currentDay}
                accent={pronunciationAccent}
                audioEnabled={audioEnabled}
                audioRepeatMode={audioRepeatMode}
                onRequestHome={requestHomeNavigation}
              />
            </div>
          )}
          {activeTab === 'library' && fullyAuthed && (
            <div className="flex flex-1 flex-col min-h-0 h-full">
              <VocabularyModule
                key={`lib-${challengeResetKey}`}
                mode="library"
                onBookSelect={handleBookSelect}
                accent={pronunciationAccent}
                audioEnabled={audioEnabled}
                audioRepeatMode={audioRepeatMode}
                onRequestHome={requestHomeNavigation}
              />
            </div>
          )}
          {activeTab === 'stats' && fullyAuthed && (
            <div className="flex flex-1 flex-col min-h-0 h-full">
              <VocabularyModule
                key={challengeResetKey}
                mode="stats"
                accent={pronunciationAccent}
                audioEnabled={audioEnabled}
                audioRepeatMode={audioRepeatMode}
                onRequestHome={requestHomeNavigation}
              />
            </div>
          )}
        </div>
      </div>
    </div>

    <AnimatePresence>
      {authModalOpen && (
        <motion.div
          key="auth-modal-layer"
          className="fixed inset-0 z-[600] flex items-center justify-center p-3 sm:p-6 bg-black/45 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setAuthModalOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-md md:max-w-lg max-h-[min(92dvh,880px)] overflow-hidden rounded-[2.2rem] shadow-[0_32px_80px_-24px_rgba(0,0,0,0.45)] border border-[#d8cab8]/80"
            onClick={(e) => e.stopPropagation()}
          >
            <span id="auth-modal-title" className="sr-only">
              登录糯糯单词
            </span>
            <AuthScreen
              embedded
              onDismiss={() => setAuthModalOpen(false)}
              onAuthed={onModalAuthed}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}

function HomeCover({
  onSelect,
  isFullyAuthed,
  onRequestSignIn,
  selectedBook,
  currentDay,
  maxUnlockedCycleDay,
  masteredWordCount,
  homeStatsTick,
}: {
  onSelect: (tab: Tab) => void;
  isFullyAuthed: boolean;
  onRequestSignIn: (tab?: Tab) => void;
  selectedBook: { title: string } | null;
  currentDay: number;
  maxUnlockedCycleDay: number;
  masteredWordCount: number;
  homeStatsTick: number;
}) {
  const isScanDay = currentDay === 1 || currentDay === 3;
  const bookId = getPrimaryFocusBookId();
  const todaysPrimaryScanDone =
    primaryBookHasDailyPlan() &&
    bookId != null &&
    getBookChallenge(bookId).completedOnDate === getBeijingDateKey();
  
  const [rulesModalOpen, setRulesModalOpen] = useState(false);

  const hasReviewTask = currentDay === 2 || currentDay === 4 || currentDay === 5;
  const currentPart = currentDay <= 2 ? 'Part A' : (currentDay <= 4 ? 'Part B' : 'Part A + B');
  return (
    <div className="flex flex-col bg-[#F4F3ED] h-full overflow-hidden select-none">
      {/* 1. 独立置顶的 Header 容器 */}
      <header className="flex-none px-6 sm:px-12 md:px-20 pt-4 sm:pt-8 pb-6 sm:pb-10 w-full max-w-7xl mx-auto flex items-center justify-between relative z-10 gap-3">
        {/* 左上角：占位 */}
        <div className="hidden sm:block" />

        {/* 右上角：状态组件 */}
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-black/5 rounded-full px-3 py-1.5 backdrop-blur-sm border border-black/5 shadow-inner">
            <span className="text-[10px] font-bold text-gray-500 mr-2.5 uppercase tracking-tighter shrink-0 opacity-60">Cycle</span>
            {[1, 2, 3, 4, 5].map((d) => (
              <span
                key={d}
                className={cn(
                  'w-5 h-5 rounded-full text-[9px] flex items-center justify-center shrink-0 mx-0.5 font-mono transition-all',
                  currentDay === d ? 'bg-[#b58362] text-white shadow-md scale-110' : 'text-[#b58362]/40 bg-[#b58362]/5'
                )}
              >
                {d}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!isFullyAuthed) {
                onRequestSignIn();
                return;
              }
              setRulesModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/5 bg-white/90 px-3.5 py-1.5 text-[10px] font-bold text-[#8b5a3c] shadow-sm hover:shadow-md hover:bg-[#fff9f4] transition-all active:scale-95 backdrop-blur-md"
          >
            闯关规则
          </button>
          {!isFullyAuthed && (
            <button
              type="button"
              onClick={() => onRequestSignIn()}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#b58362]/40 bg-[#b58362] px-3.5 py-1.5 text-[10px] font-bold text-white shadow-sm hover:brightness-95 transition-all active:scale-95"
            >
              登录
            </button>
          )}
        </div>
      </header>

      <AnimatePresence>
        {rulesModalOpen && (
          <motion.div
            key="home-rules-modal"
            className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
              onClick={() => setRulesModalOpen(false)}
            />
            <motion.div
              role="dialog"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-3xl bg-[#F9F8F4] shadow-2xl border border-black/5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/5 px-6 py-4">
                <h2 className="font-serif text-lg font-bold text-[#2c2417] tracking-wide">
                  闯关规则
                </h2>
                <button
                  type="button"
                  onClick={() => setRulesModalOpen(false)}
                  className="rounded-full p-2 text-[#8c8881] hover:bg-black/5 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-left text-sm leading-relaxed text-[#5c5346] space-y-5">
                <section className="space-y-2">
                  <p className="font-bold text-[#2c2417]">1. 承诺（立约）</p>
                  <ul className="list-disc space-y-2 pl-5 text-[13px] text-[#5c5346]">
                    <li>
                      在「备考词书库」里为本书选定每日{' '}
                      <span className="tabular-nums font-medium text-[#3d3428]">150 / 300 / 1000</span>{' '}
                      词，并完成钤印确认后，即视为<strong className="text-[#5c4030]">立约</strong>：你承诺按该档位完成每日闯关。
                    </li>
                    <li>
                      <strong className="text-[#5c4030]">当日一整批</strong>：词数必须等于所选档位；须在
                      <strong className="text-[#5c4030]">北京时间下的同一自然日</strong>
                      内，在「今日扫词」里把这一批<strong className="text-[#5c4030]">全部过完</strong>。是否记成生词/熟词不影响「过没过完」的判定；以<strong className="text-[#5c4030]">整批扫词正常结束</strong>为准。
                    </li>
                    <li>
                      当日<strong className="text-[#5c4030]">少扫一个词</strong>，或<strong className="text-[#5c4030]">拖到第二天</strong>才把前一日的整批补完，均视为<strong className="text-[#5c4030]">当日未达标</strong>。
                    </li>
                  </ul>
                </section>
                <section className="space-y-2">
                  <p className="font-bold text-[#2c2417]">2. 惩罚（闯关失败）</p>
                  <ul className="list-disc space-y-2 pl-5 text-[13px] text-[#5c5346]">
                    <li>
                      当<strong className="text-[#5c4030]">北京日历进入新的一天</strong>时，若系统判定你在<strong className="text-[#5c4030]">上一自然日</strong>未完成「当日一整批」，即判定为<strong className="text-[#5c4030]">闯关失败</strong>。
                    </li>
                    <li>
                      失败后将<strong className="text-[#5c4030]">按约定重置</strong>，包括但不限于：本书词表<strong className="text-[#5c4030]">熟度与进度清零</strong>、学习<strong className="text-[#5c4030]">轮次回到第 1 轮</strong>（内置书已合并进度的词表会一并清空）、<strong className="text-[#5c4030]">每日立约解除</strong>（须重新选档并钤印）、<strong className="text-[#5c4030]">学习统计</strong>（含热力图等）<strong className="text-[#5c4030]">清空</strong>、扫词<strong className="text-[#5c4030]">游标归零</strong>、<strong className="text-[#5c4030]">5 日循环回到第 1 天</strong>，以及相关续学快照清理等。
                    </li>
                    <li className="text-[#7a6a58]">
                      发音偏好等全局设置一般不在此列；规则意在「背单词进度」上破釜沉舟，请量力而行再选大档。
                    </li>
                  </ul>
                </section>
                <section className="space-y-2">
                  <p className="font-bold text-[#2c2417]">3. 循环（自然日与 5 日课表）</p>
                  <ul className="list-disc space-y-2 pl-5 text-[13px] text-[#5c5346]">
                    <li>
                      <strong className="text-[#5c4030]">自然日</strong>一律按<strong className="text-[#5c4030]">北京时间</strong>划分；跨午夜以北京日期为准，而不是你电脑/手机系统时区单独说了算。
                    </li>
                    <li>
                      若<strong className="text-[#5c4030]">昨日已通关</strong>，新自然日到来后，应用会按规则把<strong className="text-[#5c4030]">5 日循环推进到下一天</strong>（第 5 日之后回到第 1 日）。课表节奏为：第 1、3 日偏重新词批次，第 2、4 日对应复习，第 5 日合卷复习等（与词书内说明一致）。
                    </li>
                    <li>
                      在<strong className="text-[#5c4030]">未解锁</strong>更高循环日前，界面会把你限制在已解锁的循环日内；<strong className="text-[#5c4030]">坚持每日达标</strong>，才能稳定向前推进。
                    </li>
                  </ul>
                </section>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn(
        "flex-1 w-full max-w-[1500px] mx-auto overflow-hidden min-h-0 pt-0 px-4 sm:px-8 md:px-[clamp(1rem,5vw,6rem)]",
        // Space distribution
        "pb-4 sm:pb-8 lg:pb-[clamp(1rem,5vw,6rem)]"
      )}>
        <div className={cn(
          "grid grid-cols-1 lg:grid-cols-5 h-full min-h-0",
          // Gap: Fluid between 12px and 40px
          "gap-[clamp(0.75rem,2vw,2.5rem)]",
          // Heights: Maximize one-screen feel
          "max-h-full lg:max-h-[75vh]"
        )}>
          
          {/* 左侧：画报式主卡片 (Today Focus) */}
          <div className="flex flex-col h-full min-h-0 group lg:col-span-3 relative">
            <div 
              onClick={() => {
                if (!isFullyAuthed) {
                  onRequestSignIn('vocabulary');
                  return;
                }
                if (isScanDay) onSelect('vocabulary');
              }}
              className={cn(
                "flex-1 p-6 sm:p-8 lg:p-[clamp(1.5rem,3vw,3rem)] relative shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden rounded-[2.5rem] md:rounded-[3.5rem] border border-white/5",
                !isFullyAuthed || isScanDay
                  ? "bg-[#2D3436] cursor-pointer hover:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.4)]"
                  : "bg-[#4a4540] cursor-not-allowed grayscale-[0.3]"
              )}
            >
              {/* 艺术背景 */}
              <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-gradient-to-br from-white to-transparent rounded-full blur-[120px]" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-gradient-to-tl from-[#b58362] to-transparent rounded-full blur-[150px]" />
              </div>

              {/* Layout Container */}
              <div className="flex h-full w-full relative z-10">
                {/* Left Area: Vertical Sidebar */}
                <div className="flex flex-col items-center justify-center shrink-0 border-r border-white/5 pr-4 mr-6 md:mr-10 py-6">
                  <span className="text-[10px] tracking-[0.5em] font-mono font-bold text-[#b58362] origin-center -rotate-90 whitespace-nowrap opacity-60">
                    TODAY
                  </span>
                  <div className="flex-1 w-[1px] bg-gradient-to-b from-[#b58362]/30 via-[#b58362]/10 to-transparent mt-12 mb-4"></div>
                </div>

                {/* Main Content Area: Balanced Flex Column */}
                <div className="flex-1 flex flex-col min-w-0">
                  {/* Top: Header Label */}
                  <div className="mb-8 shrink-0">
                    <span className="inline-block text-[10px] tracking-[0.3em] font-sans font-black text-[#b58362] uppercase px-3 py-1.5 rounded-full bg-white/5 border border-white/10 shadow-sm">
                      New Mission
                    </span>
                  </div>

                  {/* Middle: Controlled Typography with Fluid Scalability */}
                  <div className="flex-1 flex flex-col justify-center min-h-0 py-2">
                    <h2 className="font-serif text-white tracking-tight leading-tight font-normal italic drop-shadow-2xl">
                      <div className="text-[clamp(1.4rem,4vw,2.8rem)] not-italic font-sans font-bold text-white/90 mb-1">
                        {selectedBook?.title?.includes('雅思') ? 'IELTS' : (selectedBook?.title || 'IELTS')}
                      </div>
                      <div className="text-[clamp(1.8rem,5vw,3.6rem)] text-white">
                        {selectedBook?.title?.includes('雅思') ? '雅思词汇' : '词汇学习'}
                      </div>
                      <div className="not-italic text-[clamp(9px,1.2vw,12px)] font-sans font-light opacity-30 mt-4 tracking-[0.1em] uppercase">
                        Current focus / {currentPart}
                      </div>
                    </h2>
                  </div>

                  {/* Bottom: Modern Status Bar */}
                  <div className="mt-8 pt-6 border-t border-white/5 shrink-0">
                    <div className="flex flex-col gap-2 group/status cursor-default">
                      <span className="text-[#b58362] text-[9px] tracking-[0.4em] font-mono font-bold uppercase opacity-50">Progress status</span>
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)] animate-pulse"></div>
                        <span className="text-white/60 text-[10px] md:text-xs lg:text-sm font-serif italic tracking-wide">
                          {!isFullyAuthed
                            ? '登录后开始今日任务'
                            : todaysPrimaryScanDone
                              ? 'Completed'
                              : `Day ${currentDay} Sequence`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className={cn(
                "absolute bottom-8 right-8 md:bottom-12 md:right-12 w-16 h-16 md:w-24 md:h-24 lg:w-28 lg:h-28 rounded-full flex items-center justify-center text-white",
                !isFullyAuthed || isScanDay
                  ? "bg-[#b58362] shadow-[0_0_50px_rgba(181,131,98,0.4)] group-hover:scale-110 group-hover:rotate-12"
                  : "bg-white/10"
              )}>
                <Zap className="w-5 h-5 md:w-8 md:h-8 lg:w-12 lg:h-12" fill="currentColor" />
              </div>
            </div>
          </div>

          {/* 右侧：Bento Grid (Functional Cards) */}
          <div className={cn(
            "grid gap-4 lg:gap-6 min-h-0 lg:col-span-2 h-full content-stretch",
            // Landscape Grid (2x2 layout with 3rd item spanning)
            "lg:grid-cols-2",
            // Tablet Portrait Grid (1x3 row)
            "md:grid-cols-3 md:grid-rows-1",
            // Mobile Stack
            "grid-cols-1"
          )}>
            {/* 01: Review */}
            <div 
              onClick={() => {
                if (!isFullyAuthed) {
                  onRequestSignIn('review');
                  return;
                }
                if (hasReviewTask) onSelect('review');
              }}
              className={cn(
                "group relative rounded-[2.5rem] p-5 sm:p-6 lg:p-[clamp(1rem,2.5vw,1.5rem)] flex flex-col justify-between overflow-hidden shadow-lg border border-white/10",
                "bg-gradient-to-br from-[#D57E5F] to-[#C36340] cursor-pointer hover:shadow-2xl hover:translate-y-[-4px]",
                isFullyAuthed && !hasReviewTask && "opacity-90 saturate-[0.8]"
              )}
            >
              <div className="flex justify-between items-start relative z-10 opacity-40 group-hover:opacity-60 transition-opacity">
                <span className="text-[9px] font-bold tracking-[0.2em] text-white uppercase font-sans">Retention Queue</span>
                <RotateCcw className="w-4 h-4 text-white" strokeWidth={1.5} />
              </div>
              
              <div className="relative z-10 text-left mt-auto">
                <h3 className="text-[clamp(1.1rem,1.5vw,1.8rem)] font-serif font-bold text-white tracking-widest mb-0.5 sm:mb-1 leading-tight">循环复习</h3>
                <p className="text-white/70 text-[clamp(9px,1vw,11px)] font-medium tracking-wide leading-tight">
                  {!isFullyAuthed ? '登录后进入复习' : hasReviewTask ? `高压放映：${currentPart}` : '队列处于静息状态'}
                </p>
              </div>
              <span className="absolute bottom-[-10%] right-2 text-white/[0.03] text-[clamp(4rem,8vw,8rem)] font-serif font-black italic tracking-tighter select-none pointer-events-none z-0">01</span>
            </div>

            {/* 02: Library */}
            <div 
              onClick={() => onSelect('library')}
              className="group relative rounded-[2.5rem] p-5 sm:p-6 lg:p-[clamp(1rem,2.5vw,1.5rem)] flex flex-col justify-between overflow-hidden shadow-lg border border-[#b58362]/20 bg-[#f9f7f4] cursor-pointer hover:shadow-2xl hover:translate-y-[-4px]"
            >
              <div className="flex justify-between items-start relative z-10 opacity-30 group-hover:opacity-50 transition-opacity">
                <span className="text-[9px] font-bold tracking-[0.2em] text-[#b58362] uppercase font-sans">Vocabulary Index</span>
                <BookOpen className="w-4 h-4 text-[#b58362]" strokeWidth={1.5} />
              </div>

              <div className="relative z-10 text-left mt-auto">
                <h3 className="text-[clamp(1.1rem,1.5vw,1.8rem)] font-serif font-bold text-[#2D3436] tracking-widest mb-0.5 sm:mb-1 leading-tight">词书库</h3>
                <p className="text-[#b58362]/80 text-[clamp(9px,1vw,11px)] font-medium tracking-wide italic leading-tight uppercase">Curated Classic</p>
              </div>
              <span className="absolute bottom-[-10%] right-2 text-[#b58362]/[0.05] text-[clamp(4rem,8vw,8rem)] font-serif font-black italic tracking-tighter select-none pointer-events-none z-0">02</span>
            </div>

            {/* 03: Stats */}
            <div 
              onClick={() => onSelect('stats')}
              className={cn(
                "group relative rounded-[2.5rem] p-5 sm:p-6 lg:p-[clamp(1rem,2.5vw,1.5rem)] flex flex-col justify-between overflow-hidden shadow-lg border border-black/5 bg-white cursor-pointer hover:shadow-2xl hover:translate-y-[-4px]",
                "lg:col-span-2"
              )}
            >
              <div className="flex justify-between items-start relative z-10 opacity-20 group-hover:opacity-40 transition-opacity">
                <span className="text-[9px] font-bold tracking-[0.2em] text-[#8c8881] uppercase font-sans">Growth Analytics</span>
                <BarChart3 className="w-4 h-4 text-[#8c8881]" strokeWidth={1.5} />
              </div>

              <div className="relative z-10 text-left mt-auto">
                <h3 className="text-[clamp(1.1rem,1.5vw,1.8rem)] font-serif font-bold text-[#2D3436] tracking-widest mb-0.5 sm:mb-1 leading-tight">学习统计</h3>
                <p className="text-[#8c8881] text-[clamp(9px,1vw,11px)] font-medium tracking-wide leading-tight">
                  {isFullyAuthed ? `全熟累计：${masteredWordCount} 词` : '登录后查看学习数据'}
                </p>
              </div>
              <span className="absolute bottom-[-10%] right-2 text-black/[0.03] text-[clamp(4rem,8vw,8rem)] font-serif font-black italic tracking-tighter select-none pointer-events-none z-0">03</span>
            </div>
          </div>
        </div>
      </div>

      {/* 底部页脚 */}
      <div className="py-6 text-center shrink-0">
        <p className="text-[10px] text-[#b3afaa] tracking-[0.2em] font-medium uppercase">
          糯糯单词 · 破釜沉舟
        </p>
      </div>
    </div>
  );
}
