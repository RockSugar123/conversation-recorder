"""Whoosh full-text search over conversation markdown files."""

from pathlib import Path

from whoosh import index
from whoosh.analysis import LanguageAnalyzer
from whoosh.fields import ID, TEXT, Schema
from whoosh.qparser import MultifieldParser

INDEX_DIR = Path(__file__).resolve().parent / ".whoosh_index"


def _build_schema() -> Schema:
    return Schema(
        path=ID(stored=True, unique=True),
        date=ID(stored=True),
        filename=ID(stored=True),
        content=TEXT(stored=True, analyzer=LanguageAnalyzer("zh")),
    )


class SearchEngine:
    def __init__(self) -> None:
        INDEX_DIR.mkdir(parents=True, exist_ok=True)
        if index.exists_in(str(INDEX_DIR)):
            self._ix = index.open_dir(str(INDEX_DIR))
        else:
            self._ix = index.create_in(str(INDEX_DIR), _build_schema())
        self._parser = MultifieldParser(["content"], self._ix.schema)

    def index_file(self, file_path: Path) -> None:
        content = file_path.read_text(encoding="utf-8")
        writer = self._ix.writer()
        date_str = file_path.parent.name  # e.g. "2026-05-28"
        filename = file_path.name
        path_str = str(file_path.resolve())
        writer.update_document(
            path=path_str, date=date_str, filename=filename, content=content
        )
        writer.commit()

    def reindex_all(self, root_dir: Path) -> None:
        from whoosh.query import Every

        writer = self._ix.writer()
        writer.delete_by_query(Every("content"))
        writer.commit()

        writer = self._ix.writer()
        for md_file in sorted(root_dir.rglob("*.md")):
            content = md_file.read_text(encoding="utf-8")
            writer.add_document(
                path=str(md_file.resolve()),
                date=md_file.parent.name,
                filename=md_file.name,
                content=content,
            )
        writer.commit()

    def search(self, query: str, page: int = 1, page_size: int = 20) -> dict:
        results_data: list[dict] = []
        with self._ix.searcher() as searcher:
            q = self._parser.parse(query)
            results = searcher.search_page(q, page, pagelen=page_size)
            for hit in results:
                snippet = (
                    hit.highlights("content", top=3)
                    or hit.get("content", "")[:200]
                )
                results_data.append(
                    {
                        "date": hit.get("date", ""),
                        "filename": hit.get("filename", ""),
                        "path": hit.get("path", ""),
                        "snippet": snippet,
                    }
                )
            return {
                "results": results_data,
                "total": len(results),
                "page": page,
                "page_size": page_size,
                "pages": results.pagecount,
            }
