import { expect, test, type Locator, type Page } from '@playwright/test'

async function waitHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.fx42Hydrated === 'true')
}

async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await waitHydrated(page)
}

async function login(page: Page, provider = 'Mock DN42 (Alice)'): Promise<void> {
  await gotoHydrated(page, '/login')
  await page.getByText(provider).click()
  await page.waitForURL('/')
  await waitHydrated(page)
}

async function animatedText(root: Locator): Promise<string> {
  const flow = root.locator('number-flow-vue')
  if (await flow.count()) return (await flow.first().getAttribute('title')) ?? ''
  return root.innerText()
}

test('mock DN42 login reaches the dashboard and can trade', async ({ page }) => {
  await login(page)
  await expect(page.getByText('FX42').first()).toBeVisible()
  await gotoHydrated(page, '/wallet')
  await expect(page.getByRole('heading', { name: /Wallet/ })).toBeVisible()
})

test('generic mock provider gets a separate account', async ({ page }) => {
  await login(page, 'Mock Generic OIDC')
  const me = await page.request.get('/api/me')
  expect(me.ok()).toBeTruthy()
  const body = await me.json()
  expect(body.user.providerKind).toBe('generic')
  expect(body.user.activeMnt).toBeNull()
  expect(body.user.displayName).toBe('Bob')
  expect(body.user.termsAccepted).toBe(true)
})

test('settings exposes P&L colors and wallet history tabs', async ({ page }) => {
  await login(page)
  await gotoHydrated(page, '/settings')
  await expect(page.getByText('P&L colors')).toBeVisible()
  await expect(page.getByText('Classic green/red')).toBeVisible()
  await expect(page.getByRole('button', { name: /Classic green\/red/ })).toBeVisible()
  await gotoHydrated(page, '/wallet')
  await expect(page.getByRole('button', { name: 'Deposits' })).toBeVisible()
  await page.getByRole('button', { name: 'Withdrawals' }).click()
  await expect(page.getByRole('button', { name: 'Withdrawals' })).toBeVisible()
})

test('trade page uses FTK prices without a candle width control', async ({ page }) => {
  await login(page)
  await gotoHydrated(page, '/trade/EURUSD')
  await expect(page.getByLabel('Candle width')).toHaveCount(0)
  await expect(page.getByText('Reference: 1 FTK = 0.01 USD')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Native quote' })).toHaveCount(0)

  const ticker = await page.request.get('/api/markets/EURUSD/ticker')
  expect(ticker.ok()).toBeTruthy()
  expect(Number((await ticker.json()).mid)).toBeGreaterThan(10)

  const candles = await page.request.get('/api/markets/USDJPY/candles?interval=1h&limit=10')
  expect(candles.ok()).toBeTruthy()
  const body = await candles.json()
  expect(Number(body.bars[body.bars.length - 1].c)).toBeLessThan(10)
})

test('dashboard rows navigate to the matching trade page', async ({ page }) => {
  await login(page)
  const symbol = 'EURUSD'
  const opened = await page.request.post('/api/orders', {
    data: {
      mode: 'virtual',
      symbol,
      side: 'long',
      lots: '0.1',
      leverage: 100,
      type: 'market',
      clientOrderId: `e2e-dashboard-nav-${Date.now()}`,
    },
  })
  expect(opened.ok()).toBeTruthy()
  const position = (await opened.json()).position

  await gotoHydrated(page, '/')
  const marketRow = page.getByTestId('dashboard-market-row').first()
  await expect(marketRow).toBeVisible()
  const marketSymbol = (await marketRow.innerText()).trim().split(/\s+/)[0]
  await marketRow.click()
  await expect(page).toHaveURL(new RegExp(`/trade/${marketSymbol}`))

  await gotoHydrated(page, '/')
  const positionRow = page.getByTestId('dashboard-position-row').filter({ hasText: symbol })
  await expect(positionRow).toBeVisible()
  await positionRow.click()
  await expect(page).toHaveURL(new RegExp(`/trade/${symbol}`))

  await page.request.post(`/api/positions/${position.id}/close`, {
    data: { clientOrderId: `e2e-dashboard-nav-close-${Date.now()}` },
  })
})

test('TP/SL dialog offers quick set buttons and range hints', async ({ page }) => {
  await login(page)
  const symbol = 'EURUSD'
  const opened = await page.request.post('/api/orders', {
    data: {
      mode: 'virtual',
      symbol,
      side: 'long',
      lots: '0.1',
      leverage: 100,
      type: 'market',
      clientOrderId: `e2e-tpsl-quick-${Date.now()}`,
    },
  })
  expect(opened.ok()).toBeTruthy()
  const position = (await opened.json()).position

  await gotoHydrated(page, `/trade/${symbol}`)
  const trigger = page.getByRole('button', { name: 'Set TP/SL' })
  await expect(trigger).toBeVisible()
  await trigger.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/Valid range:/).first()).toBeVisible()
  const inputs = dialog.locator('input[type=number]')
  await expect(inputs).toHaveCount(2)
  const quick = dialog.getByRole('button', { name: '25 pips' })
  await expect(quick).toHaveCount(2)

  await quick.nth(0).click()
  await expect(inputs.nth(0)).not.toHaveValue('')
  await quick.nth(1).click()
  await expect(inputs.nth(1)).not.toHaveValue('')

  expect(Number(await inputs.nth(0).inputValue())).toBeGreaterThan(Number(position.entryPrice))
  expect(Number(await inputs.nth(1).inputValue())).toBeLessThan(Number(position.entryPrice))

  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  await page.request.post(`/api/positions/${position.id}/tpsl`, {
    data: { takeProfit: null, stopLoss: null },
  })
  await page.request.post(`/api/positions/${position.id}/close`, {
    data: { clientOrderId: `e2e-tpsl-quick-close-${Date.now()}` },
  })
})

test('partial close preserves the remainder and TP/SL', async ({ page }) => {
  await login(page)
  const symbol = test.info().project.name === 'mobile' ? 'GBPUSD' : 'EURUSD'
  const opened = await page.request.post('/api/orders', {
    data: {
      mode: 'virtual',
      symbol,
      side: 'long',
      lots: '0.2',
      leverage: 100,
      type: 'market',
      clientOrderId: `e2e-partial-open-${Date.now()}`,
    },
  })
  expect(opened.ok()).toBeTruthy()
  const openedBody = await opened.json()
  const position = openedBody.position
  const entry = Number(position.entryPrice)
  expect(entry).toBeGreaterThan(10)

  const tpsl = await page.request.put(`/api/positions/${position.id}/tpsl`, {
    data: {
      takeProfit: (entry + 5).toFixed(5),
      stopLoss: (entry - 5).toFixed(5),
    },
  })
  expect(tpsl.ok()).toBeTruthy()

  const partial = await page.request.post(`/api/positions/${position.id}/close`, {
    data: {
      units: '5000',
      clientOrderId: `e2e-partial-close-${Date.now()}`,
    },
  })
  expect(partial.ok()).toBeTruthy()
  const partialBody = await partial.json()
  expect(partialBody.fullyClosed).toBe(false)
  expect(partialBody.closedUnits).toBe('5000')
  expect(partialBody.remainingUnits).toBe('15000')
  expect(partialBody.position.takeProfit).not.toBeNull()
  expect(partialBody.position.stopLoss).not.toBeNull()
  expect(partialBody.order.reduceOnly).toBe(true)

  const overClose = await page.request.post(`/api/positions/${position.id}/close`, {
    data: {
      units: '25000',
      clientOrderId: `e2e-over-close-${Date.now()}`,
    },
  })
  expect(overClose.status()).toBe(400)
  expect((await overClose.json()).error.code).toBe('INVALID_UNITS')

  const full = await page.request.post(`/api/positions/${position.id}/close`, {
    data: {
      units: '15000',
      clientOrderId: `e2e-full-close-${Date.now()}`,
    },
  })
  expect(full.ok()).toBeTruthy()
  const fullBody = await full.json()
  expect(fullBody.fullyClosed).toBe(true)
  expect(fullBody.position).toBeNull()
})

test('partial close dialog closes half and keeps the position open', async ({ page }) => {
  await login(page)
  const symbol = test.info().project.name === 'mobile' ? 'AUDUSD' : 'XAUUSD'
  const opened = await page.request.post('/api/orders', {
    data: {
      mode: 'virtual',
      symbol,
      side: 'long',
      lots: '0.2',
      leverage: 100,
      type: 'market',
      clientOrderId: `e2e-ui-partial-open-${Date.now()}`,
    },
  })
  expect(opened.ok()).toBeTruthy()

  await gotoHydrated(page, '/positions')
  const row = page.locator('tr', { hasText: symbol }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Partial close' }).click()
  await page.getByRole('button', { name: '50%' }).click()
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText(/Partial close complete/).first()).toBeVisible()

  const positions = await page.request.get('/api/positions?mode=virtual')
  const body = await positions.json()
  const position = body.items.find((p: { symbol: string }) => p.symbol === symbol)
  expect(position).toBeTruthy()
  expect(Number(position.units)).toBeGreaterThan(0)

  await page.request.post(`/api/positions/${position.id}/close`, {
    data: { clientOrderId: `e2e-ui-partial-cleanup-${Date.now()}` },
  })
})

test('account snapshot numbers refresh automatically', async ({ page }) => {
  const provider = test.info().project.name === 'mobile' ? 'Mock Generic OIDC' : 'Mock DN42 (Alice)'
  const symbol = test.info().project.name === 'mobile' ? 'EURUSD' : 'XAUUSD'
  await login(page, provider)
  const opened = await page.request.post('/api/orders', {
    data: {
      mode: 'virtual',
      symbol,
      side: 'long',
      lots: '0.2',
      leverage: 100,
      type: 'market',
      clientOrderId: `e2e-refresh-open-${Date.now()}`,
    },
  })
  expect(opened.ok()).toBeTruthy()
  const openedBody = await opened.json()
  const positionId = openedBody.position.id

  const snapshotResponse = await page.request.get('/api/account/snapshot?mode=virtual')
  expect(snapshotResponse.ok()).toBeTruthy()
  const snapshot = await snapshotResponse.json()
  expect(snapshot.positions.some((p: { id: string }) => p.id === positionId)).toBe(true)
  const marginSum = snapshot.positions.reduce(
    (sum: number, p: { margin: string }) => sum + Number(p.margin),
    0,
  )
  const pnlSum = snapshot.positions.reduce(
    (sum: number, p: { unrealizedPnl: string }) => sum + Number(p.unrealizedPnl),
    0,
  )
  expect(Number(snapshot.wallet.marginUsed)).toBeCloseTo(marginSum, 6)
  expect(Number(snapshot.wallet.unrealizedPnl)).toBeCloseTo(pnlSum, 6)

  const realResponse = await page.request.get('/api/account/snapshot?mode=real')
  expect(realResponse.ok()).toBeTruthy()
  const realSnapshot = await realResponse.json()
  expect(realSnapshot.positions.some((p: { id: string }) => p.id === positionId)).toBe(false)

  await gotoHydrated(page, '/')
  const equity = page.getByTestId('account-equity')
  await expect(equity).toBeVisible()
  const equityBefore = await animatedText(equity)
  await expect.poll(async () => animatedText(equity), { timeout: 6000 }).not.toBe(equityBefore)

  await gotoHydrated(page, `/trade/${symbol}`)
  const positionPnl = page.getByTestId('position-pnl')
  await expect(positionPnl).toBeVisible()
  const pnlBefore = await positionPnl.innerText()
  await expect.poll(async () => positionPnl.innerText(), { timeout: 10_000 }).not.toBe(pnlBefore)

  await page.request.post(`/api/positions/${positionId}/close`, {
    data: { clientOrderId: `e2e-refresh-cleanup-${Date.now()}` },
  })
})

test('UI theme and light/dark mode switch', async ({ page }) => {
  await login(page)
  await gotoHydrated(page, '/settings')
  await expect
    .poll(() => page.evaluate(() => document.querySelector('link[rel=icon]')?.getAttribute('href')))
    .toContain('favicon-dark.svg')
  await page.getByRole('button', { name: /Sky/ }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fx42-ui-theme'))).toBe('sky')
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--ui-radius').trim(),
      ),
    )
    .toBe('0.5rem')
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(false)
  await expect
    .poll(() => page.evaluate(() => document.querySelector('link[rel=icon]')?.getAttribute('href')))
    .toContain('favicon-light.svg')
  await page.getByLabel('Toggle light/dark mode').click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true)
})

test('login page uses the favicon and exposes language and mode controls', async ({ page }) => {
  await gotoHydrated(page, '/login')
  const icon = page.locator('img[src*="favicon"]')
  await expect(icon).toBeVisible()
  const src = await icon.getAttribute('src')
  expect(src).toMatch(/favicon-(dark|light)\.svg/)
  await expect(page.getByLabel('Toggle light/dark mode')).toBeVisible()
  await expect(page.getByLabel('Language')).toBeVisible()
  await page.getByLabel('Toggle light/dark mode').click()
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector('img[src*="favicon"]')?.getAttribute('src')),
    )
    .toContain('favicon-light.svg')
})

test('disclaimer is reachable from the account menu as a read-only page', async ({ page }) => {
  await login(page)
  await page.getByLabel('Account menu').click()
  await page.getByRole('menuitem', { name: 'Disclaimer' }).click()
  await page.waitForURL('**/terms')
  await waitHydrated(page)
  await expect(
    page.getByText(
      'You accepted this notice on your first sign-in and may review the latest version at any time.',
    ),
  ).toBeVisible()
  await expect(page.locator('img[src="/meme.jpg"]')).toBeVisible()
  await expect(page.locator('input[type=checkbox]')).toHaveCount(0)
})

test('PWA manifest and icons are served for home screen installation', async ({
  page,
  request,
}) => {
  await gotoHydrated(page, '/login')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  )
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icons/apple-touch-icon.png',
  )

  const response = await request.get('/manifest.webmanifest')
  expect(response.ok()).toBeTruthy()
  expect(response.headers()['content-type']).toContain('application/manifest+json')

  interface WebAppManifest {
    name: string
    display: string
    start_url: string
    icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>
  }
  const manifest = (await response.json()) as WebAppManifest
  expect(manifest.name).toBe('FX42')
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBe('/')
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  )
  expect(manifest.icons.map((icon) => icon.purpose)).toEqual(
    expect.arrayContaining(['any', 'maskable']),
  )

  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src)
    expect(iconResponse.ok(), icon.src).toBeTruthy()
    expect(iconResponse.headers()['content-type'], icon.src).toContain('image/png')
  }
  const appleIcon = await request.get('/icons/apple-touch-icon.png')
  expect(appleIcon.ok()).toBeTruthy()
})
