// sync.js — Supabase 同步层
// 在 data.js 之后加载。包装 WOMS.data 的写操作，使其异步同步到 Supabase；
// load 时优先从 Supabase 拉取填充内存，失败则用 localStorage。
// 未配置 WOMS_CONFIG 或网络不可用时，自动退回纯 localStorage 离线模式。
(function () {
  "use strict";
  var WOMS = window.WOMS = window.WOMS || {};
  var CFG = window.WOMS_CONFIG || {};
  var BASE = CFG.supabaseUrl ? CFG.supabaseUrl.replace(/\/$/, "") : "";
  var KEY = CFG.supabaseKey || "";
  var ENABLED = !!(BASE && KEY);
  var TABLE = "tickets";

  function logOk(op, id, extra) { try { console.log("[SYNC] " + op + " OK", id || "", extra || ""); } catch (e) {} }
  function logErr(op, id, msg) { try { console.error("[SYNC] " + op + " FAIL", id || "", msg || ""); } catch (e) {} }

  function headers(extra) {
    var h = {
      "Content-Type": "application/json",
      "apikey": KEY,
      "Authorization": "Bearer " + KEY,
      "Prefer": "return=representation"
    };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  // PK 探测已废弃：之前用 on_conflict 试错的方案在多 unique 约束的表上不可靠
  // (409 被误判成"约束存在"，导致选错冲突列)。现在写路径走 PATCH-first：
  // 先按 id 改，0 行才 POST 插入。不依赖任何 unique 探测。
  var _pkCol = null;
  function probePK(force) {
    if (!force && _pkCol) return Promise.resolve(_pkCol);
    console.warn("[SYNC] probePK is deprecated; write path now uses PATCH-first (id eq).");
    return Promise.resolve(_pkCol);
  }
  // 注意：history 直接发数组，不要 JSON.stringify 字符串化；
  // 之前 stringify 后发到 JSONB 列会被双重编码，PostgREST 不解析导致 upsert 400 失败。
  function toRow(t) {
    return {
      id: t.id, code: t.code, type: t.type, status: t.status, priority: t.priority,
      "customerAccount": t.customerAccount || "", assignee: t.assignee || "", grid: t.grid || "",
      address: t.address || "", "ticketDate": t.ticketDate || "", description: t.description || "",
      contact: t.contact || "", creator: t.creator || "", "createdAt": t.createdAt,
      "updatedAt": t.updatedAt, history: Array.isArray(t.history) ? t.history : [],
      deleted: !!t.deleted, "deletedAt": t.deletedAt || null, "deletedBy": t.deletedBy || null
    };
  }
  function fromRow(r) {
    var h = r.history;
    if (typeof h === "string") { try { h = JSON.parse(h); } catch (e) { h = []; } }
    if (!Array.isArray(h)) h = [];
    return {
      id: r.id, code: r.code, type: r.type, status: r.status, priority: r.priority,
      customerAccount: r["customerAccount"] || "", assignee: r.assignee || "", grid: r.grid || "",
      address: r.address || "", ticketDate: r["ticketDate"] || "", description: r.description || "",
      contact: r.contact || "", creator: r.creator || "",
      createdAt: r["createdAt"], updatedAt: r["updatedAt"],
      history: h, deleted: !!r.deleted, deletedAt: r["deletedAt"] || "", deletedBy: r["deletedBy"] || ""
    };
  }

  function parseErrBody(r) {
    return r.text().then(function (t) { return (t || "").slice(0, 300); }).catch(function () { return ""; });
  }

  function fetchAll() {
    return fetch(BASE + "/rest/v1/" + TABLE + "?select=*", { headers: headers() })
      .then(function (r) {
        if (!r.ok) return parseErrBody(r).then(function (b) { throw new Error("HTTP " + r.status + " " + (b || r.statusText)); });
        return r.json();
      })
      .then(function (rows) { return rows.map(fromRow); });
  }
  // PATCH-first upsert：不依赖 on_conflict / unique 探测
  // 流程：先按 id PATCH（命中就更新），PATCH 返回 0 行就 POST 插入；
  //       POST 遇 409 说明另一端抢先 INSERT 了同 id 行，回退到 PATCH。
  function upsertRow(row) {
    var patchUrl = BASE + "/rest/v1/" + TABLE + "?id=eq." + encodeURIComponent(row.id);
    return fetch(patchUrl, {
      method: "PATCH",
      headers: headers({ "Prefer": "return=representation" }),
      body: JSON.stringify(row)
    }).then(function (r) {
      if (r.ok) {
        return r.json().then(function (data) {
          if (data && data.length > 0) return;
          return insertRow(row);
        });
      }
      if (r.status === 404) return insertRow(row);
      return parseErrBody(r).then(function (b) {
        throw new Error("HTTP " + r.status + " " + (b || r.statusText) + " | id=" + (row && row.id));
      });
    });
  }
  function insertRow(row) {
    return fetch(BASE + "/rest/v1/" + TABLE, {
      method: "POST",
      headers: headers({ "Prefer": "return=representation" }),
      body: JSON.stringify([row])
    }).then(function (r) {
      if (r.ok) return;
      if (r.status === 409) return upsertRow(row);
      return parseErrBody(r).then(function (b) {
        throw new Error("HTTP " + r.status + " " + (b || r.statusText) + " | id=" + (row && row.id));
      });
    });
  }
  function upsert(t) {
    var row;
    try { row = toRow(t); }
    catch (e) { return Promise.reject(new Error("toRow error: " + e.message)); }
    return upsertRow(row).then(markSynced);
  }
  function upsertBatch(arr) {
    if (!arr.length) return Promise.resolve();
    var rows;
    try { rows = arr.map(toRow); }
    catch (e) { return Promise.reject(new Error("toRow error: " + e.message)); }
    var p = Promise.resolve();
    rows.forEach(function (row) { p = p.then(function () { return upsertRow(row); }); });
    return p.then(markSynced);
  }

  // 同步成功后打时间戳，避免 loadRemote 冲掉未同步的本地改动
  function markSynced() {
    try {
      var raw = localStorage.getItem(WOMS.STORAGE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      d.__lastSyncAt = new Date().toISOString();
      localStorage.setItem(WOMS.STORAGE_KEY, JSON.stringify(d));
    } catch (e) {}
  }
  function remove(id) {
    return fetch(BASE + "/rest/v1/" + TABLE + "?id=eq." + encodeURIComponent(id), {
      method: "DELETE", headers: headers()
    }).then(function (r) {
      if (!r.ok) return parseErrBody(r).then(function (b) { throw new Error("HTTP " + r.status + " " + (b || r.statusText)); });
      markSynced();
    });
  }

  var D = WOMS.data;
  if (!D) { logErr("init", "", "WOMS.data not found"); return; }
  var orig = {
    createTicket: D.createTicket, updateFields: D.updateFields, changeStatus: D.changeStatus,
    deleteTicket: D.deleteTicket, restoreTicket: D.restoreTicket, purgeTicket: D.purgeTicket,
    emptyRecycle: D.emptyRecycle, reset: D.reset
  };

  function getTicketIn(data, id) {
    for (var i = 0; i < data.tickets.length; i++) if (data.tickets[i].id === id) return data.tickets[i];
    for (var j = 0; j < (data.recycle || []).length; j++) if (data.recycle[j].id === id) return data.recycle[j];
    return null;
  }

  console.log("[SYNC] init, enabled=" + ENABLED + ", base=" + (BASE || "(none)"));

  if (ENABLED) {
    D.createTicket = function (data, fields, operator) {
      try {
        var t = orig.createTicket(data, fields, operator);
        upsert(t).then(function () { logOk("createTicket", t.id); })
                .catch(function (e) { logErr("createTicket", t.id, e.message); });
        return t;
      } catch (e) {
        logErr("createTicket", "", "SYNC: " + e.message);
        return orig.createTicket(data, fields, operator);
      }
    };
    D.updateFields = function (data, id, patch, note, operator) {
      try {
        var t = orig.updateFields(data, id, patch, note, operator);
        if (t) upsert(t).then(function () { logOk("updateFields", id); })
                       .catch(function (e) { logErr("updateFields", id, e.message); });
        return t;
      } catch (e) {
        logErr("updateFields", id, "SYNC: " + e.message);
        return orig.updateFields(data, id, patch, note, operator);
      }
    };
    D.changeStatus = function (data, id, to, note, operator) {
      try {
        var res = orig.changeStatus(data, id, to, note, operator);
        if (res && res.ok && res.ticket) upsert(res.ticket)
          .then(function () { logOk("changeStatus", id, to); })
          .catch(function (e) { logErr("changeStatus", id, e.message); });
        return res;
      } catch (e) {
        logErr("changeStatus", id, "SYNC: " + e.message);
        return orig.changeStatus(data, id, to, note, operator);
      }
    };
    D.deleteTicket = function (data, id, operator) {
      try {
        var ok = orig.deleteTicket(data, id, operator);
        if (ok) {
          var rec = (data.recycle || []).find(function (x) { return x.id === id; });
          if (rec) upsert(rec).then(function () { logOk("deleteTicket", id); })
                            .catch(function (e) { logErr("deleteTicket", id, e.message); });
        }
        return ok;
      } catch (e) {
        logErr("deleteTicket", id, "SYNC: " + e.message);
        return orig.deleteTicket(data, id, operator);
      }
    };
    D.restoreTicket = function (data, id, operator) {
      try {
        var ok = orig.restoreTicket(data, id, operator);
        if (ok) { var t = getTicketIn(data, id); if (t) upsert(t)
          .then(function () { logOk("restoreTicket", id); })
          .catch(function (e) { logErr("restoreTicket", id, e.message); }); }
        return ok;
      } catch (e) {
        logErr("restoreTicket", id, "SYNC: " + e.message);
        return orig.restoreTicket(data, id, operator);
      }
    };
    D.purgeTicket = function (data, id, operator) {
      try {
        var ok = orig.purgeTicket(data, id, operator);
        if (ok) remove(id).then(function () { logOk("purgeTicket", id); })
                          .catch(function (e) { logErr("purgeTicket", id, e.message); });
        return ok;
      } catch (e) {
        logErr("purgeTicket", id, "SYNC: " + e.message);
        return orig.purgeTicket(data, id, operator);
      }
    };
    D.emptyRecycle = function (data) {
      try {
        var ok = orig.emptyRecycle(data);
        if (ok) fetch(BASE + "/rest/v1/" + TABLE + "?deleted=eq.true", { method: "DELETE", headers: headers() })
          .then(function (r) { if (!r.ok) return parseErrBody(r).then(function (b) { throw new Error("HTTP " + r.status + " " + (b || r.statusText)); }); logOk("emptyRecycle", "", "rows=" + (data.recycle ? data.recycle.length : 0)); })
          .catch(function (e) { logErr("emptyRecycle", "", e.message); });
        return ok;
      } catch (e) {
        logErr("emptyRecycle", "", "SYNC: " + e.message);
        return orig.emptyRecycle(data);
      }
    };
    D.reset = function () {
      try {
        var seed = orig.reset();
        upsertBatch(seed.tickets || []).then(function () { logOk("reset", "", "rows=" + (seed.tickets || []).length); })
                                       .catch(function (e) { logErr("reset", "", e.message); });
        return seed;
      } catch (e) {
        logErr("reset", "", "SYNC: " + e.message);
        return orig.reset();
      }
    };
  }

  WOMS.sync = {
    enabled: ENABLED,
    base: BASE,
    table: TABLE,
    loadRemote: function (force) {
      if (!ENABLED) return Promise.resolve(false);
      // 有未同步的本地改动就不拉远程，避免被旧数据冲掉
      try {
        var raw = localStorage.getItem(WOMS.STORAGE_KEY);
        if (raw) {
          var d = JSON.parse(raw);
          if (d && d.__lastChangeAt && (!d.__lastSyncAt || d.__lastChangeAt > d.__lastSyncAt) && !force) {
            console.warn("[SYNC] loadRemote skipped: unsynced local changes (lastChange=" + d.__lastChangeAt + " > lastSync=" + (d.__lastSyncAt || "(none)") + "). Pass force=true to override.");
            return Promise.resolve(false);
          }
        }
      } catch (e) {}
      return fetchAll().then(function (rows) {
        var tickets = rows.filter(function (t) { return !t.deleted; });
        var recycle = rows.filter(function (t) { return t.deleted; });
        tickets.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
        recycle.sort(function (a, b) { return (a.deletedAt || "") < (b.deletedAt || "") ? 1 : -1; });
        var data = { tickets: tickets, recycle: recycle };
        try { localStorage.setItem(WOMS.STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
        logOk("loadRemote", "", "tickets=" + tickets.length + " recycle=" + recycle.length);
        return data;
      }).catch(function (e) { logErr("loadRemote", "", e.message); return false; });
    },
    pushAll: function (data) {
      if (!ENABLED) return Promise.resolve(false);
      // 按 id 去重：tickets（未删）优先于 recycle（已删）；同 id 只发一条
      // 防止同一 id 在 tickets/recycle 双侧出现或单侧多次出现，
      // 导致一个 batch 内 upsert 触发 unique constraint（HTTP 409）。
      var seen = Object.create(null);
      var all = [];
      var dupTicketsIds = [], dupRecycleIds = [], dupBothIds = [];
      (data.tickets || []).forEach(function (t) {
        if (!t || !t.id) return;
        if (seen[t.id]) {
          if (seen[t.id] === "tickets") dupTicketsIds.push(t.id);
          else dupBothIds.push(t.id);
          return;
        }
        seen[t.id] = "tickets"; all.push(t);
      });
      (data.recycle || []).forEach(function (t) {
        if (!t || !t.id) return;
        if (seen[t.id]) {
          if (seen[t.id] === "tickets") dupBothIds.push(t.id);
          else dupRecycleIds.push(t.id);
          return;
        }
        seen[t.id] = "recycle"; all.push(t);
      });
      if (dupTicketsIds.length || dupRecycleIds.length || dupBothIds.length) {
        console.warn("[SYNC] pushAll deduped: dupInTickets=" + dupTicketsIds.length + (dupTicketsIds.length ? " ids=" + dupTicketsIds.join(",") : "") +
                     " dupInRecycle=" + dupRecycleIds.length + (dupRecycleIds.length ? " ids=" + dupRecycleIds.join(",") : "") +
                     " dupBoth=" + dupBothIds.length + (dupBothIds.length ? " ids=" + dupBothIds.join(",") : "") +
                     " (data 内部重复，已自动跳过；建议在控制台执行 WOMS.data.reset() 重置数据)");
      }
      if (!all.length) { logOk("pushAll", "", "empty"); return Promise.resolve(true); }
      return upsertBatch(all).then(function () { logOk("pushAll", "", "rows=" + all.length); return true; })
                              .catch(function (e) { logErr("pushAll", "", "rows=" + all.length + " " + e.message); return false; });
    },
    pushNow: function () {
      if (!ENABLED) { console.warn("[SYNC] pushNow: sync not enabled"); return Promise.resolve(false); }
      try { return this.pushAll(WOMS.data.load()); }
      catch (e) { logErr("pushNow", "", e.message); return Promise.resolve(false); }
    },
    probePK: function (force) { return probePK(force); },
    setPK: function (col) { _pkCol = col; console.log("[SYNC] PK manually set to:", col); },
    getPK: function () { return _pkCol; },
    resetPKCache: function () { _pkCol = null; console.log("[SYNC] PK cache cleared"); }
  };
})();
