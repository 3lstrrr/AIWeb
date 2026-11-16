// Supabase 服务端客户端（service_role 密钥）。
// 【仅服务端可用】严禁在 "use client" 组件或任何浏览器代码中引入本文件：service_role 会绕过 RLS，泄露即等于交出整库。
// 采用惰性单例：模块顶层不读取 env，避免 next build 收集路由数据时因缺少运行期密钥而失败。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

let cachedClient: SupabaseClient | undefined;

/**
 * 获取服务端 Supabase client（首次调用时创建并缓存）。
 * - auth.persistSession / autoRefreshToken 关闭：服务端无需维护登录态
 * - 该实例绕过 RLS，权限校验必须在 API 层自行完成
 * @throws 环境变量缺失时抛出中文错误
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const env = getEnv();
  cachedClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}
