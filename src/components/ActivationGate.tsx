import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { verifyDevice, activateCode } from '../services/api';
import { getDeviceId } from '../utils/deviceId';
import { KeyRound, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import logoCircle from '../assets/nuonuo-logo-circle.png';

// LocalStorage key for caching verification result
const AUTH_CACHE_KEY = 'nuonuo_auth';

function loadAuthCache(): { valid: boolean; expiresAt: string } | null {
    try {
        const raw = localStorage.getItem(AUTH_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Check if cache itself is still valid
        if (parsed.expiresAt && new Date(parsed.expiresAt) > new Date()) return parsed;
        return null;
    } catch { return null; }
}

function saveAuthCache(expiresAt: string) {
    try {
        localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ valid: true, expiresAt }));
    } catch { }
}

interface ActivationGateProps {
    children: React.ReactNode;
}

export default function ActivationGate({ children }: ActivationGateProps) {
    const [status, setStatus] = useState<'loading' | 'unlocked' | 'locked'>('loading');
    const [codeInput, setCodeInput] = useState('');
    const [activating, setActivating] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [expiresAt, setExpiresAt] = useState('');

    useEffect(() => {
        // First: check local cache (fast, avoids network on every load)
        const cached = loadAuthCache();
        if (cached) {
            setStatus('unlocked');
            setExpiresAt(cached.expiresAt);
            return;
        }
        // Then: verify from server
        verifyDevice(getDeviceId()).then(res => {
            if (res.valid && res.expiresAt) {
                saveAuthCache(res.expiresAt);
                setExpiresAt(res.expiresAt);
                setStatus('unlocked');
            } else {
                setStatus('locked');
            }
        });
    }, []);

    const handleActivate = async () => {
        if (!codeInput.trim()) return;
        setActivating(true);
        setError('');
        setSuccessMsg('');

        const result = await activateCode(codeInput.trim(), getDeviceId());
        setActivating(false);

        if (result.success && result.expiresAt) {
            saveAuthCache(result.expiresAt);
            setExpiresAt(result.expiresAt);
            setSuccessMsg(result.message || '激活成功！');
            setTimeout(() => setStatus('unlocked'), 1200);
        } else {
            setError(result.message || '激活失败，请重试。');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleActivate();
    };

    // Format code input: auto insert dashes, uppercase
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        // Auto insert dashes: NUON-XXXX-XXXX-XXXX
        if (val.length > 4) val = val.slice(0, 4) + '-' + val.slice(4);
        if (val.length > 9) val = val.slice(0, 9) + '-' + val.slice(9);
        if (val.length > 14) val = val.slice(0, 14) + '-' + val.slice(14);
        if (val.length > 19) val = val.slice(0, 19);
        setCodeInput(val);
    };

    if (status === 'loading') {
        return (
            <div className="flex justify-center items-center h-[100dvh] bg-[#F4F3ED]">
                <Loader2 className="animate-spin text-[#b58362]" size={32} />
            </div>
        );
    }

    if (status === 'unlocked') {
        return <>{children}</>;
    }

    // Locked — show activation gate
    return (
        <div className="flex justify-center items-center h-[100dvh] bg-[#F4F3ED] px-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-sm"
            >
                {/* Logo area */}
                <div className="text-center mb-10">
                    <img
                        src={logoCircle}
                        alt="糯糯专升本"
                        className="w-16 h-16 mx-auto mb-5 rounded-full shadow-xl object-cover"
                    />
                    <h1 className="text-2xl font-serif font-bold text-[#1f1e1d] tracking-widest mb-1">糯糯专升本</h1>
                    <p className="text-[#8c8881] text-xs tracking-widest">英语备考 · 真题精练</p>
                </div>

                {/* Card */}
                <div className="bg-white rounded-[2rem] p-8 shadow-xl shadow-black/5 border border-gray-100">
                    <div className="flex items-center gap-2.5 mb-6">
                        <div className="w-8 h-8 bg-[#faf5f0] rounded-xl flex items-center justify-center">
                            <KeyRound size={16} className="text-[#b58362]" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-gray-800 tracking-wide">输入激活码</p>
                        </div>
                    </div>

                    <input
                        type="text"
                        value={codeInput}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder="NUON-XXXX-XXXX-XXXX"
                        className="w-full bg-[#f7f6f3] rounded-xl px-4 py-3.5 text-center font-mono text-sm tracking-[0.2em] text-gray-800 placeholder-gray-300 border border-transparent focus:border-[#b58362]/30 focus:outline-none focus:bg-white transition-all mb-4"
                        autoComplete="off"
                        spellCheck={false}
                    />

                    <AnimatePresence>
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="flex items-center gap-2 text-[#c98a6c] text-xs mb-4 bg-[#fdf6f0] px-3 py-2.5 rounded-xl"
                            >
                                <XCircle size={14} className="shrink-0" />
                                {error}
                            </motion.div>
                        )}
                        {successMsg && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="flex items-center gap-2 text-[#4a7c59] text-xs mb-4 bg-[#f4f8f4] px-3 py-2.5 rounded-xl"
                            >
                                <CheckCircle2 size={14} className="shrink-0" />
                                {successMsg}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <button
                        onClick={handleActivate}
                        disabled={activating || codeInput.length < 4}
                        className="w-full py-3.5 bg-[#1a1a1a] text-white rounded-xl font-medium text-sm tracking-wider hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {activating ? (
                            <><Loader2 size={16} className="animate-spin" /> 验证中...</>
                        ) : (
                            '立即激活'
                        )}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
