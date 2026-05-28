"""FastAPI server — receives conversations, stores as Markdown, provides search UI."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from search_engine import SearchEngine
from storage import (
    export_conversation_table,
    get_conversation,
    list_conversations,
    list_dates,
    save_conversation,
)

app = FastAPI(title="AI Conversation Recorder")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

search_engine = SearchEngine()


# ---- Models ----


class Reference(BaseModel):
    title: str = ""
    url: str = ""


class InlineCitation(BaseModel):
    label: str = ""
    title: str = ""
    url: str = ""
    context: str = ""


class Message(BaseModel):
    role: str
    content: str
    references: list[Reference] = Field(default_factory=list)
    inlineCitations: list[InlineCitation] = Field(default_factory=list)
    suggestedQuestions: list[str] = Field(default_factory=list)
    timestamp: str | None = None


class ConversationPayload(BaseModel):
    platform: str = ""
    url: str = ""
    title: str = ""
    messages: list[Message]
    timestamp: str | None = None


# ---- API ----


@app.post("/api/conversation")
def api_save_conversation(payload: ConversationPayload) -> dict:
    messages = [m.model_dump() for m in payload.messages]
    file_path = save_conversation(
        platform=payload.platform,
        url=payload.url,
        title=payload.title,
        messages=messages,
        timestamp=payload.timestamp,
    )
    desktop_file = export_conversation_table(
        platform=payload.platform,
        title=payload.title,
        messages=messages,
        timestamp=payload.timestamp,
    )
    search_engine.index_file(file_path)
    return {"ok": True, "file": str(file_path), "desktop_file": str(desktop_file)}


@app.get("/api/dates")
def api_list_dates() -> list[str]:
    return list_dates()


@app.get("/api/conversations/{date}")
def api_list_conversations(date: str) -> list[dict]:
    return list_conversations(date)


@app.get("/api/conversation/{date}/{filename:path}")
def api_get_conversation(date: str, filename: str) -> dict:
    content = get_conversation(date, filename)
    if content is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"date": date, "filename": filename, "content": content}


@app.get("/api/search")
def api_search(
    q: str = Query(..., description="Search query"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    return search_engine.search(q, page=page, page_size=size)


@app.get("/api/reindex")
def api_reindex() -> dict:
    from storage import ROOT

    search_engine.reindex_all(ROOT)
    return {"ok": True}


@app.get("/")
def serve_ui():
    from fastapi.responses import FileResponse

    return FileResponse(str(STATIC_DIR / "index.html"), media_type="text/html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
