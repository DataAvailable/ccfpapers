const state = {
  direction: "all",
  venue: "all",
  year: "all",
  type: "all",
  status: "all",
  query: "",
  sort: "default",
  page: 1,
  pageSize: 50,
  catalog: null,
  papers: [],
  ratings: {},
  globalRatings: {},
};

const els = {
  directionList: document.querySelector("#direction-list"),
  venueGrid: document.querySelector("#venue-grid"),
  paperList: document.querySelector("#paper-list"),
  paperPagination: document.querySelector("#paper-pagination"),
  directionTitle: document.querySelector("#direction-title"),
  venueSummary: document.querySelector("#venue-summary"),
  query: document.querySelector("#query"),
  year: document.querySelector("#year-filter"),
  type: document.querySelector("#type-filter"),
  status: document.querySelector("#status-filter"),
  sort: document.querySelector("#sort-filter"),
  statDirections: document.querySelector("#stat-directions"),
  statVenues: document.querySelector("#stat-venues"),
  statPapers: document.querySelector("#stat-papers"),
};

const RATING_STORAGE_KEY = "ccf-a-paper-ratings";
const SHARED_RATING_ENDPOINT = typeof window !== "undefined" ? window.CCF_RATING_API_URL : "";
const RATING_OPTIONS = [5, 4, 3, 2, 1, 0];

function loadRatings() {
  try {
    return JSON.parse(localStorage.getItem(RATING_STORAGE_KEY) || "{}");
  } catch (error) {
    console.warn("Cannot load ratings", error);
    return {};
  }
}

function saveRatings() {
  try {
    localStorage.setItem(RATING_STORAGE_KEY, JSON.stringify(state.ratings));
  } catch (error) {
    console.warn("Cannot save ratings", error);
  }
}

function hasRating(paperId) {
  return Object.prototype.hasOwnProperty.call(state.ratings, paperId);
}

function paperScore(paper) {
  return hasRating(paper.id) ? Number(state.ratings[paper.id]) : null;
}

function formatScore(score) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function ratingText(score) {
  return score === null ? "未评分" : formatScore(score) + " 分";
}

function normalizeScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) {
    return null;
  }
  return Math.min(5, Math.max(0, Math.round(score * 10) / 10));
}

function normalizeGlobalRatings(payload) {
  const source = payload?.ratings ?? payload ?? {};
  return Object.fromEntries(
    Object.entries(source).map(([paperId, value]) => {
      const count = Math.max(0, Number(value.count ?? 0));
      const total = Number(value.total ?? 0);
      const average = count ? Number(value.average ?? total / count) : null;
      return [paperId, { total, count, average }];
    }),
  );
}

function globalRatingStats(paperId) {
  const stats = state.globalRatings[paperId];
  if (!stats || !stats.count) {
    return { total: 0, count: 0, average: null };
  }
  return stats;
}

function globalRatingText(paperId) {
  const stats = globalRatingStats(paperId);
  if (!stats.count) {
    return "暂无";
  }
  return stats.average.toFixed(1) + " 分 / " + stats.count + " 人";
}

function globalRatingClass(paperId) {
  const average = globalRatingStats(paperId).average;
  return average !== null && average > 3 ? "rating-global hot" : "rating-global";
}

function applyLocalRatingToGlobal(paperId, score, previousScore) {
  const stats = globalRatingStats(paperId);
  const nextCount = previousScore === null ? stats.count + 1 : stats.count;
  const nextTotal = stats.total + score - (previousScore ?? 0);
  state.globalRatings[paperId] = {
    total: nextTotal,
    count: nextCount,
    average: nextCount ? nextTotal / nextCount : null,
  };
}

async function submitSharedRating(paperId, score) {
  if (!SHARED_RATING_ENDPOINT) {
    return;
  }
  try {
    const response = await fetch(SHARED_RATING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId, score }),
    });
    if (!response.ok) {
      throw new Error(`Rating API returned ${response.status}`);
    }
  } catch (error) {
    console.warn("Cannot submit shared rating", error);
  }
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Cannot load ${path}`);
  }
  return response.json();
}

async function loadOptionalJson(path, fallback) {
  try {
    return await loadJson(path);
  } catch (error) {
    console.warn(`Cannot load optional ${path}`, error);
    return fallback;
  }
}

async function boot() {
  try {
    const [catalog, globalRatingPayload, ...paperYears] = await Promise.all([
      loadJson("data/ccf-a-venues.json"),
      loadOptionalJson("data/paper-ratings.json", { ratings: {} }),
      ...[2023, 2024, 2025, 2026].map((year) => loadJson("data/papers/" + year + ".json")),
    ]);
    state.catalog = catalog;
    state.papers = paperYears.flatMap((payload) => payload.papers);
    state.ratings = loadRatings();
    state.globalRatings = normalizeGlobalRatings(globalRatingPayload);
    hydrateFilters();
    bindEvents();
    render();
  } catch (error) {
    els.paperList.innerHTML = `
      <div class="empty-state">
        数据文件加载失败。请通过本地 HTTP 服务或 GitHub Pages 打开本页面。
      </div>
    `;
    console.error(error);
  }
}

function hydrateFilters() {
  const years = [...new Set(state.papers.map((paper) => paper.year))].sort((a, b) => b - a);
  els.year.innerHTML = [
    `<option value="all">全部</option>`,
    ...years.map((year) => `<option value="${year}">${year}</option>`),
  ].join("");
}

function bindEvents() {
  els.query.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    state.page = 1;
    renderPapers();
  });
  els.year.addEventListener("change", (event) => {
    state.year = event.target.value;
    state.page = 1;
    renderPapers();
  });
  els.type.addEventListener("change", (event) => {
    state.type = event.target.value;
    state.venue = "all";
    state.page = 1;
    render();
  });
  els.status.addEventListener("change", (event) => {
    state.status = event.target.value;
    state.page = 1;
    renderPapers();
  });
  els.sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.page = 1;
    renderPapers();
  });
}

function venues() {
  return state.catalog.directions.flatMap((direction) =>
    direction.venues.map((venue) => ({
      ...venue,
      directionId: direction.id,
      directionName: direction.name,
    })),
  );
}

function selectedDirection() {
  return state.catalog.directions.find((direction) => direction.id === state.direction);
}

function filteredVenues() {
  return venues().filter((venue) => {
    const directionMatch = state.direction === "all" || venue.directionId === state.direction;
    const typeMatch = state.type === "all" || venue.type === state.type;
    return directionMatch && typeMatch;
  });
}

function render() {
  const allVenues = venues();
  els.statDirections.textContent = state.catalog.directions.length;
  els.statVenues.textContent = allVenues.length;
  els.statPapers.textContent = state.papers.length;
  renderDirections();
  renderVenues();
  renderPapers();
}

function renderDirections() {
  const buttons = [
    { id: "all", name: "全部方向", count: venues().length },
    ...state.catalog.directions.map((direction) => ({
      id: direction.id,
      name: direction.name,
      count: direction.venues.length,
    })),
  ];

  els.directionList.innerHTML = buttons
    .map(
      (item) => `
        <button class="direction-button ${state.direction === item.id ? "active" : ""}" data-direction="${item.id}">
          ${item.name}<br />
          <small>${item.count} 个 A 类 venue</small>
        </button>
      `,
    )
    .join("");

  els.directionList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.direction = button.dataset.direction;
      state.venue = "all";
      state.page = 1;
      render();
    });
  });
}

function renderVenues() {
  const items = filteredVenues();
  const direction = selectedDirection();
  els.directionTitle.textContent = direction ? direction.name : "全部方向";
  const conferenceCount = items.filter((venue) => venue.type === "conference").length;
  const journalCount = items.filter((venue) => venue.type === "journal").length;
  els.venueSummary.textContent = `当前范围包含 ${conferenceCount} 个 A 类会议、${journalCount} 个 A 类期刊。点击任意 venue 可聚焦论文列表。`;

  els.venueGrid.innerHTML = items
    .map(
      (venue) => `
        <article class="venue-card ${state.venue === venue.id ? "active" : ""}" data-venue="${venue.id}">
          <div class="venue-head">
            <span class="venue-rank">A</span>
            <span class="venue-type">${venue.type === "conference" ? "会议" : "期刊"}</span>
          </div>
          <h3>${venue.shortName}</h3>
          <p>${venue.fullName}</p>
        </article>
      `,
    )
    .join("");

  els.venueGrid.querySelectorAll(".venue-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.venue = state.venue === card.dataset.venue ? "all" : card.dataset.venue;
      state.page = 1;
      renderVenues();
      renderPapers();
    });
  });
}

function paperMatchesQuery(paper, venue) {
  if (!state.query) {
    return true;
  }
  const haystack = [
    paper.title,
    paper.abstract,
    paper.authors.join(" "),
    paper.institutions.join(" "),
    venue?.shortName,
    venue?.fullName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(state.query);
}

function filteredPapers() {
  const venueMap = new Map(venues().map((venue) => [venue.id, venue]));
  const visibleVenueIds = new Set(filteredVenues().map((venue) => venue.id));

  const filtered = state.papers.filter((paper) => {
    const venue = venueMap.get(paper.venueId);
    const inVisibleVenue = visibleVenueIds.has(paper.venueId);
    const venueMatch = state.venue === "all" || paper.venueId === state.venue;
    const yearMatch = state.year === "all" || String(paper.year) === state.year;
    const statusMatch = state.status === "all" || paper.metadataStatus === state.status;
    return inVisibleVenue && venueMatch && yearMatch && statusMatch && paperMatchesQuery(paper, venue);
  });

  return sortPapers(filtered);
}

function sortPapers(papers) {
  if (state.sort === "score-desc" || state.sort === "score-asc") {
    const direction = state.sort === "score-desc" ? -1 : 1;
    return [...papers].sort((left, right) => {
      const leftScore = globalRatingStats(left.id).average;
      const rightScore = globalRatingStats(right.id).average;
      if (leftScore === null && rightScore === null) {
        return 0;
      }
      if (leftScore === null) {
        return 1;
      }
      if (rightScore === null) {
        return -1;
      }
      if (leftScore !== rightScore) {
        return (leftScore - rightScore) * direction;
      }
      return String(left.title).localeCompare(String(right.title));
    });
  }
  return papers;
}

function renderRatingControls(paper) {
  const score = paperScore(paper);
  const currentRating = score === null ? "" : "<div class=\"rating-current\">我的评分：" + ratingText(score) + "</div>";
  const buttons = RATING_OPTIONS.map((option) => {
    const activeClass = score === option ? " active" : "";
    return (
      "<button class=\"rating-button" +
      activeClass +
      "\" data-paper-id=\"" +
      paper.id +
      "\" data-score=\"" +
      option +
      "\">" +
      option +
      "</button>"
    );
  }).join("");

  return (
    "<div class=\"paper-rating\">" +
    "<div class=\"rating-summary\">" +
    "<div class=\"" +
    globalRatingClass(paper.id) +
    "\">评分：" +
    globalRatingText(paper.id) +
    "</div>" +
    currentRating +
    "</div>" +
    "<div class=\"rating-controls\">" +
    "<div class=\"rating-buttons\">" +
    buttons +
    "</div>" +
    "<label class=\"rating-custom\">自定义" +
    "<input class=\"rating-input\" type=\"number\" min=\"0\" max=\"5\" step=\"0.1\" value=\"" +
    (score === null ? "" : formatScore(score)) +
    "\" data-paper-id=\"" +
    paper.id +
    "\" placeholder=\"0-5\" />" +
    "</label>" +
    "</div>" +
    "</div>"
  );
}

function ratePaper(paperId, rawScore) {
  const nextScore = normalizeScore(rawScore);
  if (nextScore === null) {
    return;
  }
  const previousScore = hasRating(paperId) ? Number(state.ratings[paperId]) : null;
  state.ratings[paperId] = nextScore;
  applyLocalRatingToGlobal(paperId, nextScore, previousScore);
  saveRatings();
  submitSharedRating(paperId, nextScore);
  renderPapers();
}

function bindRatingControls() {
  els.paperList.querySelectorAll(".rating-button").forEach((button) => {
    button.addEventListener("click", () => {
      ratePaper(button.dataset.paperId, button.dataset.score);
    });
  });
  els.paperList.querySelectorAll(".rating-input").forEach((input) => {
    input.addEventListener("change", () => {
      ratePaper(input.dataset.paperId, input.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        input.blur();
      }
    });
  });
}

function renderPapers() {
  const venueMap = new Map(venues().map((venue) => [venue.id, venue]));
  const items = filteredPapers();

  if (!items.length) {
    els.paperList.innerHTML = `
      <div class="empty-state">
        暂无匹配论文。可以换一个方向、年份或关键词；也可以运行脚本导入更多 DBLP 数据。
      </div>
    `;
    els.paperPagination.innerHTML = "";
    return;
  }

  const pageCount = Math.ceil(items.length / state.pageSize);
  state.page = Math.min(Math.max(state.page, 1), pageCount);
  const start = (state.page - 1) * state.pageSize;
  const pageItems = items.slice(start, start + state.pageSize);

  els.paperList.innerHTML = pageItems
    .map((paper) => {
      const venue = venueMap.get(paper.venueId);
      const institutionText = paper.institutions.length
        ? paper.institutions.join("、")
        : "机构信息待补全";
      return `
        <article class="paper-card">
          <div class="paper-meta">
            <span class="tag">${paper.year}</span>
            <span class="tag gold">${venue?.shortName ?? "Unknown"}</span>
            <span class="tag blue">${statusText(paper.metadataStatus)}</span>
          </div>
          <h3>${paper.title}</h3>
          <p><strong>作者：</strong>${paper.authors.join("、")}</p>
          <p><strong>机构：</strong>${institutionText}</p>
          <p><strong>摘要：</strong>${paper.abstract}</p>
          ${renderRatingControls(paper)}
          <div class="paper-actions">
            ${paper.links.paper ? `<a class="primary" href="${paper.links.paper}" target="_blank" rel="noreferrer">论文链接</a>` : ""}
            ${paper.links.dblp ? `<a href="${paper.links.dblp}" target="_blank" rel="noreferrer">DBLP 记录</a>` : ""}
            ${venue?.dblpUrl ? `<a href="${venue.dblpUrl}" target="_blank" rel="noreferrer">Venue 目录</a>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
  bindRatingControls();
  renderPagination(items.length, pageCount, start, pageItems.length);
}

function paginationPages(page, pageCount) {
  const pages = new Set([1, pageCount]);
  for (let value = page - 2; value <= page + 2; value += 1) {
    if (value > 1 && value < pageCount) {
      pages.add(value);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

function renderPagination(total, pageCount, start, visibleCount) {
  const end = start + visibleCount;
  const pages = paginationPages(state.page, pageCount);
  let previousPage = 0;
  const pageButtons = pages
    .map((page) => {
      const gap = previousPage && page - previousPage > 1 ? "<span class=\"page-gap\">...</span>" : "";
      previousPage = page;
      const activeClass = state.page === page ? " active" : "";
      return (
        gap +
        "<button class=\"page-button" +
        activeClass +
        "\" data-page=\"" +
        page +
        "\">" +
        page +
        "</button>"
      );
    })
    .join("");

  els.paperPagination.innerHTML =
    "<div class=\"pagination-summary\">第 " +
    (start + 1) +
    "-" +
    end +
    " 篇，共 " +
    total +
    " 篇</div>" +
    "<div class=\"pagination-controls\">" +
    "<button class=\"page-button\" data-page=\"" +
    (state.page - 1) +
    "\" " +
    (state.page === 1 ? "disabled" : "") +
    ">上一页</button>" +
    pageButtons +
    "<button class=\"page-button\" data-page=\"" +
    (state.page + 1) +
    "\" " +
    (state.page === pageCount ? "disabled" : "") +
    ">下一页</button>" +
    "</div>";

  els.paperPagination.querySelectorAll("button[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextPage = Number(button.dataset.page);
      if (!Number.isNaN(nextPage) && nextPage !== state.page) {
        state.page = nextPage;
        renderPapers();
        document.querySelector("#papers").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function statusText(status) {
  return {
    dblp: "DBLP",
    enriched: "已补全",
    pending: "待补全",
  }[status] ?? status;
}

boot();
