import { collectVocabLocalStorageSnapshot, collectVocabDataSnapshotAsync } from './vocabDataBackup';
import { supabase } from './supabaseClient';
import { setIdbItem } from './idbStorage';

export interface AuthSession {
  token: string;
  user: {
    id: string; // Supabase 用户 id 为 UUID 字符串
    username: string;
    licenseActivated: boolean;
    activatedWithCode?: string;
  };
}

export const AUTH_SESSION_STORAGE_KEY = 'nuonuo_auth_session_v1';
const STORAGE_SESSION_KEY = AUTH_SESSION_STORAGE_KEY;
export const LAST_SYNCED_TS_KEY = 'nuonuo_last_cloud_sync';
export const DEVICE_ID_STORAGE_KEY = 'nuonuo_device_id_v1';

function getOrCreateDeviceId(): string {
  if (typeof localStorage === 'undefined') return 'unknown_device';
  let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
  }
  return id;
}

function getDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Unknown';
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows PC';
  if (ua.includes('Macintosh')) return 'Mac';
  if (ua.includes('iPhone')) return 'iPhone';
  if (ua.includes('Android')) return 'Android Phone';
  return 'Mobile/Web';
}

export function isInviteCodeRequired(): boolean {
  return import.meta.env.VITE_REQUIRE_INVITE_CODE !== 'false';
}

export function looksLikeAlreadyActivatedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('already activated') ||
    m.includes('already used') ||
    m.includes('已激活') ||
    m.includes('已使用') ||
    m.includes('无需激活') ||
    m.includes('duplicate activation') ||
    m.includes('重复使用')
  );
}

// 帮助函数：基于用户名生成稳定的伪邮箱，用于匹配 Supabase 强制要求的 email
function toPseudoEmail(username: string) {
  return `${username.trim().toLowerCase()}@nuonuo.local`;
}

// 从伪邮箱或者 metadata 提取用户名
function extractUsername(user: any): string {
  if (user?.user_metadata?.username) {
    return user.user_metadata.username;
  }
  const email = user?.email || '';
  return email.split('@')[0] || 'Unknown';
}

// ---------------------------------------------------------
// 1. 注册与登录 (使用 Supabase Auth)
// ---------------------------------------------------------

export async function register(username: string, password: string): Promise<AuthSession> {
  const email = toPseudoEmail(username);
  
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username: username.trim() }
    }
  });

  if (error) {
    const msg = error.message;
    // 如果提示已经存在之类的，降级为尝试登录
    if (msg.includes('already registered') || msg.includes('exists')) {
      return login(username, password);
    }
    throw new Error(`注册失败: ${msg}`);
  }

  if (data.session && data.user) {
    const session: AuthSession = {
      token: data.session.access_token,
      user: {
        id: data.user.id,
        username: extractUsername(data.user),
        licenseActivated: false,
      }
    };

    // 注册/检查设备限制
    const deviceId = getOrCreateDeviceId();
    const deviceName = getDeviceName();
    const { data: deviceResult, error: deviceError } = await supabase.rpc('register_user_device', {
      p_device_id: deviceId,
      p_device_name: deviceName
    });

    if (deviceError || (deviceResult && !deviceResult.ok)) {
      await supabase.auth.signOut();
      localStorage.removeItem(STORAGE_SESSION_KEY);
      const errCode = deviceResult?.error || deviceError?.message || '未知错误';
      if (errCode === 'DEVICE_LIMIT_REACHED') {
        throw new Error('登录失败：该账号已在 3 个设备上登录，请先在旧设备退出。');
      }
      throw new Error(`设备验证失败: ${errCode}`);
    }

    saveSessionLocally(session);
    return session;
  }

  // 如果某些原因 signUp 没返回 session（例如邮箱验证等设置，虽然对于伪邮箱我们应当关闭），降级登录
  return login(username, password);
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const email = toPseudoEmail(username);
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(`登录失败: ${error.message === 'Invalid login credentials' ? '账号或密码错误' : error.message}`);
  }

  if (!data.session || !data.user) {
    throw new Error('登录响应无效：缺少会话信息');
  }

  const realUsername = extractUsername(data.user);

  // 获取该用户的授权激活状态
  let licenseActivated = false;
  let activatedWithCode: string | undefined = undefined;
  
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('license_activated, activated_with_code')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!profileErr && profile && profile.license_activated) {
    licenseActivated = true;
    activatedWithCode = profile.activated_with_code;
  }

  const session: AuthSession = {
    token: data.session.access_token,
    user: {
      id: data.user.id,
      username: realUsername,
      licenseActivated,
      activatedWithCode,
    }
  };
  
  // 注册/检查设备限制
  const deviceId = getOrCreateDeviceId();
  const deviceName = getDeviceName();
  const { data: deviceResult, error: deviceError } = await supabase.rpc('register_user_device', {
    p_device_id: deviceId,
    p_device_name: deviceName
  });

  if (deviceError || (deviceResult && !deviceResult.ok)) {
    await supabase.auth.signOut();
    localStorage.removeItem(STORAGE_SESSION_KEY);
    const errCode = deviceResult?.error || deviceError?.message || '未知错误';
    if (errCode === 'DEVICE_LIMIT_REACHED') {
      throw new Error('登录失败：该账号已在 3 个设备上登录，请先在旧设备退出。');
    }
    throw new Error(`设备验证失败: ${errCode}`);
  }

  saveSessionLocally(session);
  return session;
}

// ---------------------------------------------------------
// 2. 授权码激活 (使用 Supabase RPC)
// ---------------------------------------------------------

export async function activateCode(token: string, code: string, _userId?: string): Promise<{ ok: boolean }> {
  // 调用 Supabase RPC 函数
  const { data, error } = await supabase.rpc('activate_license_code', {
    p_code: code.trim().toUpperCase()
  });

  if (error) {
    throw new Error(`激活服务异常: ${error.message}`);
  }

  if (data && data.ok === false) {
    throw new Error(data.error || '授权码验证失败');
  }

  const s = getSavedSession();
  if (s && s.token === token) {
    s.user.licenseActivated = true;
    s.user.activatedWithCode = code.toUpperCase();
    saveSessionLocally(s);
  }

  return { ok: true };
}

export async function activateInviteOrRecover(session: AuthSession, code: string): Promise<AuthSession> {
  try {
    await activateCode(session.token, code, session.user.id);
    return {
      ...session,
      user: {
        ...session.user,
        licenseActivated: true,
        activatedWithCode: code.toUpperCase(),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (looksLikeAlreadyActivatedError(msg)) {
      return grantLicenseLocally(session);
    }
    throw e;
  }
}

// ---------------------------------------------------------
// 3. 进度同步 (存入 Supabase user_progress 表)
// ---------------------------------------------------------

export async function saveCloudProgress(
  token: string, 
  payload: Record<string, string | null>,
  _options?: { isClosing?: boolean }
): Promise<boolean> {
  if (!cloudProgressPayloadHasNonDayData(payload)) return false;

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return false;

  const ts = new Date().toISOString();
  try {
    const { error } = await supabase
      .from('user_progress')
      .upsert({
        profile_id: userData.user.id,
        payload: payload,
        updated_at: ts
      });

    if (error) {
      console.error('[Sync] Supabase 同步进度失败:', error.message);
      return false;
    }

    // 顺便上报设备信息，确保后台能看到该设备
    const deviceId = getOrCreateDeviceId();
    const deviceName = getDeviceName();
    void supabase.rpc('register_user_device', {
      p_device_id: deviceId,
      p_device_name: deviceName
    }).catch(() => {});

    console.log('[Sync] 成功同步至本地服务器 (updated_at:', ts, ')');
    localStorage.setItem(LAST_SYNCED_TS_KEY, ts);
    return true;
  } catch (e) {
    console.error('[Sync] 同步捕获到异常:', e);
    return false;
  }
}

export interface CloudProgressResponse {
  payload: Record<string, string | null>;
  updatedAt: string;
}

export async function loadCloudProgress(token: string): Promise<CloudProgressResponse | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return null;

  try {
    const { data, error } = await supabase
      .from('user_progress')
      .select('payload, updated_at')
      .eq('profile_id', userData.user.id)
      .maybeSingle();

    if (error || !data) return null;

    const payload = data.payload;
    const updatedAt = data.updated_at;

    if (!payload || typeof payload !== 'object') return null;

    console.log('[Sync] 从服务器成功拉取进度 (updated_at:', updatedAt, ')');
    return {
      payload: payload as Record<string, string | null>,
      updatedAt,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------
// 4. 合并与迁移逻辑 (保持原样供 App.tsx 调用)
// ---------------------------------------------------------

export function cloudProgressPayloadHasNonDayData(payload: Record<string, string | null>): boolean {
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'vocab_current_day') continue;
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || s === '[]' || s === '{}' || s === 'null') continue;
    return true;
  }
  return false;
}

export function snapshotLocalProgress(): Record<string, string | null> {
  return collectVocabLocalStorageSnapshot();
}

export async function snapshotLocalProgressAsync(): Promise<Record<string, string | null>> {
  return collectVocabDataSnapshotAsync();
}

export async function applyProgressToLocal(remotePayload: Record<string, string | null>, serverTs?: string) {
  for (const [k, remoteVal] of Object.entries(remotePayload)) {
    if (remoteVal === null) {
      localStorage.removeItem(k);
      continue;
    }

    const localVal = (k === 'vocab_focus_books' || k === 'vocab_custom_books') 
      ? null // IDB 托管的键，合并逻辑稍微不同：始终优先应用远程或合并。且我们不在此处读 IDB，只决定是否写。
      : localStorage.getItem(k);

    if (!localVal && k !== 'vocab_focus_books' && k !== 'vocab_custom_books') {
      localStorage.setItem(k, remoteVal);
      continue;
    }

    if (k === 'vocab_focus_books' || k === 'vocab_collection_books' || k === 'vocab_custom_books') {
      try {
        const remoteArr = JSON.parse(remoteVal);
        if (Array.isArray(remoteArr)) {
          // 处理 focus/custom 这种可能已被迁移至 IDB 的大 Key
          if (k === 'vocab_focus_books' || k === 'vocab_custom_books') {
            const localArr = await getIdbItem<any[]>(k) || [];
            const merged = [...remoteArr];
            
            // 深度合并逻辑：如果两边都有同一本书，合并其内部的单词状态
            if (Array.isArray(localArr)) {
              for (let i = 0; i < merged.length; i++) {
                const rb = merged[i];
                const lb = localArr.find((b: any) => b.id === rb.id);
                if (lb && Array.isArray(lb.words) && Array.isArray(rb.words)) {
                  // 合并单词状态：以 ID 为准，取更先进的状态
                  const wordMap = new Map();
                  // 先放本地的
                  lb.words.forEach((w: any) => { if (w?.id) wordMap.set(w.id, w); });
                  // 再放远程的（如果有冲突，此时简单的覆盖可能不够，但通常云端是权威）
                  // 这里我们采取“并集”策略：如果本地有，云端也有，维持原样或合并属性
                  rb.words.forEach((rw: any) => {
                    if (!rw?.id) return;
                    const lw = wordMap.get(rw.id);
                    if (!lw) {
                      wordMap.set(rw.id, rw);
                    } else {
                      // 简单的属性合并，确保 status 等关键信息取并集逻辑（简单起见，目前以更新时间或存在即视为同步）
                      wordMap.set(rw.id, { ...lw, ...rw });
                    }
                  });
                  merged[i] = { ...lb, ...rb, words: Array.from(wordMap.values()) };
                }
              }
            }

            await setIdbItem(k, merged);
            localStorage.removeItem(k); // 确保 localStorage 为空，保持 IDB 迁移态
            continue;
          }

          // 处理 collection_books (目前仍在 localStorage)
          const localArr = localVal ? JSON.parse(localVal) : [];
          if (Array.isArray(localArr)) {
            const merged = [...remoteArr];
            const remoteIds = new Set(remoteArr.map((b: any) => b.id));
            for (const lb of localArr) {
              if (lb?.id && !remoteIds.has(lb.id)) merged.push(lb);
            }
            localStorage.setItem(k, JSON.stringify(merged));
            continue;
          }
        }
      } catch (e) {
        console.error(`[Sync] 合并 ${k} 失败:`, e);
      }
    } else if (k === 'vocab_stats') {
      try {
        const localObj = localVal ? JSON.parse(localVal) : { mastered_100: 0, history: {} };
        const remoteObj = JSON.parse(remoteVal);
        const merged = { ...localObj, ...remoteObj };
        for (const key in merged) {
          if (typeof localObj[key] === 'number' && typeof remoteObj[key] === 'number') {
            merged[key] = Math.max(localObj[key], remoteObj[key]);
          }
        }
        if (localObj.history && remoteObj.history) {
            merged.history = { ...localObj.history, ...remoteObj.history };
            for (const dk in merged.history) {
               if (localObj.history[dk] && remoteObj.history[dk]) {
                  const lDay = localObj.history[dk];
                  const rDay = remoteObj.history[dk];
                  merged.history[dk] = { ...lDay, ...rDay };
                  for (const sk in merged.history[dk]) {
                      if (typeof lDay[sk] === 'number' && typeof rDay[sk] === 'number') {
                          merged.history[dk][sk] = Math.max(lDay[sk], rDay[sk]);
                      }
                  }
               }
            }
        }
        localStorage.setItem(k, JSON.stringify(merged));
        continue;
      } catch {}
    } else if (
      k === 'vocab_book_study_cursor' ||
      k === 'vocab_daily_challenge' ||
      k === 'vocab_scan_resume_snapshot' ||
      k === 'vocab_today_scan_batches' ||
      k === 'vocab_cycle_review_session'
    ) {
      try {
        const localObj = localVal ? JSON.parse(localVal) : {};
        const remoteObj = JSON.parse(remoteVal);
        const merged = { ...localObj, ...remoteObj };
        localStorage.setItem(k, JSON.stringify(merged));
        continue;
      } catch {}
    }

    localStorage.setItem(k, remoteVal);
  }

  if (serverTs) {
    localStorage.setItem(LAST_SYNCED_TS_KEY, serverTs);
  }
}

// ---------------------------------------------------------
// 5. 会话管理
// ---------------------------------------------------------

export function logout() {
  localStorage.removeItem(STORAGE_SESSION_KEY);
  localStorage.removeItem(LAST_SYNCED_TS_KEY);
  // 清理 supabase 会话
  void supabase.auth.signOut();
}

function saveSessionLocally(s: AuthSession) {
  localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(s));
}

export function grantLicenseLocally(session: AuthSession): AuthSession {
  const next: AuthSession = {
    ...session,
    user: { ...session.user, licenseActivated: true },
  };
  saveSessionLocally(next);
  return next;
}

export function getSavedSession(): AuthSession | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as Record<string, unknown>;
    const token = p.token;
    const userRaw = p.user;
    if (typeof token !== 'string' || !token.trim()) return null;
    if (!userRaw || typeof userRaw !== 'object') return null;
    const u = userRaw as Record<string, unknown>;
    const username = u.username;
    if (typeof username !== 'string' || !username.trim()) return null;
    const licenseActivated = u.licenseActivated === true;
    const session: AuthSession = {
      token,
      user: {
        id: String(u.id ?? ''),
        username: username.trim(),
        licenseActivated,
        ...(typeof u.activatedWithCode === 'string'
          ? { activatedWithCode: u.activatedWithCode }
          : {}),
      },
    };
    return session;
  } catch {
    return null;
  }
}

export function listLocalUsers() {
  const s = getSavedSession();
  if (s) {
    return [{
      username: s.user.username,
      userId: s.user.id,
      licenseActivated: s.user.licenseActivated,
      activatedCodesCount: 1
    }];
  }
  return [];
}

export function deleteLocalUser(_username: string) {
  logout();
}

export function loginAsLocalUser(username: string): AuthSession {
  const s = getSavedSession();
  if (s && s.user.username === username) return s;
  throw new Error('请先登录');
}

