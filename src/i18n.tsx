import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "./api";

export type Lang = "en" | "zh";

type Vars = Record<string, string | number>;

/* ------------------------------------------------------------------ english */

const en = {
  // shell
  "brand.home": "HookLab home",
  "nav.home": "Home",
  "nav.inbox": "Inbox",
  "nav.replay": "Replay",
  "nav.settings": "Settings",
  "nav.star": "Star",
  "nav.starTitle": "HookLab on GitHub",
  "nav.xTitle": "Author on X — @0xkillcoin",
  "nav.xAria": "Author on X, @0xkillcoin",
  "lang.switchToZh": "Switch to Chinese",
  "lang.switchToEn": "Switch to English",
  "footer.tagline": "HookLab — capture · inspect · replay. Built for developers who are tired of guessing.",
  "footer.github": "GitHub",
  "footer.security": "Security model",
  "footer.x": "𝕏 @0xkillcoin",
  "footer.license": "MIT License",

  // shared
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.failed": "Failed",
  "common.copyTitle": "Copy to clipboard",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.retry": "Retry",
  "common.refresh": "Refresh",
  "common.delete": "Delete",
  "common.save": "Save",
  "common.loading": "Loading…",
  "common.close": "Close",
  "common.clipboardBlocked": "Clipboard is blocked by the browser. Select the text and copy manually.",
  "common.pollingLive": "Live",
  "common.pollingPaused": "Paused",

  "chip.real": "● real request",
  "chip.test": "◇ test request",
  "chip.statusTitle": "HTTP status returned by the target",
  "chip.noResponse": "No response",

  // token gate
  "gate.title": "Access token required",
  "gate.body":
    "Endpoint {id} is not stored in this browser. HookLab keeps only a hash of each token on the server, so the token must come from you.",
  "gate.label": "Endpoint token",
  "gate.unlock": "Unlock endpoint",
  "gate.create": "Create a new endpoint",
  "gate.rejected": "That token was rejected for this endpoint. Check that you copied the full hl_… string.",
  "gate.note":
    "Tokens are sent only to the HookLab API over HTTPS as an x-hooklab-token header and are stored locally in this browser.",

  // landing
  "landing.badge": "Live capture service · no signup required",
  "landing.h1a": "A webhook lab for",
  "landing.h1b": "requests you can actually see",
  "landing.intro":
    "HookLab creates a temporary public HTTPS endpoint that records every request it receives — headers, query string, body and timing. Inspect it, copy a ready-made snippet, then replay it to a target you choose. Built for Stripe/GitHub/Shopee-style webhook debugging where “did the payload even arrive?” is the whole question.",
  "landing.ctaCreate": "Create an endpoint",
  "landing.ctaSource": "★ Read the source",
  "landing.newEndpoint": "New endpoint",
  "landing.newEndpointHint": "The access token is shown once and kept only in this browser.",
  "landing.label": "Label (optional)",
  "landing.labelPlaceholder": "Stripe checkout test",
  "landing.expiresIn": "Expires in",
  "landing.maxRequests": "Max requests",
  "landing.create": "Create endpoint",
  "landing.creating": "Creating…",
  "landing.createdToast": "Endpoint created — token saved in this browser only.",
  "landing.createFailed": "Could not create the endpoint. Please retry.",
  "landing.snippetTitle": "Try it in one command",
  "landing.snippetHint": "After creating an endpoint, paste these with your own id:",
  "landing.snippetNote":
    "Requests appear in the inbox instantly — the console polls the API every 3 seconds.",
  "landing.ready": "Endpoint ready.",
  "landing.readyBody": "{name} — token {hint} saved locally. Open the console to copy the full URL.",
  "landing.yours": "Your endpoints in this browser",
  "landing.noneTitle": "No endpoints yet",
  "landing.noneHint":
    "Create one above. Tokens live in this browser's localStorage, so a different device or a cleared cache cannot open old endpoints.",
  "landing.openConsole": "Open console",
  "landing.forget": "Forget",
  "landing.forgotten": "Endpoint removed from this browser. Server data expires on its own TTL.",
  "landing.createdAt": "Created {when}",
  "landing.features": "What you get",
  "landing.how": "How it works",
  "landing.terminalTitle": "hooklab — capture flow",
  "ttl.1h": "1 hour",
  "ttl.6h": "6 hours",
  "ttl.24h": "24 hours",
  "ttl.3d": "3 days",
  "ttl.7d": "7 days",
  "ttl.30d": "30 days",

  "feature.1.title": "Real, public HTTPS endpoints",
  "feature.1.body":
    "Every endpoint is a live server route — point any provider webhook at it and the request is captured in milliseconds.",
  "feature.2.title": "Full-fidelity inspection",
  "feature.2.body":
    "Method, path, query, headers, timing and the raw body. JSON is prettified, forms are decoded, binaries are hashed safely.",
  "feature.3.title": "Safe replay",
  "feature.3.body":
    "Replay to a target you type — SSRF-guarded against private IPs, metadata services, DNS rebinding and redirect hops.",
  "feature.4.title": "Paste-ready snippets",
  "feature.4.body":
    "curl, fetch and Python examples generated for your endpoint, so wiring a provider takes seconds.",
  "feature.5.title": "Redaction by default",
  "feature.5.body":
    "Authorization, Cookie, API keys and signatures are stored as [REDACTED] unless you explicitly opt in.",
  "feature.6.title": "Self-destructing data",
  "feature.6.body":
    "TTLs, request caps and byte quotas are enforced server-side. Expired rows are swept automatically.",

  // endpoint / inbox
  "endpoint.opening": "Opening endpoint…",
  "endpoint.unavailable": "Endpoint unavailable",
  "endpoint.tokenInvalid":
    "The stored token for this endpoint is no longer valid. It may have expired or been rotated.",
  "endpoint.backHome": "Back to home",
  "endpoint.nothing": "Nothing to show",
  "endpoint.nothingHint": "This endpoint could not be loaded.",
  "endpoint.status.expired": "expired",
  "endpoint.status.active": "active",
  "endpoint.status.paused": "paused",
  "endpoint.storeSensitive": "sensitive headers stored",
  "endpoint.meta": "Expires {when} · retains {retention} min · {rate}/min ingest limit",
  "endpoint.replayLab": "↻ Replay lab",
  "endpoint.settings": "⚙ Settings",
  "endpoint.sendTo": "Send requests to:",
  "endpoint.stat.requests": "Requests stored",
  "endpoint.stat.storage": "Payload storage",
  "endpoint.stat.replays": "Replays run",
  "endpoint.stat.last": "Last request",
  "endpoint.expiredTitle": "This endpoint has expired.",
  "endpoint.expiredBody":
    "It no longer accepts requests and its stored requests are being swept. Create a new endpoint to keep testing.",
  "endpoint.inbox": "Inbox",
  "endpoint.inboxCount": "{count} shown",
  "endpoint.inboxLive": " · live polling every 3s",
  "endpoint.inboxPaused": " · polling paused",
  "endpoint.search": "Search path, body or user-agent…",
  "endpoint.searchAria": "Search requests",
  "endpoint.methodAria": "Filter by method",
  "endpoint.originAria": "Filter by origin",
  "endpoint.allMethods": "All methods",
  "endpoint.allOrigins": "All origins",
  "endpoint.originReal": "Real requests",
  "endpoint.originTest": "Test requests",
  "endpoint.emptyFiltered": "No requests match these filters",
  "endpoint.emptyFilteredHint": "Clear the search box or filters to see everything this endpoint captured.",
  "endpoint.emptyInbox": "Waiting for the first request",
  "endpoint.emptyInboxHint":
    "Point your provider's webhook at the URL above, or use the test request panel to send one now.",
  "endpoint.clearFilters": "Clear filters",
  "endpoint.rowAria": "Request #{seq}, {method} {path}",
  "endpoint.emptyBody": "(empty body)",
  "endpoint.binaryBody": "(binary body)",
  "endpoint.lastSync": "Last sync {time}",
  "endpoint.notSynced": "Not synced yet",
  "endpoint.recent": "{count} recent",

  "testReq.toggle": "Send a test request",
  "testReq.subtitle": "platform-generated · labelled separately from real traffic",
  "testReq.method": "Method",
  "testReq.contentType": "Content-Type",
  "testReq.body": "Body",
  "testReq.send": "Send to endpoint",
  "testReq.sent": "Test request #{seq} stored — marked as “test request”, never as a real capture.",
  "testReq.ok": "Test request stored.",
  "testReq.failed": "Test request failed.",

  // request detail
  "request.back": "← Inbox",
  "request.loading": "Loading request…",
  "request.unavailable": "Request unavailable",
  "request.unavailableHint": "This request could not be loaded.",
  "request.gone": "This request is gone — it expired, was deleted, or belongs to another endpoint.",
  "request.replay": "↻ Replay",
  "request.redactedTitle": "{count} sensitive header(s) redacted:",
  "request.redactedNever": " — values were never stored.",
  "request.redactedOptIn": " (values shown because this endpoint opted in)",
  "request.body": "Request body",
  "request.formatted": "Formatted",
  "request.fields": "Fields",
  "request.raw": "Raw",
  "request.copyBody": "Copy body",
  "request.emptyTitle": "Empty body",
  "request.emptyHint": "This request was sent without a payload — common for GET/HEAD pings.",
  "request.binaryNote":
    "Binary payload — HookLab never renders unknown bytes as HTML. Showing a base64 transcript",
  "request.headers": "Headers",
  "request.copyAll": "Copy all",
  "request.noHeaders": "No headers captured.",
  "request.query": "Query parameters",
  "request.copyJson": "Copy JSON",
  "request.noQuery": "No query string on this request.",
  "request.curl": "Replay as cURL",
  "request.copyCurl": "Copy cURL",
  "request.curlNote":
    "Redacted headers appear as [REDACTED] — replace them with real values locally before running.",
  "request.curlBinary": "# binary body omitted — use the Raw base64 transcript in the request body panel",
  "request.replayHistory": "Replay history",
  "request.emptyField": "(empty)",
  "request.deleteTitle": "Delete this request?",
  "request.deleteBody":
    "The stored payload, headers and body are removed immediately and cannot be recovered.",
  "request.deleteConfirm": "Delete request",
  "request.deleted": "Request deleted.",
  "request.deleteFailed": "Delete failed.",

  // replay
  "replay.opening": "Opening replay lab…",
  "replay.title": "Replay lab",
  "replay.intro":
    "Re-send a captured request to a target you name. HookLab validates the target before every hop: no private IPs, no cloud metadata endpoints, no single-label hosts, redirects re-checked one by one, and the DNS answer is re-verified after the response to catch rebinding.",
  "replay.source": "Source request",
  "replay.loadingRequests": "Loading requests…",
  "replay.noRequests": "No captured requests yet",
  "replay.noRequestsHint": "Send a request to the endpoint URL first, then come back to replay it.",
  "replay.goInbox": "Go to inbox",
  "replay.target": "Target URL (required)",
  "replay.targetPlaceholder": "https://your-staging-app.example.com/webhooks/test",
  "replay.method": "Method",
  "replay.includeBody": "Include captured body",
  "replay.extraHeaders": "Extra headers (one per line, Name: value)",
  "replay.send": "Send replay",
  "replay.sending": "Replaying…",
  "replay.limits": "20 replays/minute · 200/day per endpoint",
  "replay.guardNote":
    "Blocked by design: loopback, RFC1918, link-local, CGNAT, multicast, IPv6 ULA/link-local, IPv4-mapped variants, .internal/.local zones, cloud metadata IPs, non-80/443/8080/8443 ports and credentialed URLs.",
  "replay.result": "Result",
  "replay.noResult":
    "No replay yet. Pick a request, enter a target, and send — the response status, timing and a truncated body will appear here.",
  "replay.received": "{size} received",
  "replay.truncated": "truncated",
  "replay.rebinding": "DNS rebinding suspected",
  "replay.kvTarget": "target",
  "replay.kvFinal": "final url",
  "replay.kvHops": "hops",
  "replay.redirectChain": "Redirect chain (every hop re-validated):",
  "replay.respHeaders": "Response headers",
  "replay.bodyPreview": "Body preview (first 8 KB)",
  "replay.emptyResponse": "(empty response body)",
  "replay.none": "(none)",
  "replay.history": "Replay history",
  "replay.noHistory": "No replays yet.",
  "replay.sentToast": "Replay sent — target answered {status}.",
  "replay.failedToast": "Replay failed unexpectedly.",
  "replay.extraHeadersPlaceholder": "x-debug-run: 1\naccept: application/json",

  // settings
  "settings.loading": "Loading settings…",
  "settings.unavailable": "Endpoint could not be loaded.",
  "settings.title": "Endpoint settings",
  "settings.ingestUrl": "Ingest URL",
  "settings.token": "Access token (stored in this browser only)",
  "settings.copyToken": "Copy token",
  "settings.newTokenTitle": "New token:",
  "settings.newTokenBody":
    "copy it now. It has replaced the previous token and is already saved in this browser.",
  "settings.stat.requests": "Requests",
  "settings.stat.storage": "Storage",
  "settings.stat.expires": "Expires",
  "settings.stat.retention": "Retention",
  "settings.rowsSwept": "rows auto-swept",
  "settings.max": "max {value} min",
  "settings.rename": "Rename",
  "settings.displayName": "Display name",
  "settings.saveName": "Save name",
  "settings.renamed": "Endpoint renamed.",
  "settings.renameFailed": "Rename failed.",
  "settings.limits": "Limits",
  "settings.rateLimit": "Ingest rate limit (per minute)",
  "settings.maxRequests": "Max stored requests",
  "settings.saveLimits": "Save limits",
  "settings.limitsSaved": "Limits updated.",
  "settings.limitsFailed": "Update failed.",
  "settings.extend1h": "Extend 1 hour",
  "settings.extend1d": "Extend 1 day",
  "settings.pause": "⏸ Pause endpoint",
  "settings.resume": "▶ Resume endpoint",
  "settings.paused": "Endpoint paused.",
  "settings.resumed": "Endpoint resumed.",
  "settings.statusFailed": "Could not change status.",
  "settings.limitsNote":
    "Pausing blocks new captures without deleting stored requests. Limits are enforced server-side — the UI only reflects them.",
  "settings.dataControls": "Data controls",
  "settings.exportSummary": "Export sanitised report",
  "settings.exportAll": "Export with bodies",
  "settings.purge": "Delete all requests",
  "settings.purged": "All captured requests deleted.",
  "settings.purgeFailed": "Purge failed.",
  "settings.exportOk": "Report downloaded (sensitive headers already redacted).",
  "settings.exportFailed": "Export failed.",
  "settings.exportNote":
    "Exports include every stored request with sensitive headers already replaced by [REDACTED]. Bodies are included only in the “with bodies” variant, capped at 64 KB per request.",
  "settings.danger": "Danger zone",
  "settings.rotate": "⟳ Rotate token",
  "settings.deleteEndpoint": "Delete endpoint",
  "settings.dangerNote":
    "Deleting removes the endpoint, every captured request and its replay history. This cannot be undone.",
  "settings.purgeTitle": "Delete all captured requests?",
  "settings.purgeBody":
    "Every stored request for this endpoint is deleted immediately. The endpoint itself stays active.",
  "settings.purgeConfirm": "Delete requests",
  "settings.rotateTitle": "Rotate the access token?",
  "settings.rotateBody":
    "The current token stops working immediately. Anyone using the old token loses access — including other tabs of this browser until they pick up the new one.",
  "settings.rotateConfirm": "Rotate token",
  "settings.rotateOk": "Token rotated — the old token stopped working immediately.",
  "settings.rotateFailed": "Rotation failed.",
  "settings.deleteTitle": "Delete this endpoint?",
  "settings.deleteBody":
    "The endpoint URL, all captured requests and replay history are destroyed. This cannot be undone and the token cannot be recovered.",
  "settings.deleteConfirm": "Delete endpoint",
  "settings.deleted": "Endpoint and all stored requests deleted.",
  "settings.deleteFailed": "Delete failed.",
  "settings.extended": "Extended until {when}.",

  // errors (server error codes, localised)
  "err.network_error": "Network request failed. Check your connection and retry.",
  "err.unknown": "Unexpected error.",
  "err.unauthorized": "A valid endpoint token is required for this operation.",
  "err.missing_endpoint": "Endpoint id missing.",
  "err.not_found": "Unknown API route.",
  "err.method_not_allowed": "This method is not supported here.",
  "err.endpoint_not_found": "This endpoint does not exist. It may have expired and been deleted.",
  "err.endpoint_expired": "This endpoint has expired and no longer accepts requests.",
  "err.endpoint_paused": "This endpoint is paused and is not capturing requests.",
  "err.rate_limited": "Too many requests for this endpoint. Slow down and retry shortly.",
  "err.endpoint_rate_limited": "This endpoint is receiving too much traffic right now.",
  "err.payload_too_large": "The request body is larger than the 128 KiB limit and was rejected.",
  "err.request_quota_exceeded": "This endpoint reached its stored-request limit. Create a new endpoint.",
  "err.storage_quota_exceeded":
    "This endpoint reached its storage quota. Delete old requests or create a new endpoint.",
  "err.creation_rate_limited": "Daily endpoint creation limit reached for your network. Try again tomorrow.",
  "err.invalid_target": "Target must be an absolute http(s) URL without embedded credentials.",
  "err.blocked_target": "Target host is private, loopback, reserved or a cloud metadata endpoint. Replay refused.",
  "err.blocked_port": "That port is not allowed for replay. Use 80, 443, 8080 or 8443.",
  "err.host_not_allowlisted": "Replay is restricted on this deployment and that host is not allowed.",
  "err.dns_lookup_failed": "Could not resolve the target hostname.",
  "err.too_many_redirects": "The target redirected too many times.",
  "err.replay_timeout": "The target did not respond within 10 seconds.",
  "err.replay_failed": "The target request failed (network, TLS or unreachable host).",
  "err.replay_rate_limited": "Replay rate limit reached. Wait a moment and retry.",
  "err.replay_quota_exceeded": "Daily replay quota reached for this endpoint.",
  "err.dns_rebinding_suspected": "The target's DNS answer changed to a private address during the replay.",
  "err.missing_target": "A target URL is required — HookLab never replays to an implicit target.",
  "err.invalid_method": "Unsupported HTTP method for replay.",
  "err.request_not_found": "That request does not exist or has expired.",
  "err.nothing_to_update": "No supported fields supplied.",
  "err.invalid_json": "Body is not valid JSON.",
  "err.invalid_body": "The request body could not be read.",
  "err.body_read_error": "Could not read the request body.",
  "err.internal_error": "Unexpected server error. Please retry.",
} as const;

export type TextKey = keyof typeof en;

/* ------------------------------------------------------------------ chinese */

const zh: Record<TextKey, string> = {
  "brand.home": "HookLab 首页",
  "nav.home": "首页",
  "nav.inbox": "收件箱",
  "nav.replay": "重放",
  "nav.settings": "设置",
  "nav.star": "收藏",
  "nav.starTitle": "在 GitHub 上查看 HookLab",
  "nav.xTitle": "作者 X — @0xkillcoin",
  "nav.xAria": "作者 X，@0xkillcoin",
  "lang.switchToZh": "切换到中文",
  "lang.switchToEn": "切换到英文",
  "footer.tagline": "HookLab — 捕获 · 检查 · 重放。为不想再靠猜的开发者而做。",
  "footer.github": "GitHub",
  "footer.security": "安全模型",
  "footer.x": "𝕏 @0xkillcoin",
  "footer.license": "MIT 许可",

  "common.copy": "复制",
  "common.copied": "已复制",
  "common.failed": "失败",
  "common.copyTitle": "复制到剪贴板",
  "common.cancel": "取消",
  "common.confirm": "确认",
  "common.retry": "重试",
  "common.refresh": "刷新",
  "common.delete": "删除",
  "common.save": "保存",
  "common.loading": "加载中…",
  "common.close": "关闭",
  "common.clipboardBlocked": "浏览器阻止了剪贴板访问，请手动选中文本复制。",
  "common.pollingLive": "实时",
  "common.pollingPaused": "已暂停",

  "chip.real": "● 真实请求",
  "chip.test": "◇ 测试请求",
  "chip.statusTitle": "目标返回的 HTTP 状态码",
  "chip.noResponse": "无响应",

  "gate.title": "需要访问令牌",
  "gate.body":
    "端点 {id} 未保存在当前浏览器中。服务端只保存令牌的哈希，因此需要你提供令牌。",
  "gate.label": "端点令牌",
  "gate.unlock": "解锁端点",
  "gate.create": "创建新端点",
  "gate.rejected": "该令牌与此端点不匹配，请确认复制了完整的 hl_… 字符串。",
  "gate.note": "令牌仅通过 HTTPS 以 x-hooklab-token 请求头发送给 HookLab API，并保存在本浏览器中。",

  "landing.badge": "实时捕获服务 · 无需注册",
  "landing.h1a": "给开发者用的 Webhook 实验室，",
  "landing.h1b": "每个请求都看得见",
  "landing.intro":
    "HookLab 会创建一个临时的公网 HTTPS 端点，记录收到的每一个请求——请求头、查询参数、请求体与时间。你可以直接检查内容、复制现成的代码片段，再把它重放到自己指定的目标。专为 Stripe、GitHub、Shopee 这类 webhook 调试场景而做：真正要回答的问题往往只是“这个 payload 到底有没有送到？”",
  "landing.ctaCreate": "创建端点",
  "landing.ctaSource": "★ 查看源码",
  "landing.newEndpoint": "新建端点",
  "landing.newEndpointHint": "访问令牌只显示一次，并且仅保存在当前浏览器中。",
  "landing.label": "标签（可选）",
  "landing.labelPlaceholder": "Stripe 结账测试",
  "landing.expiresIn": "有效期",
  "landing.maxRequests": "最大请求数",
  "landing.create": "创建端点",
  "landing.creating": "创建中…",
  "landing.createdToast": "端点已创建——令牌仅保存在当前浏览器。",
  "landing.createFailed": "端点创建失败，请重试。",
  "landing.snippetTitle": "一行命令即可试用",
  "landing.snippetHint": "创建端点后，把下面的地址换成你的端点 id：",
  "landing.snippetNote": "请求会立即出现在收件箱——控制台每 3 秒轮询一次接口。",
  "landing.ready": "端点已就绪。",
  "landing.readyBody": "{name} —— 令牌 {hint} 已保存在本地。打开控制台即可复制完整地址。",
  "landing.yours": "本浏览器中的端点",
  "landing.noneTitle": "还没有端点",
  "landing.noneHint":
    "在上方创建一个即可。令牌保存在本浏览器的 localStorage 中，换设备或清除缓存后无法打开旧端点。",
  "landing.openConsole": "打开控制台",
  "landing.forget": "移除",
  "landing.forgotten": "已从本浏览器移除该端点。服务端数据会按自身有效期过期。",
  "landing.createdAt": "创建于 {when}",
  "landing.features": "你能获得什么",
  "landing.how": "工作方式",
  "landing.terminalTitle": "hooklab — 捕获流程",
  "ttl.1h": "1 小时",
  "ttl.6h": "6 小时",
  "ttl.24h": "24 小时",
  "ttl.3d": "3 天",
  "ttl.7d": "7 天",
  "ttl.30d": "30 天",

  "feature.1.title": "真实的公网 HTTPS 端点",
  "feature.1.body": "每个端点都是真实的服务端路由——把任何平台的 webhook 指向它，请求会在毫秒级被捕获。",
  "feature.2.title": "完整保真的检查能力",
  "feature.2.body": "方法、路径、查询参数、请求头、耗时与原始请求体。JSON 自动格式化，表单自动解码，二进制安全哈希。",
  "feature.3.title": "安全的重放",
  "feature.3.body": "重放到你输入的目标——内置 SSRF 防护，阻断内网 IP、云元数据服务、DNS 重绑定与恶意跳转。",
  "feature.4.title": "可直接粘贴的代码片段",
  "feature.4.body": "自动生成 curl、fetch 与 Python 示例，接入第三方平台只需几秒。",
  "feature.5.title": "默认脱敏",
  "feature.5.body": "Authorization、Cookie、API Key 与签名默认存为 [REDACTED]，除非你明确选择保留。",
  "feature.6.title": "数据自动销毁",
  "feature.6.body": "有效期、请求数上限与存储配额全部由服务端执行，过期数据自动清理。",

  "endpoint.opening": "正在打开端点…",
  "endpoint.unavailable": "端点不可用",
  "endpoint.tokenInvalid": "该端点保存的令牌已失效，可能已过期或已被轮换。",
  "endpoint.backHome": "返回首页",
  "endpoint.nothing": "没有可显示的内容",
  "endpoint.nothingHint": "该端点无法加载。",
  "endpoint.status.expired": "已过期",
  "endpoint.status.active": "运行中",
  "endpoint.status.paused": "已暂停",
  "endpoint.storeSensitive": "已保存敏感头",
  "endpoint.meta": "{when}过期 · 保留 {retention} 分钟 · 入站限流 {rate}/分钟",
  "endpoint.replayLab": "↻ 重放实验室",
  "endpoint.settings": "⚙ 设置",
  "endpoint.sendTo": "把请求发送到：",
  "endpoint.stat.requests": "已存请求",
  "endpoint.stat.storage": "请求体存储",
  "endpoint.stat.replays": "重放次数",
  "endpoint.stat.last": "最近请求",
  "endpoint.expiredTitle": "该端点已过期。",
  "endpoint.expiredBody": "它不再接收请求，已存请求正在被清理。请创建新端点继续测试。",
  "endpoint.inbox": "收件箱",
  "endpoint.inboxCount": "共显示 {count} 条",
  "endpoint.inboxLive": " · 每 3 秒实时轮询",
  "endpoint.inboxPaused": " · 轮询已暂停",
  "endpoint.search": "搜索路径、请求体或 User-Agent…",
  "endpoint.searchAria": "搜索请求",
  "endpoint.methodAria": "按方法筛选",
  "endpoint.originAria": "按来源筛选",
  "endpoint.allMethods": "全部方法",
  "endpoint.allOrigins": "全部来源",
  "endpoint.originReal": "真实请求",
  "endpoint.originTest": "测试请求",
  "endpoint.emptyFiltered": "没有请求符合当前筛选条件",
  "endpoint.emptyFilteredHint": "清空搜索框或筛选条件即可看到该端点捕获的全部请求。",
  "endpoint.emptyInbox": "等待第一个请求",
  "endpoint.emptyInboxHint": "把上游 webhook 指向上面的地址，或使用测试请求面板立即发送一条。",
  "endpoint.clearFilters": "清空筛选",
  "endpoint.rowAria": "第 {seq} 条请求，{method} {path}",
  "endpoint.emptyBody": "（空请求体）",
  "endpoint.binaryBody": "（二进制请求体）",
  "endpoint.lastSync": "上次同步 {time}",
  "endpoint.notSynced": "尚未同步",
  "endpoint.recent": "新增 {count} 条",

  "testReq.toggle": "发送测试请求",
  "testReq.subtitle": "平台生成 · 与真实流量严格区分标记",
  "testReq.method": "方法",
  "testReq.contentType": "内容类型",
  "testReq.body": "请求体",
  "testReq.send": "发送到端点",
  "testReq.sent": "测试请求 #{seq} 已保存——标记为“测试请求”，绝不会冒充真实捕获。",
  "testReq.ok": "测试请求已保存。",
  "testReq.failed": "测试请求失败。",

  "request.back": "← 返回收件箱",
  "request.loading": "正在加载请求…",
  "request.unavailable": "请求不可用",
  "request.unavailableHint": "该请求无法加载。",
  "request.gone": "该请求已不存在——它已过期、被删除，或属于另一个端点。",
  "request.replay": "↻ 重放",
  "request.redactedTitle": "已脱敏 {count} 个敏感请求头：",
  "request.redactedNever": " —— 原始值从未被存储。",
  "request.redactedOptIn": "（该端点选择了保留，因此显示原值）",
  "request.body": "请求体",
  "request.formatted": "格式化",
  "request.fields": "字段",
  "request.raw": "原始",
  "request.copyBody": "复制请求体",
  "request.emptyTitle": "空请求体",
  "request.emptyHint": "该请求没有携带内容——GET/HEAD 探活请求很常见。",
  "request.binaryNote": "二进制内容——HookLab 绝不会把未知字节当作 HTML 渲染。以下为 base64 转写",
  "request.headers": "请求头",
  "request.copyAll": "全部复制",
  "request.noHeaders": "未捕获到请求头。",
  "request.query": "查询参数",
  "request.copyJson": "复制 JSON",
  "request.noQuery": "该请求没有查询参数。",
  "request.curl": "以 cURL 重放",
  "request.copyCurl": "复制 cURL",
  "request.curlNote": "脱敏的请求头显示为 [REDACTED]——请在本地替换为真实值后再执行。",
  "request.curlBinary": "# 已省略二进制请求体——请在请求体面板使用 Raw 的 base64 转写",
  "request.replayHistory": "重放记录",
  "request.emptyField": "（空）",
  "request.deleteTitle": "删除这条请求？",
  "request.deleteBody": "已存储的请求头、请求体将被立即删除，无法恢复。",
  "request.deleteConfirm": "删除请求",
  "request.deleted": "请求已删除。",
  "request.deleteFailed": "删除失败。",

  "replay.opening": "正在打开重放实验室…",
  "replay.title": "重放实验室",
  "replay.intro":
    "把捕获到的请求重新发送到你指定的目标。HookLab 会在每一跳之前校验目标：禁止内网 IP、云元数据端点与单标签主机名，重定向逐跳复查，并在响应后再次校验 DNS 结果以发现重绑定。",
  "replay.source": "源请求",
  "replay.loadingRequests": "正在加载请求…",
  "replay.noRequests": "还没有捕获到请求",
  "replay.noRequestsHint": "先向端点地址发送一条请求，再回来重放它。",
  "replay.goInbox": "前往收件箱",
  "replay.target": "目标 URL（必填）",
  "replay.targetPlaceholder": "https://your-staging-app.example.com/webhooks/test",
  "replay.method": "方法",
  "replay.includeBody": "携带捕获的请求体",
  "replay.extraHeaders": "额外请求头（每行一个，Name: value）",
  "replay.send": "开始重放",
  "replay.sending": "重放中…",
  "replay.limits": "每端点 20 次/分钟 · 200 次/天",
  "replay.guardNote":
    "按设计阻断：回环地址、RFC1918 内网段、链路本地、CGNAT、组播、IPv6 ULA/链路本地、IPv4 映射变体、.internal/.local 域名、云元数据地址、非 80/443/8080/8443 端口以及带凭据的 URL。",
  "replay.result": "结果",
  "replay.noResult": "尚未重放。选择一条请求、填写目标并发送——状态码、耗时与截断后的响应体会显示在这里。",
  "replay.received": "收到 {size}",
  "replay.truncated": "已截断",
  "replay.rebinding": "疑似 DNS 重绑定",
  "replay.kvTarget": "目标",
  "replay.kvFinal": "最终地址",
  "replay.kvHops": "跳转次数",
  "replay.redirectChain": "重定向链路（每一跳都会重新校验）：",
  "replay.respHeaders": "响应头",
  "replay.bodyPreview": "响应体预览（前 8 KB）",
  "replay.emptyResponse": "（响应体为空）",
  "replay.none": "（无）",
  "replay.history": "重放记录",
  "replay.noHistory": "还没有重放记录。",
  "replay.sentToast": "重放已发送——目标返回 {status}。",
  "replay.failedToast": "重放意外失败。",
  "replay.extraHeadersPlaceholder": "x-debug-run: 1\naccept: application/json",

  "settings.loading": "正在加载设置…",
  "settings.unavailable": "端点无法加载。",
  "settings.title": "端点设置",
  "settings.ingestUrl": "接收地址",
  "settings.token": "访问令牌（仅保存在当前浏览器）",
  "settings.copyToken": "复制令牌",
  "settings.newTokenTitle": "新令牌：",
  "settings.newTokenBody": "请立即复制。它已替换旧令牌，并已保存在当前浏览器。",
  "settings.stat.requests": "请求数",
  "settings.stat.storage": "存储用量",
  "settings.stat.expires": "到期时间",
  "settings.stat.retention": "保留时长",
  "settings.rowsSwept": "行数据自动清理",
  "settings.max": "上限 {value} 分钟",
  "settings.rename": "重命名",
  "settings.displayName": "显示名称",
  "settings.saveName": "保存名称",
  "settings.renamed": "端点已重命名。",
  "settings.renameFailed": "重命名失败。",
  "settings.limits": "限制",
  "settings.rateLimit": "入站限流（每分钟）",
  "settings.maxRequests": "最大存储请求数",
  "settings.saveLimits": "保存限制",
  "settings.limitsSaved": "限制已更新。",
  "settings.limitsFailed": "更新失败。",
  "settings.extend1h": "延长 1 小时",
  "settings.extend1d": "延长 1 天",
  "settings.pause": "⏸ 暂停端点",
  "settings.resume": "▶ 恢复端点",
  "settings.paused": "端点已暂停。",
  "settings.resumed": "端点已恢复。",
  "settings.statusFailed": "状态修改失败。",
  "settings.limitsNote":
    "暂停会阻止新的捕获，但不会删除已存请求。所有限制都由服务端执行，界面只负责展示。",
  "settings.dataControls": "数据控制",
  "settings.exportSummary": "导出脱敏报告",
  "settings.exportAll": "导出（含请求体）",
  "settings.purge": "删除全部请求",
  "settings.purged": "已删除全部捕获的请求。",
  "settings.purgeFailed": "清空失败。",
  "settings.exportOk": "报告已下载（敏感头已脱敏）。",
  "settings.exportFailed": "导出失败。",
  "settings.exportNote":
    "导出的内容包含所有已存请求，敏感请求头已替换为 [REDACTED]。只有“含请求体”版本会包含请求体，且每条上限 64 KB。",
  "settings.danger": "危险操作",
  "settings.rotate": "⟳ 轮换令牌",
  "settings.deleteEndpoint": "删除端点",
  "settings.dangerNote": "删除会移除该端点、全部捕获的请求以及重放记录，无法恢复。",
  "settings.purgeTitle": "删除全部捕获的请求？",
  "settings.purgeBody": "该端点存储的所有请求将被立即删除，端点本身保持运行。",
  "settings.purgeConfirm": "删除请求",
  "settings.rotateTitle": "轮换访问令牌？",
  "settings.rotateBody":
    "当前令牌会立即失效。任何使用旧令牌的地方都会失去访问权——包括本浏览器的其他标签页，直到它们获取新令牌。",
  "settings.rotateConfirm": "轮换令牌",
  "settings.rotateOk": "令牌已轮换——旧令牌立即失效。",
  "settings.rotateFailed": "轮换失败。",
  "settings.deleteTitle": "删除该端点？",
  "settings.deleteBody": "端点地址、全部请求与重放记录都会被销毁，无法恢复，令牌也无法找回。",
  "settings.deleteConfirm": "删除端点",
  "settings.deleted": "端点与全部已存请求已删除。",
  "settings.deleteFailed": "删除失败。",
  "settings.extended": "已延长至 {when}。",

  "err.network_error": "网络请求失败，请检查网络连接后重试。",
  "err.unknown": "发生未知错误。",
  "err.unauthorized": "该操作需要有效的端点令牌。",
  "err.missing_endpoint": "缺少端点 id。",
  "err.not_found": "未知的 API 路径。",
  "err.method_not_allowed": "此处不支持该请求方法。",
  "err.endpoint_not_found": "端点不存在，可能已过期并被删除。",
  "err.endpoint_expired": "端点已过期，不再接收请求。",
  "err.endpoint_paused": "端点已暂停，不会捕获请求。",
  "err.rate_limited": "该端点请求过于频繁，请稍后再试。",
  "err.endpoint_rate_limited": "该端点当前流量过大。",
  "err.payload_too_large": "请求体超过 128 KiB 上限，已被拒绝。",
  "err.request_quota_exceeded": "该端点已达到存储请求数上限，请创建新端点。",
  "err.storage_quota_exceeded": "该端点已达到存储配额，请删除旧请求或创建新端点。",
  "err.creation_rate_limited": "该网络今日创建端点数量已达上限，请明天再试。",
  "err.invalid_target": "目标必须是绝对 http(s) URL，且不能包含用户名密码。",
  "err.blocked_target": "目标主机是私有、回环、保留地址或云元数据端点，重放已被拒绝。",
  "err.blocked_port": "该端口不允许用于重放，请使用 80、443、8080 或 8443。",
  "err.host_not_allowlisted": "本部署限制了重放目标，该主机不在白名单中。",
  "err.dns_lookup_failed": "无法解析目标主机名。",
  "err.too_many_redirects": "目标重定向次数过多。",
  "err.replay_timeout": "目标在 10 秒内没有响应。",
  "err.replay_failed": "请求目标失败（网络、TLS 或主机不可达）。",
  "err.replay_rate_limited": "重放频率已达上限，请稍后再试。",
  "err.replay_quota_exceeded": "该端点今日重放次数已达上限。",
  "err.dns_rebinding_suspected": "重放过程中目标 DNS 结果变化为私有地址。",
  "err.missing_target": "必须指定目标 URL——HookLab 绝不会重放到隐含目标。",
  "err.invalid_method": "不支持该 HTTP 方法用于重放。",
  "err.request_not_found": "该请求不存在或已过期。",
  "err.nothing_to_update": "没有可更新的字段。",
  "err.invalid_json": "请求体不是合法 JSON。",
  "err.invalid_body": "无法读取请求体。",
  "err.body_read_error": "无法读取请求体。",
  "err.internal_error": "服务端发生意外错误，请重试。",
};

const DICTS: Record<Lang, Record<TextKey, string>> = { en, zh };

export const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" };

const STORAGE_KEY = "hooklab.lang";

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* storage may be unavailable */
  }
  const nav = typeof navigator === "undefined" ? "" : navigator.language || "";
  return /^zh\b/i.test(nav) ? "zh" : "en";
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export interface I18n {
  lang: Lang;
  locale: string;
  setLang: (lang: Lang) => void;
  toggle: () => void;
  t: (key: TextKey, vars?: Vars) => string;
  /** Localised message for a thrown error, falling back to the server text. */
  errorMessage: (err: unknown) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang());

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.documentElement.setAttribute("data-lang", lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const toggle = useCallback(() => setLangState((prev) => (prev === "en" ? "zh" : "en")), []);

  const t = useCallback(
    (key: TextKey, vars?: Vars) => {
      const template = DICTS[lang][key] ?? DICTS.en[key] ?? String(key);
      return interpolate(template, vars);
    },
    [lang],
  );

  const errorMessage = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) {
        const key = `err.${err.code}` as TextKey;
        if (DICTS[lang][key]) return DICTS[lang][key];
        if (DICTS.en[key]) return DICTS[lang] === DICTS.en ? err.message : DICTS[lang][key];
        return err.message;
      }
      return DICTS[lang]["err.unknown"];
    },
    [lang],
  );

  const value = useMemo<I18n>(
    () => ({ lang, locale: LOCALES[lang], setLang, toggle, t, errorMessage }),
    [lang, setLang, toggle, t, errorMessage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
