// 保留 re-export 給尚未遷到 src/api/auth 的呼叫者(SecurityTab / AddDeviceDialog / useAuthStatus / lib/fcm)。
// setupInit / setupVerify / login 已搬到 src/api/auth.ts(走 call<T> 統一介面)。
export { authedFetch } from "../../api/_client";
