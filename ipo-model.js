(function (root, factory) {
  const model = factory();
  if (typeof module === "object" && module.exports) module.exports = model;
  else root.PeterIpoModel = model;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  const stages = [
    { key: "subscription", label: "청약", start: "subscriptionStart", end: "subscriptionEnd" },
    { key: "refund", label: "환불", start: "refundDate", end: "refundDate" },
    { key: "listing", label: "상장", start: "listingDate", end: "listingDate" }
  ];
  const fields = ["company", "market", "broker", "price", "subscriptionStart", "subscriptionEnd", "refundDate", "listingDate", "sourceUrl", "memo"];
  const dateFields = [...new Set(stages.flatMap(stage => [stage.start, stage.end]))];
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    if (year < 1000 || year > 9999) return false;
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }
  function validate(record) {
    if (!record.company || !record.company.trim()) return "기업명을 입력해 주세요.";
    for (const field of dateFields) if (record[field] && !validDate(record[field])) return "올바른 날짜를 입력해 주세요.";
    for (const stage of stages.filter(item => item.start !== item.end)) {
      const start = record[stage.start], end = record[stage.end];
      if (Boolean(start) !== Boolean(end)) return stage.label + " 시작일과 종료일을 모두 입력해 주세요.";
      if (start && start > end) return stage.label + " 종료일은 시작일보다 빠를 수 없어요.";
    }
    if (!dateFields.some(field => record[field])) return "청약·환불·상장 중 하나 이상의 일정을 입력해 주세요.";
    if (record.sourceUrl) {
      try { if (!["http:", "https:"].includes(new URL(record.sourceUrl).protocol)) return "참고 링크는 http 또는 https 주소를 입력해 주세요."; }
      catch (_) { return "올바른 참고 링크 주소를 입력해 주세요."; }
    }
    return "";
  }
  function occurrences(record, dateKey, filter = "all", holidays = {}) {
    if (record.deleted) return [];
    const [year, month, day] = dateKey.split("-").map(Number);
    const weekday = new Date(year, month - 1, day).getDay();
    const closed = weekday === 0 || weekday === 6 || Boolean(holidays[dateKey]);
    return stages.filter(stage => (filter === "all" || filter === stage.key) &&
      !(record.businessDaysOnly && closed && stage.key === "subscription") &&
      validDate(record[stage.start]) && validDate(record[stage.end]) &&
      record[stage.start] <= dateKey && record[stage.end] >= dateKey);
  }
  function matches(record, query) {
    return !record.deleted && (String(record.company || "") + " " + String(record.broker || "")).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }
  function parseFile(file) {
    if (!file) return {};
    if (file.truncated) throw new Error("IPO file is truncated");
    const data = JSON.parse(file.content);
    if (!data || data.version !== 1 || !data.items || typeof data.items !== "object" || Array.isArray(data.items)) throw new Error("Invalid IPO file");
    for (const [id, item] of Object.entries(data.items)) {
      if (!item || typeof item !== "object" || item.id !== id || typeof item.company !== "string") throw new Error("Invalid IPO record");
    }
    return data.items;
  }
  function merge(base, changes) { return { ...base, ...changes }; }
  return { stages, fields, validDate, validate, occurrences, matches, parseFile, merge };
});
