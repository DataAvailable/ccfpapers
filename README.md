# CCF A Papers

一个可以部署到 GitHub Pages 的纯静态论文导航站。第一版包含：

- CCF A 类会议/期刊目录，按 10 个计算机领域方向组织。
- 论文列表、年份筛选、方向筛选、会议/期刊筛选、关键词搜索。
- 独立 JSON 数据层，后续可以按年份增量追加。
- `scripts/update_dblp.py`，用于从 DBLP Search API 拉取标题、作者、年份、链接等原生字段。

## 本地预览

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 增量更新

拉取某个 venue 的某一年数据：

```bash
python3 scripts/update_dblp.py --year 2025 --venue ccs --limit 200
```

拉取目录中所有 A 类 venue 的某一年数据：

```bash
python3 scripts/update_dblp.py --year 2025 --limit 200
```

DBLP 通常不提供摘要和作者机构，因此生成记录会把 `abstract` 与 `institutions` 标记为待补全字段。后续可以增加 OpenAlex、Semantic Scholar 或出版商页面 enrichment 脚本。

## 部署到 GitHub Pages

仓库推送到 GitHub 后，在仓库设置中启用 Pages，选择当前分支根目录即可。项目不依赖构建工具。
