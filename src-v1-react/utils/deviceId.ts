const DEVICE_ID_KEY = 'nuonuo_device_id';

/**
 * 获取或创建当前设备的唯一 ID。
 * 首次访问时自动生成并存入 localStorage，之后每次访问复用同一个 ID。
 * 无需注册登录，适合备考类单人使用场景。
 */
export function getDeviceId(): string {
    try {
        const existing = localStorage.getItem(DEVICE_ID_KEY);
        if (existing) return existing;

        const newId = 'device_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
        localStorage.setItem(DEVICE_ID_KEY, newId);
        return newId;
    } catch {
        // localStorage 不可用时降级为临时 ID（不持久化）
        return 'device_temp_' + Math.random().toString(36).slice(2, 9);
    }
}
