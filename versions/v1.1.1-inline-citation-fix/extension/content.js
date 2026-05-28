// Content script: extracts structured AI conversation data from web chat pages.
// Captures: conversation title, user prompt, AI answer, reference links,
// inline citation links, and suggested follow-up questions.

(function () {
  "use strict";

  const SEEN_TEXTS = new Set();
  const SERVER_URL = "http://localhost:8765";

  const ASSISTANT_ACTION_SELECTOR =
    '[data-foundation-type="receive-message-action-bar"]';
  const SUGGEST_SELECTOR =
    '[data-foundation-type="receive-message-suggest-foundation"]';
  const USER_BUBBLE_SELECTOR = ".bg-g-send-msg-bubble-bg";

  const REFERENCE_HINT_RE =
    /(reference|references|citation|citations|source|sources|search|web|参考|引用|来源|资料|搜索)/i;
  const SUGGEST_HINT_RE =
    /(suggest|follow|猜你|你可能|还想问|推荐问题|相关问题)/i;
  const TOOLBAR_HINT_RE =
    /(action-bar|toolbar|copy|like|dislike|share|feedback|操作|复制|点赞|分享|反馈)/i;
  const INLINE_CITATION_CLASS_RE =
    /(container-WJm_Sj|citation|inline-citation|reference-label|source-label|source-tag|cite)/i;
  const SOURCE_NAME_HINT_RE =
    /(\u6c2a|\u7f51|\u62a5|\u793e|\u65b0\u95fb|\u5934\u6761|\u8d22\u65b0|\u592e\u5e7f|\u901a\u4fe1|\u4e16\u754c|CSDN|Nginx|Server|Douyin|36kr)/i;

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function textForBlock(el) {
    return (el ? el.innerText || el.textContent || "" : "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function textLines(el) {
    return textForBlock(el)
      .split(/\n+/)
      .map(normalizeText)
      .filter(Boolean);
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function elementSignature(el) {
    return [
      el.tagName,
      el.id,
      el.className,
      el.getAttribute("data-foundation-type"),
      el.getAttribute("role"),
      el.getAttribute("aria-label"),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function looksLikeReferenceZone(el) {
    if (!el) return false;
    const sig = elementSignature(el);
    const text = normalizeText(el.textContent).slice(0, 160);
    return REFERENCE_HINT_RE.test(sig) || REFERENCE_HINT_RE.test(text);
  }

  function looksLikeSuggestZone(el) {
    if (!el) return false;
    const sig = elementSignature(el);
    const text = normalizeText(el.textContent).slice(0, 160);
    return SUGGEST_HINT_RE.test(sig) || SUGGEST_HINT_RE.test(text);
  }

  function looksLikeToolbar(el) {
    if (!el) return false;
    return TOOLBAR_HINT_RE.test(elementSignature(el));
  }

  function closestMessageRow(el) {
    if (!el) return null;
    return (
      el.closest(".v_list_row") ||
      el.closest("[data-message-id]") ||
      el.closest('[class*="message"]') ||
      el.parentElement
    );
  }

  function isExternalHttpUrl(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function normalizeForMatch(text) {
    return normalizeText(text)
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, "");
  }

  function cleanTitle(title) {
    return normalizeText(title)
      .replace(/\s*[-|_]\s*(豆包|Doubao|ChatGPT|Kimi|通义|文心一言).*$/i, "")
      .slice(0, 120);
  }

  function extractConversationTitle(firstQuestion) {
    const selectors = [
      '[data-testid*="conversation-title" i]',
      '[data-testid*="chat-title" i]',
      '[class*="conversation-title" i]',
      '[class*="chat-title" i]',
      '[class*="thread-title" i]',
      'header [class*="title" i]',
    ];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        const text = cleanTitle(el ? el.textContent : "");
        if (text.length >= 2 && text.length <= 120) return text;
      } catch (_) {}
    }

    const docTitle = cleanTitle(document.title || "");
    if (docTitle.length >= 2) return docTitle;
    return cleanTitle(firstQuestion || "") || "AI conversation";
  }

  function extractUserMessages() {
    const messages = [];
    const seen = new Set();
    const bubbles = document.querySelectorAll(USER_BUBBLE_SELECTOR);

    for (const bubble of bubbles) {
      if (!isVisible(bubble)) continue;
      const content = textForBlock(bubble);
      if (content.length < 2) continue;

      const key = content.slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);

      messages.push({
        role: "user",
        content,
        references: [],
        inlineCitations: [],
        suggestedQuestions: [],
        timestamp: new Date().toISOString(),
        top: bubble.getBoundingClientRect().top + window.scrollY,
      });
    }

    return messages;
  }

  function findAssistantRows() {
    const rows = [];
    const seen = new Set();
    const actionBars = document.querySelectorAll(ASSISTANT_ACTION_SELECTOR);

    for (const bar of actionBars) {
      const row = closestMessageRow(bar);
      if (!row || seen.has(row)) continue;
      seen.add(row);
      rows.push(row);
    }

    return rows.sort(
      (a, b) =>
        a.getBoundingClientRect().top + window.scrollY -
        (b.getBoundingClientRect().top + window.scrollY)
    );
  }

  function removeFromClone(clone, predicate) {
    const all = Array.from(clone.querySelectorAll("*"));
    for (const el of all) {
      if (predicate(el)) el.remove();
    }
  }

  function extractAnswerText(row) {
    const clone = row.cloneNode(true);

    removeFromClone(clone, (el) => {
      if (el.matches && el.matches(ASSISTANT_ACTION_SELECTOR)) return true;
      if (el.matches && el.matches(SUGGEST_SELECTOR)) return true;
      if (looksLikeSuggestZone(el)) return true;
      if (looksLikeToolbar(el)) return true;

      // Remove large reference/search-result areas, but keep compact inline citations.
      const anchors = el.querySelectorAll ? el.querySelectorAll("a[href]") : [];
      const text = normalizeText(el.textContent);
      if (anchors.length >= 2 && looksLikeReferenceZone(el)) return true;
      if (anchors.length >= 1 && text.length > 120 && looksLikeReferenceZone(el)) {
        return true;
      }
      return false;
    });

    return textForBlock(clone);
  }

  function nearbyContext(el) {
    const parentText = normalizeText(el.parentElement?.textContent || "");
    const label = normalizeText(el.textContent);
    if (!parentText || !label) return "";

    const idx = parentText.indexOf(label);
    if (idx < 0) return parentText.slice(0, 80);

    const before = parentText.slice(Math.max(0, idx - 40), idx).trim();
    const after = parentText.slice(idx + label.length, idx + label.length + 20).trim();
    return normalizeText(`${before} ${after}`).slice(0, 100);
  }

  function isInReferenceOrSuggestZone(el, row) {
    let cur = el.parentElement;
    for (let i = 0; i < 6 && cur && cur !== row; i++) {
      if (cur.matches?.(SUGGEST_SELECTOR) || looksLikeSuggestZone(cur)) return true;
      if (looksLikeReferenceZone(cur) && cur.querySelectorAll("a[href]").length >= 2) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  function scoreReferenceMatch(label, ref) {
    const labelKey = normalizeForMatch(label);
    const sourceKey = normalizeForMatch(ref.source || "");
    const titleKey = normalizeForMatch(ref.title || "");
    const summaryKey = normalizeForMatch(ref.summaryText || "");

    if (!labelKey) return 0;
    if (sourceKey && sourceKey === labelKey) return 100;
    if (sourceKey && (sourceKey.includes(labelKey) || labelKey.includes(sourceKey))) {
      return 80;
    }
    if (titleKey && titleKey.includes(labelKey)) return 50;
    if (summaryKey && summaryKey.includes(labelKey)) return 30;
    return 0;
  }

  function findReferenceMatch(label, references) {
    let best = null;
    let bestScore = 0;

    for (const ref of references || []) {
      const score = scoreReferenceMatch(label, ref);
      if (score > bestScore) {
        best = ref;
        bestScore = score;
      }
    }

    return best;
  }

  function isLikelyInlineCitationLabel(el) {
    const label = normalizeText(el.textContent);
    if (!label || label.length < 2 || label.length > 24) return false;

    const sig = elementSignature(el);
    if (INLINE_CITATION_CLASS_RE.test(sig)) return true;

    // For fallback detection via source-name hints, reject elements with children
    if (el.children && el.children.length > 0) return false;
    if (!SOURCE_NAME_HINT_RE.test(label)) return false;

    const parentText = normalizeText(el.parentElement?.textContent || "");
    return parentText.length > label.length + 8;
  }

  function addInlineCitation(citations, seen, item) {
    const key = `${normalizeForMatch(item.label)}:${item.url || ""}:${item.context || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    citations.push(item);
  }

  function extractInlineCitations(row, references = []) {
    const citations = [];
    const seen = new Set();
    const anchors = row.querySelectorAll("a[href]");

    for (const a of anchors) {
      if (!isVisible(a)) continue;
      const url = a.href.trim();
      if (!isExternalHttpUrl(url)) continue;
      if (seen.has(url)) continue;

      const label = normalizeText(a.textContent) || url;
      if (!label || label.length > 80) continue;
      if (isInReferenceOrSuggestZone(a, row)) continue;

      addInlineCitation(citations, seen, {
        label: label.slice(0, 80),
        title: label.slice(0, 80),
        url,
        context: nearbyContext(a),
      });
    }

    // Priority: directly target known citation container classes
    const citationClassSelectors = [
      '[class*="container-WJm_Sj" i]',
      '[class*="inline-citation" i]',
      '[class*="reference-label" i]',
      '[class*="source-label" i]',
      '[class*="source-tag" i]',
    ];
    const scannedEls = new Set();
    const collectLabelEls = (els) => {
      for (const el of els) {
        if (scannedEls.has(el)) continue;
        scannedEls.add(el);
        if (!isVisible(el)) continue;
        if (isInReferenceOrSuggestZone(el, row)) continue;
        if (!isLikelyInlineCitationLabel(el)) continue;

        const label = normalizeText(el.textContent);
        const matchedRef = findReferenceMatch(label, references);
        const title = matchedRef?.title || label;
        const url = matchedRef?.url || "";

        addInlineCitation(citations, seen, {
          label,
          title,
          url,
          context: nearbyContext(el),
        });
      }
    };

    // First pass: known citation container classes
    for (const sel of citationClassSelectors) {
      try { collectLabelEls(row.querySelectorAll(sel)); } catch (_) {}
    }

    // Second pass: generic inline elements as fallback
    collectLabelEls(row.querySelectorAll("span, button, div"));

    return citations;
  }

  function referenceTitle(anchor) {
    const titleEl =
      anchor.querySelector('[class*="search-item-title" i]') ||
      anchor.querySelector('[class*="title" i]') ||
      anchor.querySelector("h1,h2,h3,h4");
    const title = normalizeText(titleEl ? titleEl.textContent : anchor.textContent);
    return (title || anchor.href).slice(0, 200);
  }

  function referenceIndex(anchor, fallbackIndex) {
    for (const line of textLines(anchor).slice().reverse()) {
      if (/^\d{1,3}$/.test(line)) return Number(line);
    }
    return fallbackIndex;
  }

  function referenceSource(anchor, title) {
    const sourceEl =
      anchor.querySelector('[class*="source" i]') ||
      anchor.querySelector('[class*="site" i]') ||
      anchor.querySelector('[class*="from" i]');
    const explicitSource = normalizeText(sourceEl ? sourceEl.textContent : "");
    if (explicitSource) return explicitSource.slice(0, 80);

    const titleKey = normalizeForMatch(title);
    const lines = textLines(anchor);
    for (const line of lines.slice().reverse()) {
      const key = normalizeForMatch(line);
      if (!key || key === titleKey) continue;
      if (/^\d{1,3}$/.test(line)) continue;
      if (line.length > 40) continue;
      if (SOURCE_NAME_HINT_RE.test(line) || line.length <= 12) {
        return line.slice(0, 80);
      }
    }
    return "";
  }

  function referenceSummary(anchor, title, source) {
    const summaryEl =
      anchor.querySelector('[class*="search-item-summary" i]') ||
      anchor.querySelector('[class*="summary" i]') ||
      anchor.querySelector('[class*="desc" i]');
    const explicitSummary = normalizeText(summaryEl ? summaryEl.textContent : "");
    if (explicitSummary) return explicitSummary.slice(0, 600);

    const titleKey = normalizeForMatch(title);
    const sourceKey = normalizeForMatch(source);
    return textLines(anchor)
      .filter((line) => {
        const key = normalizeForMatch(line);
        return key && key !== titleKey && key !== sourceKey && !/^\d{1,3}$/.test(line);
      })
      .join(" ")
      .slice(0, 600);
  }

  function collectReferenceLinks(root) {
    const refs = [];
    const seen = new Set();
    if (!root) return refs;

    const candidateZones = Array.from(root.querySelectorAll("*")).filter((el) => {
      const anchors = el.querySelectorAll ? el.querySelectorAll("a[href]") : [];
      if (anchors.length === 0) return false;
      return looksLikeReferenceZone(el) || anchors.length >= 2;
    });

    for (const zone of candidateZones) {
      const anchors = zone.querySelectorAll("a[href]");
      for (const a of anchors) {
        const url = a.href.trim();
        if (!isExternalHttpUrl(url)) continue;
        if (url === window.location.href) continue;
        if (seen.has(url)) continue;
        seen.add(url);

        const title = referenceTitle(a);
        const source = referenceSource(a, title);
        refs.push({
          title,
          url,
          source,
          index: referenceIndex(a, refs.length + 1),
          summaryText: referenceSummary(a, title, source),
        });
      }
    }

    return refs;
  }

  function extractReferenceLinks(row) {
    const rowRefs = collectReferenceLinks(row);
    if (rowRefs.length > 0) return rowRefs;

    // Doubao often renders source cards in a sibling/right-side panel.
    const panelSelectors = [
      ".container-outer-FzyVX9",
      '[class*="reference" i]',
      '[class*="citation" i]',
      '[class*="source" i]',
      '[class*="search" i]',
    ];

    const refs = [];
    const seen = new Set();
    for (const selector of panelSelectors) {
      for (const panel of document.querySelectorAll(selector)) {
        for (const ref of collectReferenceLinks(panel)) {
          if (seen.has(ref.url)) continue;
          seen.add(ref.url);
          refs.push(ref);
        }
      }
      if (refs.length > 0) break;
    }

    return refs;
  }

  function extractSuggestedQuestions(row) {
    const questions = [];
    const seen = new Set();
    const zones = [
      ...row.querySelectorAll(SUGGEST_SELECTOR),
      ...Array.from(row.querySelectorAll("*")).filter(looksLikeSuggestZone),
    ];

    for (const zone of zones) {
      const items = zone.querySelectorAll("button, a, [role='button'], li, [class*='suggest' i], [class*='question' i], [class*='title' i]");
      const sources = items.length ? Array.from(items) : [zone];

      for (const item of sources) {
        const text = normalizeText(item.textContent);
        if (text.length < 4 || text.length > 160) continue;
        if (seen.has(text)) continue;
        seen.add(text);
        questions.push(text);
      }
    }

    return questions;
  }

  function extractAssistantMessages() {
    const messages = [];
    for (const row of findAssistantRows()) {
      const content = extractAnswerText(row);
      if (content.length < 10) continue;
      const references = extractReferenceLinks(row);

      messages.push({
        role: "assistant",
        content,
        references,
        inlineCitations: extractInlineCitations(row, references),
        suggestedQuestions: extractSuggestedQuestions(row),
        timestamp: new Date().toISOString(),
        top: row.getBoundingClientRect().top + window.scrollY,
      });
    }
    return messages;
  }

  function dedupeByText(messages) {
    const result = [];
    for (const msg of messages) {
      const sig = `${msg.role}:${msg.content.slice(0, 300)}`;
      if (SEEN_TEXTS.has(sig)) continue;
      SEEN_TEXTS.add(sig);
      result.push(msg);
    }
    return result;
  }

  function captureAndSend() {
    const userMessages = extractUserMessages();
    const assistantMessages = extractAssistantMessages();
    const allMessages = [...userMessages, ...assistantMessages]
      .sort((a, b) => (a.top || 0) - (b.top || 0))
      .map(({ top, ...msg }) => msg);

    const messages = dedupeByText(allMessages);

    if (messages.length === 0) {
      return { ok: false, count: 0, error: "未检测到新的对话内容" };
    }

    const firstQuestion = userMessages[0]?.content || "";
    const payload = {
      platform: window.location.hostname,
      url: window.location.href,
      title: extractConversationTitle(firstQuestion),
      messages,
      timestamp: new Date().toISOString(),
    };

    console.log("[AI Recorder] Capture payload:", {
      title: payload.title,
      messages: messages.length,
      references: messages.reduce((sum, m) => sum + (m.references?.length || 0), 0),
      inlineCitations: messages.reduce((sum, m) => sum + (m.inlineCitations?.length || 0), 0),
      suggestedQuestions: messages.reduce((sum, m) => sum + (m.suggestedQuestions?.length || 0), 0),
    });

    fetch(`${SERVER_URL}/api/conversation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((data) => {
        console.log("[AI Recorder] Saved:", data.file);
      })
      .catch((err) => {
        console.warn("[AI Recorder] Server error:", err.message);
      });

    return { ok: true, count: messages.length };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "capture") {
      sendResponse(captureAndSend());
    } else if (msg.action === "ping") {
      sendResponse({ ready: true });
    } else if (msg.action === "debug") {
      const users = extractUserMessages();
      const assistants = extractAssistantMessages();
      sendResponse({
        title: extractConversationTitle(users[0]?.content || ""),
        userMessages: users.map((m) => m.content.slice(0, 120)),
        assistantMessages: assistants.map((m) => ({
          answerPreview: m.content.slice(0, 160),
          references: m.references,
          inlineCitations: m.inlineCitations,
          suggestedQuestions: m.suggestedQuestions,
        })),
      });
    }
    return true;
  });

  console.log("[AI Recorder] Ready on", window.location.href);
})();
