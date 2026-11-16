import type { PageText } from "../page-text.ts";

export const pageText: PageText = {
  errors: {
    ssrf_blocked: "Girici 不会打开本地或私有网络地址。",
    dns: "Girici 找不到 {host}。",
    connect: "Girici 无法连接到 {host}。",
    tls: "{host} 发送了无效的证书。",
    timeout: "{host} 响应超时。",
    too_large: "请求过大。",
    bad_request: "无法通过 Girici 打开此地址。",
    header_overflow: "{host} 发送的标头过大。",
    auth: "打开 {host} 之前，需要先登录 Girici。",
    rate_limited: "你的网络发出的请求过多。请稍等片刻，然后刷新页面。",
    blocked: "{host} 已在此 Girici 服务器上被屏蔽。",
    proxy: "Girici 的上游代理无法访问 {host}。",
    quota: "你的网络已用完此 Girici 服务器的流量配额。请{wait}重试。",
    challenge: "Girici 需要先检查此浏览器，才能打开 {host}。请刷新页面。",
    runtime: "Girici 无法验证其页面脚本。如果此服务器前面的 CDN 或代理会改写或压缩 JavaScript，请为 /_g/ 关闭该功能。",
    sealed: "此地址是在另一个浏览器中加密的，或者此浏览器的地址密钥已被重置。请从 Girici 重新打开该网站。",
  },
  someSite: "该网站",
  backHome: "返回 Girici",
  waitLater: "稍后",
  waitMinute: "一分钟后",
  waitMinutes: { other: " {count} 分钟后" },
  waitHours: { other: " {count} 小时后" },
  warningTitle: "此页面经由 Girici 打开",
  warningBody:
    "Girici 是一个网页代理。下一个页面来自 {host}，而非此服务器的运营者。请勿在你并非有意访问的网站上输入密码。",
  warningContinue: "继续访问 {host}",
  warningHome: "前往 Girici 首页",
};
