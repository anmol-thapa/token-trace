;(function () {
  'use strict'

  const SITE = location.hostname.includes('claude') ? 'claude' : 'chatgpt'
  const PROCESSED_ATTR = 'data-tt-processed'
  const BADGE_CLASS = 'tt-badge'

  // ── Token estimation ────────────────────────────────────────────────────────
  // ~4 chars per token (OpenAI/Anthropic rule of thumb)
  function estimateTokens(text) {
    return Math.ceil((text || '').replace(/\s+/g, ' ').trim().length / 4)
  }

  // ── Model detection ─────────────────────────────────────────────────────────
  function extractModel() {
    if (SITE === 'claude') {
      // Claude shows the active model in a button/selector near the input bar.
      // Scan short-text interactive elements for known model name substrings.
      const candidates = document.querySelectorAll(
        'button, [role="button"], [role="option"], [role="menuitem"], span'
      )
      for (const el of candidates) {
        const t = (el.textContent || '').trim()
        if (t.length === 0 || t.length > 60) continue
        const lower = t.toLowerCase()
        if (lower.includes('haiku'))                       return 'claude-haiku'
        if (lower.includes('opus'))                        return 'claude-opus'
        if (lower.includes('3.7') || lower.includes('3-7')) return 'claude-3-7-sonnet'
        if (lower.includes('sonnet'))                      return 'claude-sonnet'
      }
      return 'claude-sonnet' // safe fallback
    } else {
      // ChatGPT: model slug lives on the message container or in the action bar.
      const msgEl = document.querySelector(
        '[data-message-author-role="assistant"][data-message-model-slug]'
      )
      if (msgEl) {
        const slug = msgEl.getAttribute('data-message-model-slug')
        if (slug) return slug
      }
      const barEl = document.querySelector(
        'span.overflow-hidden.text-sm, span.overflow-hidden.whitespace-nowrap'
      )
      return barEl?.textContent?.trim() || 'gpt-4o'
    }
  }

  // ── Find assistant message containers ───────────────────────────────────────
  // NOTE: These selectors may need updating if Claude/ChatGPT changes their DOM.
  // Claude selectors are tried in priority order; first non-empty match wins.
  const CLAUDE_SELECTORS = [
    '[data-testid="assistant-message"]',   // preferred semantic selector
    '.font-claude-message',                // older Claude UI class
    '[data-is-streaming]',                 // present during streaming
  ]

  function findAssistantContainers() {
    if (SITE === 'claude') {
      for (const sel of CLAUDE_SELECTORS) {
        const els = document.querySelectorAll(sel)
        if (els.length > 0) return Array.from(els)
      }
      return []
    }
    return Array.from(
      document.querySelectorAll('[data-message-author-role="assistant"]')
    )
  }

  // ── Streaming completion detection ──────────────────────────────────────────
  // Poll until text content hasn't changed for 1.5 s (3 × 500 ms).
  function waitForComplete(container, onComplete) {
    let lastText = ''
    let stableCount = 0

    const timer = setInterval(() => {
      const text = container.textContent || ''
      if (text.length > 0 && text === lastText) {
        if (++stableCount >= 3) {
          clearInterval(timer)
          onComplete(text)
        }
      } else {
        lastText = text
        stableCount = 0
      }
    }, 500)

    // Safety timeout — don't poll forever
    setTimeout(() => clearInterval(timer), 180_000)
  }

  // ── CO2 display formatting ──────────────────────────────────────────────────
  function formatCO2(co2Grams) {
    if (co2Grams >= 1)    return `${co2Grams.toFixed(2)} g`
    if (co2Grams >= 0.001) return `${(co2Grams * 1000).toFixed(1)} mg`
    return `${(co2Grams * 1_000_000).toFixed(1)} µg`
  }

  // ── Badge injection ─────────────────────────────────────────────────────────
  function injectBadge(container, data) {
    container.querySelector('.' + BADGE_CLASS)?.remove()

    const totalTokens = (data.inputTokens || 0) + (data.outputTokens || 0)
    const badge = document.createElement('div')
    badge.className = BADGE_CLASS
    badge.innerHTML =
      `<span class="tt-dot"></span>` +
      `<span class="tt-text">~${totalTokens.toLocaleString()} tokens &middot; ${formatCO2(data.co2Grams)} CO\u2082</span>`
    container.appendChild(badge)
  }

  // ── Process a single assistant message ─────────────────────────────────────
  function processMessage(container) {
    if (container.hasAttribute(PROCESSED_ATTR)) return
    container.setAttribute(PROCESSED_ATTR, 'true')

    waitForComplete(container, (text) => {
      const outputTokens = estimateTokens(text)
      const model = extractModel()
      const provider = SITE === 'claude' ? 'claude-web' : 'chatgpt-web'
      // We can only observe rendered output; input tokens are unknowable from the DOM.
      const inputTokens = 0

      const msg = { type: 'usage', provider, model, inputTokens, outputTokens }

      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Service worker may have been suspended — retry once after a short delay
          setTimeout(() => {
            chrome.runtime.sendMessage(msg, (r) => {
              if (!chrome.runtime.lastError && r) injectBadge(container, r)
            })
          }, 150)
          return
        }
        injectBadge(container, response)
      })
    })
  }

  // ── MutationObserver ────────────────────────────────────────────────────────
  let observer = null

  function initialize() {
    findAssistantContainers().forEach(processMessage)

    if (observer) observer.disconnect()
    observer = new MutationObserver(() => {
      findAssistantContainers().forEach(processMessage)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  // ── SPA navigation detection ────────────────────────────────────────────────
  // Both Claude and ChatGPT are SPAs — watch for URL changes via title mutations
  // and a polling fallback.
  let lastUrl = location.href

  const titleEl = document.querySelector('head > title')
  if (titleEl) {
    new MutationObserver(() => {
      if (location.href !== lastUrl) { lastUrl = location.href; initialize() }
    }).observe(titleEl, { childList: true })
  }

  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; initialize() }
  }, 1000)

  initialize()
})()
