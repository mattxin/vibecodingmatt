// auth.js - 真实安全鉴权（Supabase GoTrue，fetch 直连，无 SDK）
// 登录态：access_token / refresh_token 存 localStorage，密码由服务端校验。
// 角色：登录后从 profiles 表读取（服务端权威，用户不可篡改）。
// 离线兜底：验 session 网络失败时，沿用本地 session 进入只读模式。
(function () {
  "use strict";
  var WOMS = window.WOMS = window.WOMS || {};
  var CFG = window.WOMS_CONFIG || {};
  var BASE = CFG.supabaseUrl ? CFG.supabaseUrl.replace(/\/$/, "") : "";
  var KEY = CFG.supabaseKey || "";
  var SESSION_KEY = "woms_session_v1";

  // 账号 -> email 映射；登录用 email+password 调 GoTrue。
  // name 仅为 profiles 取不到时的兜底显示，权威角色/姓名来自 profiles 表。
  var ACCOUNT_MAP = {
    admin:     { email: "admin@woms.cn",     name: "系统管理员" },
    zhangwei:  { email: "zhangwei@woms.cn",  name: "张伟" },
    lina:      { email: "lina@woms.cn",      name: "李娜" },
    wangqiang: { email: "wangqiang@woms.cn", name: "王强" },
    liuyang:   { email: "liuyang@woms.cn",   name: "刘洋" },
    chenjing:  { email: "chenjing@woms.cn",  name: "陈静" }
  };

  function apiHeaders(token) {
    var h = { "Content-Type": "application/json", "apikey": KEY };
    h["Authorization"] = "Bearer " + (token || KEY);
    return h;
  }
  function resolveEmail(account) {
    var a = (account || "").trim();
    if (!a) return "";
    if (a.indexOf("@") >= 0) return a;
    var m = ACCOUNT_MAP[a];
    return m ? m.email : (a + "@woms.cn");
  }
  function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
  function loadSession() { try { var r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

  function current() { return loadSession(); }
  function isLoggedIn() { var s = loadSession(); return !!(s && s.access_token); }
  function accessToken() { var s = loadSession(); return s ? s.access_token : ""; }

  function fetchProfile(session) {
    session = session || loadSession();
    if (!session || !session.access_token || !session.user_id) return Promise.resolve(null);
    var url = BASE + "/rest/v1/profiles?id=eq." + encodeURIComponent(session.user_id) + "&select=role,name";
    return fetch(url, { headers: apiHeaders(session.access_token) })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (arr) { return (arr && arr.length) ? arr[0] : null; })
      .catch(function () { return null; });
  }

  // 登录：POST /auth/v1/token?grant_type=password
  function login(account, password) {
    var email = resolveEmail(account);
    if (!email) return Promise.resolve({ ok: false, msg: "请输入账号" });
    if (!BASE || !KEY) return Promise.resolve({ ok: false, msg: "未配置 Supabase" });
    return fetch(BASE + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        var j = res.body || {};
        if (j.error) {
          var msg = j.error_description || j.msg || "登录失败";
          if (j.error_code === "email_not_confirmed") msg = "账号未确认邮箱，请联系管理员";
          if (res.status === 400 && /invalid/i.test(j.error)) msg = "账号或密码错误";
          return { ok: false, msg: msg };
        }
        if (!j.access_token) return { ok: false, msg: "登录失败" };
        var session = {
          access_token: j.access_token,
          refresh_token: j.refresh_token,
          expires_at: j.expires_at,
          user_id: (j.user && j.user.id) || "",
          email: email,
          account: account,
          name: (j.user && j.user.user_metadata && j.user.user_metadata.name) || (ACCOUNT_MAP[account] && ACCOUNT_MAP[account].name) || email,
          role: "assignee"
        };
        saveSession(session);
        WOMS.role = session.role;
        WOMS.currentUser = session.name;
        return fetchProfile(session).then(function (p) {
          if (p) { session.role = p.role || session.role; session.name = p.name || session.name; saveSession(session); WOMS.role = session.role; WOMS.currentUser = session.name; }
          return { ok: true, session: session };
        });
      });
  }

  // 验证当前 session：调 /auth/v1/user。401 清 session；网络错保留(离线兜底)。
  function verifySession() {
    var s = loadSession();
    if (!s || !s.access_token) return Promise.resolve(null);
    return fetch(BASE + "/auth/v1/user", { headers: apiHeaders(s.access_token) })
      .then(function (r) {
        if (r.status === 401) { clearSession(); return null; }
        if (!r.ok) { WOMS.role = s.role; WOMS.currentUser = s.name; return { offline: true, session: s }; }
        return r.json().then(function () {
          return fetchProfile(s).then(function (p) {
            if (p) { s.role = p.role; s.name = p.name; saveSession(s); }
            WOMS.role = s.role; WOMS.currentUser = s.name;
            return { offline: false, session: s };
          }).catch(function () { WOMS.role = s.role; WOMS.currentUser = s.name; return { offline: false, session: s }; });
        });
      })
      .catch(function () { WOMS.role = s.role; WOMS.currentUser = s.name; return { offline: true, session: s }; });
  }

  function logout() {
    var s = loadSession();
    clearSession();
    WOMS.role = "admin"; WOMS.currentUser = "系统管理员";
    if (s && s.access_token && BASE) {
      return fetch(BASE + "/auth/v1/logout", { method: "POST", headers: apiHeaders(s.access_token) })
        .then(function () { return true; }).catch(function () { return true; });
    }
    return Promise.resolve(true);
  }

  function applySession() {
    var s = loadSession();
    if (s) { WOMS.role = s.role || "assignee"; WOMS.currentUser = s.name || ""; }
    return s;
  }

  WOMS.auth = {
    login: login, logout: logout, current: current, isLoggedIn: isLoggedIn,
    applySession: applySession, verifySession: verifySession,
    accessToken: accessToken, fetchProfile: fetchProfile, accountMap: ACCOUNT_MAP
  };
})();