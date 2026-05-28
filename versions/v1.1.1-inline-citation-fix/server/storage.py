"""Markdown conversation storage — YYYY-MM/YYYY-MM-DD/HH-MM-SS-platform.md"""

import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "conversations"


def _sanitize(s: str) -> str:
    return re.sub(r"[\\/:*?\"<>|]", "_", s)


def _format_message(msg: dict) -> str:
    role_label = "用户" if msg.get("role") == "user" else "AI"
    ts = msg.get("timestamp", "")
    time_str = ""
    if ts:
        try:
            dt = datetime.fromisoformat(ts)
            time_str = f" - {dt.strftime('%H:%M:%S')}"
        except (ValueError, TypeError):
            time_str = f" - {ts}"

    lines = [f"### {role_label}{time_str}", "", msg.get("content", ""), ""]

    inline_citations = msg.get("inlineCitations", [])
    if inline_citations:
        lines.append("**正文引用链接：**")
        for c in inline_citations:
            label = c.get("label") or c.get("title") or c.get("url", "")
            url = c.get("url", "")
            context = c.get("context", "")
            suffix = f" - {context}" if context else ""
            if url:
                lines.append(f"- [{label}]({url}){suffix}")
            else:
                lines.append(f"- {label}{suffix}")
        lines.append("")

    refs = msg.get("references", [])
    if refs:
        lines.append("**参考资料链接：**")
        for r in refs:
            title = r.get("title", r.get("url", ""))
            url = r.get("url", "")
            if url:
                lines.append(f"- [{title}]({url})")
            else:
                lines.append(f"- {title}")
        lines.append("")

    suggested_questions = msg.get("suggestedQuestions", [])
    if suggested_questions:
        lines.append("**你可能还想问：**")
        for question in suggested_questions:
            lines.append(f"- {question}")
        lines.append("")

    return "\n".join(lines)


def _desktop_dir() -> Path:
    """Return the current user's Desktop directory, creating it if needed."""
    desktop = Path.home() / "Desktop"
    if desktop.exists():
        return desktop

    onedrive_desktop = Path.home() / "OneDrive" / "Desktop"
    if onedrive_desktop.exists():
        return onedrive_desktop

    desktop.mkdir(parents=True, exist_ok=True)
    return desktop


def _table_cell(value: str) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    text = text.replace("\\", "\\\\").replace("|", "\\|")
    text = text.replace("\n", "<br>")
    return text


def _markdown_link(title: str, url: str) -> str:
    label = str(title or url or "").replace("[", "\\[").replace("]", "\\]")
    return f"[{label}]({url})" if url else label


def _format_reference_cell(refs: list[dict]) -> str:
    items = []
    for ref in refs or []:
        title = ref.get("title") or ref.get("url") or ""
        url = ref.get("url", "")
        if title or url:
            items.append(_markdown_link(title, url))
    return "\n".join(items)


def _format_inline_citation_cell(citations: list[dict]) -> str:
    items = []
    for citation in citations or []:
        label = (
            citation.get("label")
            or citation.get("title")
            or citation.get("url")
            or ""
        )
        url = citation.get("url", "")
        context = citation.get("context", "")
        item = _markdown_link(label, url)
        if context:
            item = f"{item} - {context}"
        if item:
            items.append(item)
    return "\n".join(items)


def export_conversation_table(
    *,
    platform: str = "",
    title: str = "",
    messages: list[dict],
    timestamp: str | None = None,
) -> Path:
    """Export assistant answers as a desktop Markdown table."""
    if timestamp:
        dt = datetime.fromisoformat(timestamp)
    else:
        dt = datetime.now()

    safe_platform = _sanitize(platform) if platform else "unknown"
    desktop = _desktop_dir()
    filename = f"AI对话导出-{dt.strftime('%Y-%m-%d-%H-%M-%S')}-{safe_platform}.md"
    file_path = desktop / filename

    counter = 1
    while file_path.exists():
        filename = (
            f"AI对话导出-{dt.strftime('%Y-%m-%d-%H-%M-%S')}-"
            f"{safe_platform}-{counter}.md"
        )
        file_path = desktop / filename
        counter += 1

    assistant_messages = [m for m in messages if m.get("role") == "assistant"]
    if not assistant_messages:
        assistant_messages = [{"content": ""}]

    table_title = title or platform or "AI对话"
    lines = [
        "# AI对话导出",
        "",
        "| 题目 | AI回答正文 | 参考资料 | 你可能还想问 | 正文里的引用链接 |",
        "|---|---|---|---|---|",
    ]

    for msg in assistant_messages:
        row = [
            _table_cell(table_title),
            _table_cell(msg.get("content", "")),
            _table_cell(_format_reference_cell(msg.get("references", []))),
            _table_cell("\n".join(msg.get("suggestedQuestions", []) or [])),
            _table_cell(_format_inline_citation_cell(msg.get("inlineCitations", []))),
        ]
        lines.append("| " + " | ".join(row) + " |")

    file_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return file_path


def save_conversation(
    *,
    platform: str = "",
    url: str = "",
    title: str = "",
    messages: list[dict],
    timestamp: str | None = None,
) -> Path:
    """Save a single conversation to its own markdown file under a date folder."""
    if timestamp:
        dt = datetime.fromisoformat(timestamp)
    else:
        dt = datetime.now()

    date_str = dt.strftime("%Y-%m-%d")
    month_dir = dt.strftime("%Y-%m")
    time_str = dt.strftime("%H-%M-%S")
    safe_platform = _sanitize(platform) if platform else "unknown"

    day_dir = ROOT / month_dir / date_str
    day_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{time_str}-{safe_platform}.md"
    file_path = day_dir / filename

    # If file already exists (same second), append a counter
    counter = 1
    while file_path.exists():
        filename = f"{time_str}-{safe_platform}-{counter}.md"
        file_path = day_dir / filename
        counter += 1

    with open(file_path, "w", encoding="utf-8") as f:
        header_title = _sanitize(title or platform or "对话")
        header = f"# {header_title} - {date_str} {dt.strftime('%H:%M:%S')}\n"
        if url:
            header += f"来源: {url}\n"
        if platform:
            header += f"平台: {platform}\n"
        if title:
            header += f"题目: {title}\n"
        f.write(header + "\n")

        for msg in messages:
            f.write(_format_message(msg))

    return file_path


def get_conversation(date_str: str, filename: str) -> str | None:
    """Read a specific conversation file."""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None
    month_dir = dt.strftime("%Y-%m")
    file_path = ROOT / month_dir / date_str / filename
    if not file_path.exists():
        return None
    return file_path.read_text(encoding="utf-8")


def list_conversations(date_str: str) -> list[dict]:
    """List all conversations for a given date. Returns metadata for each file."""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return []
    month_dir = dt.strftime("%Y-%m")
    day_dir = ROOT / month_dir / date_str
    if not day_dir.exists():
        return []

    result = []
    for f in sorted(day_dir.glob("*.md"), reverse=True):
        content = f.read_text(encoding="utf-8")
        # Extract a preview from the first user message
        preview = ""
        lines = content.split("\n")
        in_user_msg = False
        for line in lines:
            if line.startswith("### 用户"):
                in_user_msg = True
                continue
            if in_user_msg and line.startswith("### "):
                break
            if in_user_msg and line.strip():
                preview = line.strip()[:120]
                break
        if not preview:
            # Fallback: take first non-header, non-empty line
            for line in lines:
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and not stripped.startswith("来源"):
                    preview = stripped[:120]
                    break

        result.append({
            "filename": f.name,
            "preview": preview,
        })

    return result


def list_dates() -> list[str]:
    """Return all dates that have conversations, newest first."""
    if not ROOT.exists():
        return []
    dates = set()
    for month_dir in ROOT.iterdir():
        if month_dir.is_dir():
            for day_dir in month_dir.iterdir():
                if day_dir.is_dir() and list(day_dir.glob("*.md")):
                    dates.add(day_dir.name)
    return sorted(dates, reverse=True)
