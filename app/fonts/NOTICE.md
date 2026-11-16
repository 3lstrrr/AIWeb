# 字体来源与许可

`geist-latin.woff2` 取自 Next.js 依赖包内置的 Geist 字体子集（`next/dist/esm/next-devtools/server/font/`），
用于 `app/layout.tsx` 的 `next/font/local`，避免构建/运行时依赖 Google Fonts 外链。

- 字体：**Geist**（Vercel）
- 许可：**SIL Open Font License 1.1**（https://github.com/vercel/geist-font/blob/main/LICENSE.txt）
- 子集：latin only，中文字符回落到系统字体栈（PingFang SC / Microsoft YaHei / sans-serif）

> 若要对外分发本仓库，请把上述 OFL 1.1 许可全文一并放入本目录；或改用 `next/font/google`
> 在能访问 fonts.googleapis.com 的构建环境里拉取（会把字体内联进产物）。
