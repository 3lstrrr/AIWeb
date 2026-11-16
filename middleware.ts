// 站点访问门禁：配置了 BASIC_AUTH_USER / BASIC_AUTH_PASSWORD 时全站启用 HTTP Basic 认证，
// 未配置则完全放行（本地开发、公开演示均不受影响）。

import { NextResponse, type NextRequest } from "next/server";

/** 这些路径必须保持公开：社交平台抓取 OG 图、浏览器取图标 */
const PUBLIC_PATHS = ["/icon.svg", "/opengraph-image", "/favicon.ico", "/robots.txt"];

export function middleware(request: NextRequest) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;

  // 未配置账号密码 → 不做任何拦截
  if (!expectedUser || !expectedPassword) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path)) {
    return NextResponse.next();
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Basic ")) {
    try {
      // Edge Runtime 提供 atob；凭据格式为 base64("user:password")
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      if (separator > 0) {
        const inputUser = decoded.slice(0, separator);
        const inputPassword = decoded.slice(separator + 1);
        if (inputUser === expectedUser && inputPassword === expectedPassword) {
          return NextResponse.next();
        }
      }
    } catch {
      // base64 非法 → 走到下面的 401
    }
  }

  return new NextResponse("需要访问口令：请在弹窗中输入评审账号与密码。", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Zhixue Review", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  // 静态资源不经过中间件，避免给首屏资源增加一跳
  matcher: ["/((?!_next/static|_next/image).*)"],
};
