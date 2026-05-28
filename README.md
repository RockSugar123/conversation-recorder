# AI Conversation Recorder

Capture AI chat conversations from web pages (Doubao, etc.) and export as local Markdown files with full structured data: answer text, reference links, inline citation links, and suggested follow-up questions.

## Features

- One-click capture from Chrome extension popup
- Extracts conversation title, user prompts, AI answers
- Captures sidebar reference links (title, source, URL)
- **Inline citation matching**: detects in-text citation labels (e.g. `36氪`, `中国新闻网`) and maps them to their corresponding reference URLs
- Suggested follow-up questions
- Markdown table export to desktop
- Local search UI with full-text indexing

## Project Structure

```
extension/          Chrome extension (Manifest V3)
  content.js          Content script — DOM extraction
  background.js       Service worker
  popup/              Extension popup UI
server/             Python FastAPI backend
  main.py             API server
  storage.py          Markdown conversation storage
  search_engine.py    Whoosh full-text search
  static/             Search UI frontend
versions/           Version snapshots
```

## Setup

### Server

```bash
cd server
pip install -r requirements.txt
python main.py
```

Server runs on `http://localhost:8765`.

### Chrome Extension

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `extension/` folder

## Usage

1. Open a supported AI chat page (e.g. doubao.com)
2. Click the extension icon → **Capture**
3. A Markdown file is saved to your Desktop and `server/conversations/`

## Exported Format

| 题目 | AI回答正文 | 参考资料 | 你可能还想问 | 正文里的引用链接 |
|---|---|---|---|---|
| Title | Answer text | [Link](url) | Questions | [Label](url) - context |

## Version History

- **v1.1.2** — Inline citation link completion: plain `<span>` citation labels matched to reference URLs
- **v1.1.0** — Structured extraction: references, inline citations, suggested questions
- **v1.0.0** — Basic conversation capture
