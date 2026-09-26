/**
 * Browser-automation acceptance for dsh-quote against a running DSH web GUI.
 *
 * Drives a REAL browser (Chrome) against a REAL `dsh --profile web` server and
 * asserts the user-visible surface end to end, phrased as the three things the
 * user must be able to do:
 *
 *   1. a quote staged with 「添加到对话」 shows as a card in the composer;
 *   2. hitting send makes that card disappear IMMEDIATELY and it stays gone —
 *      sampled for 60s, including the "agent is busy" case where the host
 *      legitimately keeps the quote queued for a long time;
 *   3. the quoted text arrives in the transcript as an ordinary user bubble,
 *      positioned ABOVE the user's own message.
 *
 * The transcript assertion is the reason this plugin delivers a quote as a
 * `source.kind: 'user'` message rather than a plugin-private injected-context
 * row: the GUI filters ordinary context rows out before any renderer runs, so a
 * private kind renders nowhere (ADR-0002), while a user message renders a normal
 * bubble (ADR-0003).
 *
 * The host renders a first-run 「内测声明」 dialog that masks the composer; this
 * script dismisses it. That dialog belongs to DSH, not to dsh-quote.
 *
 * Usage: node scripts/browser-test.mjs <baseUrl>
 * Exits non-zero when any assertion fails.
 * @module scripts/browser-test
 */
import { chromium } from 'playwright'

const base = process.argv[2]
if (base === undefined) {
  process.stderr.write('usage: node scripts/browser-test.mjs <baseUrl>\n')
  process.exit(2)
}

const results = []
let failures = 0

/**
 * Record one assertion.
 * @param name - the assertion label.
 * @param ok - whether it passed.
 * @param detail - extra context printed either way.
 */
function check(name, ok, detail = '') {
  results.push({ name, ok })
  if (!ok) failures += 1
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}\n`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

/** Console/page errors, filtered to the ones this plugin could own. */
const pageErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text())
})

/** Quote-API traffic proves which client actually mounted. */
const quotePolls = []
/** The session id the mounted dock polls with — the authoritative active id. */
let activeSessionId = null
page.on('request', (request) => {
  const match = /\/dsh-quote\/api\/quotes\?sessionId=([^&]+)/.exec(request.url())
  if (match === null) return
  quotePolls.push(request.url())
  activeSessionId = decodeURIComponent(match[1])
})

/** Dismiss the host's first-run beta notice when it is up. */
async function dismissHostDialog() {
  const button = page.locator('[role="dialog"] button:has-text("继续")').first()
  if (await button.isVisible().catch(() => false)) {
    await button.click()
    await page.waitForTimeout(500)
    return true
  }
  return false
}

try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('[contenteditable="true"][data-composer-input]', { timeout: 60_000 })
  check('GUI shell boots', true)
  check('host first-run dialog handled', true, (await dismissHostDialog()) ? 'dismissed' : 'already accepted')

  // 1) The client bundle is listed in the boot payload the host injects.
  const boot = await page.evaluate(() =>
    (window.__DSH_BOOT__?.entries ?? []).some(entry => entry.id === 'dsh-quote'))
  check('dsh-quote client bundle listed in window.__DSH_BOOT__', boot)

  // 2) The bundle evaluated and registered its entry: the mounted dock polls its
  //    own host API. Nothing else would call /dsh-quote/api/quotes.
  await page.waitForTimeout(2500)
  check('mounted dock polls the host quote API', quotePolls.length > 0, `${quotePolls.length} polls`)
  check('active session resolved from dock traffic', typeof activeSessionId === 'string' && activeSessionId.length > 0,
    String(activeSessionId))

  // 3) The overlay slot exists inside the resident composer card, which is the
  //    mount point the plugin registers into.
  const overlayInComposer = await page.evaluate(() => {
    const overlay = document.querySelector('[data-slot="conversation.input.overlay"]')
    return overlay !== null && overlay.closest('[data-composer-card]') !== null
  })
  check('conversation.input.overlay sits inside the composer card', overlayInComposer)

  // 4) Host bridge round-trip, driven from the page (same origin).
  const api = await page.evaluate(async () => {
    const put = await fetch('/dsh-quote/api/quotes?sessionId=browser-test', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quote: { text: '浏览器自动化选中的一段文字', sourceKind: 'assistant' } }),
    })
    const stored = await put.json()
    const list = await (await fetch('/dsh-quote/api/quotes?sessionId=browser-test')).json()
    const del = await (await fetch(
      `/dsh-quote/api/quotes?sessionId=browser-test&quoteId=${encodeURIComponent(stored.quote.id)}`,
      { method: 'DELETE' })).json()
    const empty = await (await fetch('/dsh-quote/api/quotes?sessionId=browser-test')).json()
    return { put: put.status, stored, list, del, empty }
  })
  check('host quote API reachable from the page', api.put === 200, `PUT ${api.put}`)
  check('PUT stores the quote', typeof api.stored.quote?.id === 'string', JSON.stringify(api.stored))
  check('GET lists it back verbatim',
    api.list.quotes.length === 1 && api.list.quotes[0].text === '浏览器自动化选中的一段文字')
  check('DELETE removes it', api.del.ok === true)
  check('queue is empty afterwards', api.empty.quotes.length === 0)

  // 5) Produce a real transcript row to select over.
  const composer = page.locator('[contenteditable="true"][data-composer-input]')
  await composer.click()
  await page.keyboard.type('用一句话说明什么是二分查找')
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-chat-flow-kind="user"]')].length > 0,
    undefined, { timeout: 60_000 },
  )
  check('sent a user message (transcript row exists)', true)

  // Wait for assistant text so there is prose to select.
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-chat-flow-key]')]
      .some(row => (row.textContent ?? '').trim().length > 40),
    undefined, { timeout: 120_000 },
  ).catch(() => {})
  const rowKinds = await page.evaluate(() =>
    [...document.querySelectorAll('[data-chat-flow-key]')].map(r => r.getAttribute('data-chat-flow-kind')))
  check('transcript rendered rows to select', rowKinds.length > 0, JSON.stringify(rowKinds))

  // 6) Select across a text-bearing row with a real mouse drag; the menu opens
  //    on mouseup over a `[data-chat-flow-key]` row.
  const box = await page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-chat-flow-key]')]
      .find(r => (r.textContent ?? '').trim().length > 40)
    if (row === undefined) return null
    const rect = row.getBoundingClientRect()
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  })
  if (box === null) {
    check('selection menu opens over a transcript row', false, 'no text-bearing row')
  } else {
    const y = box.y + Math.min(box.h / 2, 40)
    await page.mouse.move(box.x + 12, y)
    await page.mouse.down()
    await page.mouse.move(box.x + Math.min(box.w - 12, 260), y, { steps: 15 })
    await page.mouse.up()
    await page.waitForTimeout(700)
    const offer = await page.evaluate(() => document.querySelector('[data-dsh-quote-offer]') !== null)
    check('selection menu opens over a transcript row', offer)

    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('[data-dsh-quote-offer] button')].map(b => b.textContent?.trim()))
    check('menu offers 复制文本 / 添加到对话',
      labels.includes('复制文本') && labels.includes('添加到对话'), JSON.stringify(labels))

    // 7) 「添加到对话」 queues it and the composer rail renders a card.
    if (offer) {
      await page.click('[data-dsh-quote-offer] button:has-text("添加到对话")')
      const rail = await page.waitForSelector('[data-dsh-quote-rail] [data-quote-id]', { timeout: 15_000 })
        .then(() => true).catch(() => false)
      check('REQ1 clicking 添加到对话 renders a card in the chat window', rail)

      if (rail) {
        const detail = await page.evaluate(() => {
          const railEl = document.querySelector('[data-dsh-quote-rail]')
          return {
            text: document.querySelector('[data-dsh-quote-rail] .dsh-quote-card-title')?.textContent ?? '',
            inOverlay: railEl?.closest('[data-slot="conversation.input.overlay"]') !== null,
            inComposer: railEl?.closest('[data-composer-card]') !== null,
          }
        })
        check('REQ1 the card sits inside the composer card', detail.inOverlay && detail.inComposer)
        check('REQ1 the card carries the selected text', detail.text.trim().length > 0, detail.text.slice(0, 40))

        // Mark the quote so it is identifiable in the transcript afterwards. The
        // menu staged one already (quotes accumulate and all ride the same turn,
        // ADR-0001); this second one carries the marker the assertions look for.
        const MARKER = 'MARKER-引文正文-XYZ'
        const injectedId = await page.evaluate(async ({ id, marker }) => {
          const res = await fetch(`/dsh-quote/api/quotes?sessionId=${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ quote: { text: marker, sourceKind: 'assistant' } }),
          })
          return (await res.json()).quote.id
        }, { id: activeSessionId, marker: MARKER })
        check('a marked quote is staged for the send', typeof injectedId === 'string' && injectedId.length > 0)

        // ---- REQ2: the card must vanish on send, immediately, and stay gone ----
        const OWN_MESSAGE = 'MARKER-我自己的问题-XYZ'
        await composer.click()
        await page.keyboard.type(OWN_MESSAGE)
        await page.waitForTimeout(300)
        const sendAt = Date.now()
        await page.keyboard.press('Enter')

        // Sample hard for the first few seconds: "immediately" is the requirement.
        let clearedAt = null
        for (let i = 0; i < 120; i += 1) {
          const cards = await page.evaluate(() =>
            document.querySelectorAll('[data-dsh-quote-rail] [data-quote-id]').length)
          if (cards === 0) { clearedAt = Date.now() - sendAt; break }
          await page.waitForTimeout(25)
        }
        check('REQ2 the staged card disappears on send', clearedAt !== null,
          clearedAt === null ? 'still visible after 3s' : `${clearedAt}ms`)
        check('REQ2 it disappears immediately (<1000ms)', clearedAt !== null && clearedAt < 1000,
          String(clearedAt))

        // The card must not come back. This is the defect the user reported: a
        // send made while the agent is busy starts no turn, so the host
        // legitimately keeps the quote queued and a poll would restore the card.
        // 60s covers a busy turn and several poll cycles.
        let cameBack = false
        for (let i = 0; i < 60; i += 1) {
          await page.waitForTimeout(1000)
          const cards = await page.evaluate(() =>
            document.querySelectorAll('[data-dsh-quote-rail] [data-quote-id]').length)
          if (cards > 0) { cameBack = true; break }
        }
        check('REQ2 the card does NOT come back within 60s', !cameBack)

        // No receipt may take its place: a second card in the same slot was
        // exactly what made the old build look like "the card never goes away".
        const lingering = await page.evaluate(() => ({
          rail: document.querySelectorAll('[data-dsh-quote-rail] [data-quote-id]').length,
          receipt: document.querySelectorAll('[data-dsh-quote-receipt] [data-quote-id]').length,
        }))
        check('REQ2 nothing replaces the card in the composer',
          lingering.rail === 0 && lingering.receipt === 0, JSON.stringify(lingering))

        // ---- REQ3: the quote is a user message, above the user's own message ----
        await page.waitForFunction(
          (marker) => [...document.querySelectorAll('[data-chat-flow-kind="user"]')]
            .some(row => (row.textContent ?? '').includes(marker)),
          MARKER, { timeout: 120_000 },
        ).then(() => true).catch(() => false)
        const userRows = await page.evaluate(() =>
          [...document.querySelectorAll('[data-chat-flow-kind="user"]')]
            .map(row => (row.textContent ?? '').trim()))
        const quoteIndex = userRows.findIndex(text => text.includes(MARKER))
        const ownIndex = userRows.findIndex(text => text.includes(OWN_MESSAGE))
        check('REQ3 the quote renders in the transcript as a user message', quoteIndex >= 0,
          JSON.stringify(userRows.map(t => t.slice(0, 30))))
        check('REQ3 the quote sits ABOVE the user\'s own message',
          quoteIndex >= 0 && ownIndex >= 0 && quoteIndex < ownIndex,
          `quote@${quoteIndex} own@${ownIndex}`)

        // REQ3 holds only because the quote is delivered as source.kind 'user'.
        // A private injected-context kind would render no row at all (ADR-0002).
        const contextRows = await page.evaluate(() =>
          document.querySelectorAll('[data-chat-flow-kind="context"]').length)
        check('the quote is not delivered as a hidden injected-context row',
          contextRows === 0, `${contextRows} context rows`)

        const drained = await page.evaluate(async (id) =>
          (await (await fetch(`/dsh-quote/api/quotes?sessionId=${encodeURIComponent(id)}`)).json()).quotes,
          activeSessionId)
        check('quote queue drained after delivery (one-shot)', drained.length === 0, JSON.stringify(drained))
      }
    }
  }

  // 9) Only errors attributable to dsh-quote count. The host's own
  //    `conversation.input.dock` React #130 comes from another plugin.
  const ours = pageErrors.filter(text => /dsh-quote/i.test(text))
  check('no dsh-quote page errors', ours.length === 0, ours.slice(0, 3).join(' | '))
} finally {
  await page.screenshot({ path: 'dist/browser-test.png' }).catch(() => {})
  await browser.close()
  process.stdout.write(`\n${results.length - failures}/${results.length} checks passed\n`)
  process.exit(failures === 0 ? 0 : 1)
}
