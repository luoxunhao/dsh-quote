/**
 * Browser-automation acceptance for dsh-quote against a running DSH web GUI.
 *
 * Drives a REAL browser (Chrome) against a REAL `dsh --profile web` server and
 * asserts the user-visible surface end to end: the client bundle loads, mounts
 * into `conversation.input.overlay` inside the composer card, opens the
 * select→quote menu over a genuine transcript row, queues a quote through the
 * host HTTP bridge, renders the pending-quote card, removes it, and — on the
 * next real user turn — injects the quote as `quote-context` and shows the
 * composer receipt that confirms it rode the message.
 *
 * Why a receipt and not a transcript card: the GUI filters ordinary
 * injected-context rows out of the transcript before any renderer runs, so that
 * row never exists to assert against. See docs/adr/0002-quote-visibility.md.
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
      check('clicking 添加到对话 renders a pending-quote card', rail)

      if (rail) {
        const detail = await page.evaluate(() => {
          const railEl = document.querySelector('[data-dsh-quote-rail]')
          return {
            text: document.querySelector('[data-dsh-quote-rail] .dsh-quote-card-title')?.textContent ?? '',
            inOverlay: railEl?.closest('[data-slot="conversation.input.overlay"]') !== null,
          }
        })
        check('pending card lives inside conversation.input.overlay', detail.inOverlay)
        check('pending card carries the selected text', detail.text.trim().length > 0, detail.text.slice(0, 40))

        // 8) Queue a quote for the ACTIVE session and send the next real turn:
        //    the host fold injects it and the composer reports it back.
        //
        // The quote staged in step 7 is still pending — quotes accumulate and
        // all of them ride the same turn (ADR-0001) — so this turn injects two
        // and the assertions below address the one queued here by its id.
        const injected = await page.evaluate(async (id) => {
          const res = await fetch(`/dsh-quote/api/quotes?sessionId=${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ quote: { text: '这是被注入的引文正文', sourceKind: 'assistant' } }),
          })
          return (await res.json()).quote.id
        }, activeSessionId)
        await composer.click()
        await page.keyboard.type('继续')
        await page.keyboard.press('Enter')

        const receipt = await page.waitForSelector(
          `[data-dsh-quote-receipt] [data-quote-id="${injected}"]`, { timeout: 120_000 },
        ).then(() => true).catch(() => false)
        check('sent-quote receipt appears in the composer', receipt)

        if (receipt) {
          const detail = await page.evaluate((quoteId) => {
            const card = document.querySelector(`[data-dsh-quote-receipt] [data-quote-id="${quoteId}"]`)
            return {
              text: card?.querySelector('.dsh-quote-receipt-title')?.textContent ?? '',
              inComposer: card?.closest('[data-composer-card]') !== null,
              inOverlay: card?.closest('[data-slot="conversation.input.overlay"]') !== null,
            }
          }, injected)
          check('receipt carries the injected text verbatim', detail.text.includes('这是被注入的引文正文'),
            detail.text.slice(0, 40))
          check('receipt lives inside the composer card', detail.inComposer && detail.inOverlay)
        }

        // The GUI hides ordinary injected-context rows, so the transcript must
        // NOT be relied on for this. Pin the fact rather than the absence of a
        // card, so a host that starts rendering them is noticed, not silently
        // tolerated (docs/adr/0002-quote-visibility.md).
        const contextRows = await page.evaluate(() =>
          document.querySelectorAll('[data-chat-flow-kind="context"]').length)
        check('transcript renders no injected-context row (the ADR-0002 premise)',
          contextRows === 0, `${contextRows} rows`)

        const sent = await page.evaluate(async (id) =>
          (await (await fetch(`/dsh-quote/api/sent?sessionId=${encodeURIComponent(id)}`)).json()).quotes,
          activeSessionId)
        check('host recorded this turn\'s quote as sent',
          sent.some(quote => quote.id === injected && quote.text === '这是被注入的引文正文'),
          JSON.stringify(sent))
        check('both staged quotes rode the one turn (accumulate, not replace)',
          sent.length === 2, `${sent.length} sent`)

        const drained = await page.evaluate(async (id) =>
          (await (await fetch(`/dsh-quote/api/quotes?sessionId=${encodeURIComponent(id)}`)).json()).quotes,
          activeSessionId)
        check('quote queue drained after injection (one-shot)', drained.length === 0, JSON.stringify(drained))
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
