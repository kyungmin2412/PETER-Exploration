(function () {
  "use strict";
  const model = window.PeterIpoModel;
  const FILE = "ipos.json";
  const CACHE = "peterExplorationIpos.v1";
  const PENDING = "peterExplorationIpos.pending.v1";
  const byId = id => document.getElementById(id);
  const form = byId("ipoForm");
  const dialog = byId("ipoDialog");
  const grid = byId("ipoCalendarGrid");
  const dayList = byId("ipoDayList");
  let records = readLocal(CACHE);
  let pending = readLocal(PENDING);
  records = model.merge(records, pending);
  const now = new Date();
  let month = new Date(now.getFullYear(), now.getMonth(), 1);
  let selected = makeDateKey(now.getFullYear(), now.getMonth(), now.getDate());
  let stageFilter = "all";
  let editingId = null;
  let undoRecord = null;
  let busy = false;
  let remoteLoaded = false;
  let pendingAuthorization = false;
  let readLimited = false;

  function readLocal(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      if (!value || Array.isArray(value) || typeof value !== "object") return {};
      return Object.fromEntries(Object.entries(value).filter(([id, item]) => item && item.id === id && typeof item.company === "string"));
    } catch (_) { return {}; }
  }
  function persist() {
    try {
      // Persist the pending queue first, so reloads cannot lose unsent edits.
      localStorage.setItem(PENDING, JSON.stringify(pending));
      localStorage.setItem(CACHE, JSON.stringify(records));
      byId("ipoStorageWarning").hidden = true;
    } catch (_) { byId("ipoStorageWarning").hidden = false; }
  }
  function status(text, error) {
    byId("ipoSyncStatus").textContent = text;
    byId("ipoSyncStatus").dataset.state = error ? "error" : "ok";
  }
  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function action(text, className, handler) {
    const button = element("button", className, text);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
  }
  function matchingRecords() {
    const query = byId("ipoSearchInput").value;
    return Object.values(records).filter(item => model.matches(item, query))
      .sort((a, b) => a.company.localeCompare(b.company, "ko"));
  }
  function dayEntries(key) {
    return matchingRecords().flatMap(record => model.occurrences(record, key, stageFilter).map(stage => ({ record, stage })));
  }
  function stageLabel(stage, record, key) {
    return stage.key === "subscription" && key === record.subscriptionEnd ? "청약 마감" : stage.label;
  }
  function dateText(date) { return date ? date.replaceAll("-", ".") : "미정"; }
  function rangeText(start, end) { return !start ? "미정" : start === end ? dateText(start) : dateText(start) + " – " + dateText(end); }
  function render() {
    renderCalendar();
    renderDetails();
  }
  function renderCalendar() {
    const year = month.getFullYear(), m = month.getMonth();
    const lastDay = new Date(year, m + 1, 0).getDate();
    const freshNow = new Date();
    const todayKey = makeDateKey(freshNow.getFullYear(), freshNow.getMonth(), freshNow.getDate());
    byId("ipoMonthTitle").textContent = year + "년 " + (m + 1) + "월";
    grid.replaceChildren();
    const companyIds = new Set(), subscriptionIds = new Set(), listingIds = new Set();
    for (let i = 0; i < month.getDay(); i++) {
      const empty = element("div", "day empty");
      empty.setAttribute("aria-hidden", "true");
      grid.appendChild(empty);
    }
    for (let day = 1; day <= lastDay; day++) {
      const key = makeDateKey(year, m, day);
      const weekday = new Date(year, m, day).getDay();
      const entries = dayEntries(key);
      for (const entry of entries) {
        companyIds.add(entry.record.id);
        if (entry.stage.key === "subscription") subscriptionIds.add(entry.record.id);
        if (entry.stage.key === "listing") listingIds.add(entry.record.id);
      }
      const button = action("", "day", () => { selected = key; render(); });
      button.classList.toggle("sunday", weekday === 0 || Boolean(HOLIDAYS[key]));
      button.classList.toggle("saturday", weekday === 6 && !HOLIDAYS[key]);
      button.classList.toggle("today", key === todayKey);
      button.classList.toggle("selected", key === selected);
      button.setAttribute("aria-pressed", String(key === selected));
      button.setAttribute("aria-label", year + "년 " + (m + 1) + "월 " + day + "일" + (HOLIDAYS[key] ? ", " + HOLIDAYS[key] : "") + ", 공모주 일정 " + entries.length + "건");
      if (key === todayKey) button.setAttribute("aria-current", "date");
      button.appendChild(element("span", "day-number", String(day)));
      if (HOLIDAYS[key]) button.appendChild(element("span", "holiday-chip", HOLIDAYS[key]));
      for (const { record, stage } of entries.slice(0, 3)) {
        const label = stageLabel(stage, record, key) + " · " + record.company;
        const chip = element("span", "ipo-chip ipo-" + stage.key, label);
        chip.title = label;
        button.appendChild(chip);
      }
      if (entries.length > 3) button.appendChild(element("span", "ipo-more", "+" + (entries.length - 3) + "건 더보기"));
      grid.appendChild(button);
    }
    byId("ipoMonthSummary").textContent = companyIds.size
      ? "현재 조건 · " + companyIds.size + "개 기업 · 청약 " + subscriptionIds.size + "건 · 상장 " + listingIds.size + "건"
      : "현재 조건에 해당하는 일정이 없어요. 날짜를 선택해 일정을 추가해 보세요.";
  }
  function renderDetails() {
    byId("ipoDetailLabel").textContent = selected.slice(0, 4) + "년 공모주 · 선택한 날짜";
    byId("ipoSelectedDate").textContent = formatSelectedDate(selected);
    dayList.replaceChildren();
    const groups = new Map();
    for (const entry of dayEntries(selected)) {
      if (!groups.has(entry.record.id)) groups.set(entry.record.id, { record: entry.record, stages: [] });
      groups.get(entry.record.id).stages.push(entry.stage);
    }
    if (!groups.size) {
      const empty = element("div", "empty-state");
      empty.append(element("span", "empty-icon", "🌱"), element("strong", "", "이 날짜에 공모주 일정이 없어요"));
      empty.appendChild(element("p", "", stageFilter !== "all" || byId("ipoSearchInput").value ? "검색어나 일정 종류를 바꾸어 확인해 보세요." : "수요예측부터 상장일까지\n필요한 일정을 함께 모아보세요."));
      empty.appendChild(action("+ 공모주 일정 추가", "ipo-empty-button", () => openForm()));
      dayList.appendChild(empty);
    }
    for (const { record, stages } of groups.values()) {
      const article = element("article", "event-item ipo-item");
      const badges = element("div", "ipo-badges");
      stages.forEach(stage => badges.appendChild(element("span", "ipo-badge ipo-" + stage.key, stageLabel(stage, record, selected))));
      article.append(badges, element("h3", "", record.company), element("p", "ipo-market", record.market || "시장 미정"));
      const info = element("dl", "ipo-info");
      const rows = [
        ["주관사", record.broker || "미정"], ["공모가", record.price || "미정"],
        ["수요예측", rangeText(record.demandStart, record.demandEnd)],
        ["청약", rangeText(record.subscriptionStart, record.subscriptionEnd)],
        ["환불", dateText(record.refundDate)], ["상장", dateText(record.listingDate)]
      ];
      rows.forEach(([label, value]) => info.append(element("dt", "", label), element("dd", "", value)));
      article.appendChild(info);
      if (record.sourceUrl) {
        try {
          const url = new URL(record.sourceUrl);
          if (["https:", "http:"].includes(url.protocol)) {
            const link = element("a", "ipo-source", "공고 / 참고 자료 ↗");
            link.href = url.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            article.appendChild(link);
          }
        } catch (_) { /* Invalid remote links are not rendered. */ }
      }
      if (record.memo) article.appendChild(element("p", "ipo-memo", record.memo));
      const actions = element("div", "ipo-actions");
      actions.append(action("수정", "", () => openForm(record.id)), action("삭제", "ipo-delete", () => deleteRecord(record.id)));
      article.appendChild(actions);
      dayList.appendChild(article);
    }
  }
  function openForm(id) {
    editingId = id || null;
    form.reset();
    byId("ipoFormError").hidden = true;
    const record = id ? records[id] : null;
    if (record) model.fields.forEach(field => { form.elements.namedItem(field).value = record[field] || ""; });
    else {
      // Default the selected milestone to the selected calendar day.
      const stage = model.stages.find(item => item.key === stageFilter) || model.stages[1];
      form.elements.namedItem(stage.start).value = selected;
      form.elements.namedItem(stage.end).value = selected;
    }
    byId("ipoDialogTitle").textContent = record ? "공모주 일정 수정" : "공모주 일정 추가";
    byId("ipoSubmitButton").textContent = record ? "변경 내용 저장" : "공모주 일정 저장";
    dialog.showModal();
    byId("ipoCompany").focus();
  }
  function changeRecord(record) {
    const next = { ...record, revision: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    records = { ...records, [next.id]: next };
    pending = { ...pending, [next.id]: next };
    persist();
    render();
    status("이 기기에 저장 · 공유 저장 대기", true);
    sync(true);
  }
  function deleteRecord(id) {
    const record = records[id];
    if (!record || record.deleted || !window.confirm(record.company + "의 공모주 일정을 삭제할까요? 이 기업의 모든 날짜에서 함께 삭제됩니다.")) return;
    undoRecord = { ...record };
    changeRecord({ ...record, deleted: true });
    byId("ipoUndoBar").hidden = false;
    showToast("공모주 일정을 삭제했어요. 되돌리기로 복구할 수 있어요.");
  }
  function receiveRemoteFile(file) {
    // This is called by the existing shared-calendar poll. A malformed IPO
    // file must never interrupt synchronization of visits or earnings.
    try {
      const remote = model.parseFile(file);
      records = model.merge(remote, pending);
      remoteLoaded = true;
      persist();
      if (!byId("ipoView").hidden) render();
      if (!busy) {
        status(Object.keys(pending).length ? "이 기기에 저장 · 공유 저장 대기" : "공유 저장됨", Boolean(Object.keys(pending).length));
        if (Object.keys(pending).length && gistToken) sync(false);
      }
    } catch (_) { status("일정을 읽지 못했어요 · 새로고침 필요", true); }
  }
  async function getRemote() {
    const headers = { Accept: "application/vnd.github+json" };
    if (gistToken) headers.Authorization = "token " + gistToken;
    const response = await fetch("https://api.github.com/gists/" + GIST_ID + "?_=" + Date.now(), { headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (response.status === 401 && gistToken) {
      gistToken = "";
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      return getRemote();
    }
    if (!response.ok) {
      const error = new Error("IPO GET " + response.status);
      if (response.status === 403 || response.status === 429) {
        const details = await response.json().catch(() => ({}));
        error.rateLimited = response.status === 429 || /rate limit/i.test(details.message || "");
      }
      throw error;
    }
    readLimited = false;
    byId("ipoSyncButton").textContent = "새로고침";
    const gist = await response.json();
    if (!gist.files || typeof gist.files !== "object") throw new Error("Invalid Gist response");
    return model.parseFile(gist.files[FILE]);
  }
  async function sync(interactive) {
    if (busy) {
      pendingAuthorization = pendingAuthorization || Boolean(interactive);
      return;
    }
    busy = true;
    let succeeded = false;
    let didWrite = false;
    status("공모주 동기화 중");
    try {
      // Obtain the user's existing access code before an authenticated read
      // when saving, including when anonymous API reads are rate limited.
      if (interactive && (Object.keys(pending).length || readLimited) && !gistToken) {
        if (!ensureToken()) throw new Error("no token");
      }
      const remote = await getRemote();
      remoteLoaded = true;
      const snapshot = { ...pending };
      if (Object.keys(snapshot).length) {
        const token = interactive ? ensureToken() : gistToken;
        if (!token) throw new Error("no token");
        const merged = model.merge(remote, snapshot);
        // PATCH only the dedicated file: older calendar clients may keep
        // writing events.json / events.ics without ever removing IPO data.
        const response = await fetch("https://api.github.com/gists/" + GIST_ID, {
          method: "PATCH",
          signal: AbortSignal.timeout(15000),
          headers: { Accept: "application/vnd.github+json", Authorization: "token " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify({ version: 1, items: merged }) } } })
        });
        if (!response.ok) {
          if (response.status === 401) { gistToken = ""; localStorage.removeItem(TOKEN_STORAGE_KEY); }
          throw new Error("IPO PATCH " + response.status);
        }
        for (const [id, saved] of Object.entries(snapshot)) {
          // Do not clear a newer edit made while this request was in flight.
          if (pending[id] && pending[id].revision === saved.revision) delete pending[id];
        }
        records = model.merge(merged, pending);
        didWrite = true;
      } else records = remote;
      persist();
      status(Object.keys(pending).length ? "추가 변경 저장 중" : "공유 저장됨");
      succeeded = true;
    } catch (error) {
      if (error.rateLimited) {
        readLimited = true;
        status(Object.keys(pending).length ? "기기에 저장됨 · 조회 한도 초과" : "조회 한도 초과 · 잠시 후 다시 시도", true);
        if (!gistToken) byId("ipoSyncButton").textContent = "접근 코드 연결";
      } else {
        status(Object.keys(pending).length ? "이 기기에 저장 · 공유 저장 대기" : "연결 실패 · 저장된 일정 표시", true);
      }
    } finally {
      busy = false;
      if (!byId("ipoView").hidden) render();
    }
    if (didWrite && !Object.keys(pending).length) showToast("공모주 일정이 공유 저장됐어요");
    const authorize = pendingAuthorization;
    pendingAuthorization = false;
    if (Object.keys(pending).length && (succeeded || authorize)) sync(authorize);
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(form);
    const values = Object.fromEntries(model.fields.map(field => [field, String(data.get(field) || "").trim()]));
    let error = model.validate(values);
    if (editingId && (!records[editingId] || records[editingId].deleted)) error = "다른 곳에서 삭제된 일정이에요. 입력창을 닫고 새 일정으로 추가해 주세요.";
    if (error) {
      byId("ipoFormError").textContent = error;
      byId("ipoFormError").hidden = false;
      byId("ipoFormError").scrollIntoView({ block: "nearest" });
      return;
    }
    const next = { ...(editingId ? records[editingId] : {}), ...values, id: editingId || crypto.randomUUID(), deleted: false };
    if (!model.occurrences(next, selected).length) {
      selected = model.stages.map(stage => next[stage.start]).filter(Boolean).sort()[0];
      const [year, m] = selected.split("-").map(Number);
      month = new Date(year, m - 1, 1);
    }
    stageFilter = "all";
    byId("ipoSearchInput").value = "";
    updateFilterButtons();
    dialog.close();
    changeRecord(next);
  });
  function updateFilterButtons() {
    byId("ipoStageFilters").querySelectorAll("button").forEach(button => {
      const active = button.dataset.stage === stageFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  byId("ipoStageFilters").addEventListener("click", event => {
    const button = event.target.closest("button[data-stage]");
    if (!button) return;
    stageFilter = button.dataset.stage;
    updateFilterButtons();
    render();
  });
  byId("ipoPreviousMonth").addEventListener("click", () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); renderCalendar(); });
  byId("ipoNextMonth").addEventListener("click", () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); renderCalendar(); });
  byId("ipoTodayButton").addEventListener("click", () => {
    const date = new Date();
    month = new Date(date.getFullYear(), date.getMonth(), 1);
    selected = makeDateKey(date.getFullYear(), date.getMonth(), date.getDate());
    render();
  });
  byId("ipoSearchInput").addEventListener("input", render);
  byId("ipoAddButton").addEventListener("click", () => openForm());
  byId("ipoCloseDialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  byId("ipoUndoButton").addEventListener("click", () => {
    if (!undoRecord) return;
    changeRecord({ ...undoRecord, deleted: false });
    undoRecord = null;
    byId("ipoUndoBar").hidden = true;
  });
  byId("ipoSyncButton").addEventListener("click", () => sync(true));
  byId("ipoTabButton").addEventListener("click", () => setActiveTab("ipo"));
  window.addEventListener("online", () => sync(false));
  window.addEventListener("storage", event => {
    if (event.key === PENDING || event.key === CACHE) {
      // Merge other tabs' pending revisions without dropping this tab's edits.
      const other = readLocal(PENDING);
      for (const [id, item] of Object.entries(other)) {
        if (!pending[id] || (item.updatedAt || "") > (pending[id].updatedAt || "")) pending[id] = item;
      }
      records = model.merge(readLocal(CACHE), pending);
      if (!byId("ipoView").hidden) render();
    }
  });
  setInterval(() => {
    if (document.visibilityState === "visible" && Object.keys(pending).length && gistToken) sync(false);
  }, POLL_INTERVAL_MS);
  window.PeterIpo = {
    receiveRemoteFile,
    refresh: function () { render(); if (!remoteLoaded || Object.keys(pending).length) sync(false); }
  };
  render();
})();
