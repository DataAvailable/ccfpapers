const state = {
  direction: "all",
  venue: "all",
  year: "all",
  type: "all",
  status: "all",
  query: "",
  page: 1,
  pageSize: 50,
  catalog: null,
  papers: [],
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
  statDirections: document.querySelector("#stat-directions"),
  statVenues: document.querySelector("#stat-venues"),
  statPapers: document.querySelector("#stat-papers"),
};

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Cannot load ${path}`);
  }
  return response.json();
}

async function boot() {
  try {
    const [catalog, ...paperYears] = await Promise.all([
      loadJson("data/ccf-a-venues.json"),
      ...[2023, 2024, 2025, 2026].map((year) => loadJson("data/papers/" + year + ".json")),
    ]);
    state.catalog = catalog;
    state.papers = paperYears.flatMap((payload) => payload.papers);
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

  return state.papers.filter((paper) => {
    const venue = venueMap.get(paper.venueId);
    const inVisibleVenue = visibleVenueIds.has(paper.venueId);
    const venueMatch = state.venue === "all" || paper.venueId === state.venue;
    const yearMatch = state.year === "all" || String(paper.year) === state.year;
    const statusMatch = state.status === "all" || paper.metadataStatus === state.status;
    return inVisibleVenue && venueMatch && yearMatch && statusMatch && paperMatchesQuery(paper, venue);
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
          <div class="paper-actions">
            ${paper.links.paper ? `<a class="primary" href="${paper.links.paper}" target="_blank" rel="noreferrer">论文链接</a>` : ""}
            ${paper.links.dblp ? `<a href="${paper.links.dblp}" target="_blank" rel="noreferrer">DBLP 记录</a>` : ""}
            ${venue?.dblpUrl ? `<a href="${venue.dblpUrl}" target="_blank" rel="noreferrer">Venue 目录</a>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
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
