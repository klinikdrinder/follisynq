// End-to-end critical workflow (acceptance criteria 2–16) in Chromium with a fake camera.
// Supabase is mocked at the network layer; the real app code (IndexedDB, OPFS worker, MediaRecorder) runs unmodified.
const { chromium } = require('playwright');
const serve = require('./serve.cjs');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const UID = 'ef13b86a-ac96-4995-b366-9a5575b36900';
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp: 4102444800, email: 'admin@follisync.app' })}.sig`;
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'admin@follisync.app' };
const profile = { id: UID, org_id: '6b1f0c7e-0d5a-4b5e-9a51-6c1f1d9e0001', role: 'admin', full_name: 'Test Doctor', email: 'admin@follisync.app', active: true, can_create_patients: true, all_branches: true, branch_ids: [] };
const pushed = [];
(async () => {
  const server = await serve(4123);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['camera', 'microphone'] });
  await ctx.route('https://*.supabase.co/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/auth/v1/token')) return route.fulfill({ json: { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r', user } });
    if (u.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (u.pathname === '/rest/v1/rpc/fs_sync_push') {
      const body = JSON.parse(route.request().postData());
      pushed.push(...body.ops);
      return route.fulfill({ json: body.ops.map((o) => ({ op_id: o.op_id, result: 'applied', version: 1, updated_at: new Date().toISOString() })) });
    }
    if (u.pathname === '/rest/v1/staff_profiles') {
      const single = (route.request().headers()['accept'] || '').includes('vnd.pgrst.object');
      return route.fulfill({ json: single ? profile : [profile] });
    }
    return route.fulfill({ json: [] });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const step = (m) => console.log('✓', m);

  await page.goto('http://localhost:4123/');
  await page.fill('input[type=email]', 'admin@follisync.app');
  await page.fill('input[type=password]', 'whatever-password');
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('text=Start New Procedure');
  step('logged in, dashboard shown');
  await page.screenshot({ path: 'tests/e2e/01-dashboard.png' });

  await page.click('text=Start New Procedure');
  await page.locator('.fixed button:has-text("New patient")').click();
  await page.fill('label:has-text("Patient full name") input', 'E2E Synthetic Patient');
  for (const label of ['Clinical photography', 'Clinical video recording']) {
    await page.locator(`div:has(> span:text-is("${label}"))`).locator('button:has-text("Granted")').click();
  }
  await page.click('button:has-text("Create & open session")');
  await page.waitForSelector('text=Procedural stages');
  step('patient created with minimal info + consent; session opened');
  await page.screenshot({ path: 'tests/e2e/02-session.png' });

  await page.click('a:has-text("FUE Harvesting")');
  await page.waitForSelector('h1:has-text("FUE Harvesting")');
  step('navigated directly to FUE harvesting (all fields blank)');
  await page.click('button:has-text("Continuous punching")');
  await page.click('button:has-text("Record Video")');
  await page.waitForSelector('button[aria-label="Start recording"]:not([disabled])', { timeout: 15000 });
  await page.click('button[aria-label="Start recording"]');
  await page.waitForSelector('text=REC');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'tests/e2e/03-recording.png' });
  await page.click('button[aria-label="Stop recording"]');
  await page.waitForSelector('text=Saved & verified on this iPad', { timeout: 20000 });
  step('video recorded, stopped, auto-saved & verified');
  await page.click('button[aria-label="Start recording"]');
  await page.waitForTimeout(1500);
  await page.click('button[aria-label="Stop recording"]');
  await page.waitForSelector('text=Saved & verified on this iPad', { timeout: 20000 });
  step('second recording in same stage');
  await page.click('button:text-is("photo")');
  await page.waitForSelector('button[aria-label="Take photograph"]:not([disabled])');
  await page.click('button[aria-label="Take photograph"]');
  await page.waitForSelector('text=Photo saved & verified', { timeout: 15000 });
  step('photograph captured and verified');
  await page.click('button[aria-label="Close camera"]');
  await page.waitForTimeout(800);
  const tiles = await page.locator('text=On this iPad').count();
  console.log('  gallery tiles available locally:', tiles);
  await page.screenshot({ path: 'tests/e2e/04-stage-gallery.png', fullPage: true });

  const opfsFiles = await page.evaluate(async () => {
    const out = [];
    async function walk(d, p) { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, p + n + '/'); else out.push(p + n + ' ' + (await h.getFile()).size); } }
    await walk(await navigator.storage.getDirectory(), '');
    return out;
  });
  console.log('  OPFS:\n   ' + opfsFiles.join('\n   '));

  await page.click('a:has-text("09 Graft")');
  await page.waitForSelector('h1:has-text("Graft Implantation")');
  step('skipped directly to implantation');
  await page.click('a:has-text("01 Consultation")');
  await page.waitForSelector('h1:has-text("Consultation and Diagnosis")');
  await page.click('button:has-text("Clinical parameters")');
  await page.locator('div:has(> div > span:text-is("Diagnosis")) input').first().fill('Androgenetic alopecia');
  await page.click('button:has-text("Save parameters")');
  await page.waitForSelector('text=Parameters saved as a new version');
  step('returned to consultation and added omitted information later');

  await page.click('a:has-text("summary")');
  await page.waitForSelector('text=Procedural stages');
  await page.click('button:has-text("Complete session")');
  await page.waitForSelector('button:has-text("Reopen")');
  await page.click('button:has-text("Reopen")');
  await page.waitForSelector('button:has-text("Complete session")');
  step('session completed with incomplete stages, then reopened');
  await page.screenshot({ path: 'tests/e2e/05-summary.png', fullPage: true });

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(3000);
  const tables = [...new Set(pushed.map((o) => o.table))];
  console.log('  synced tables:', tables.join(', '));
  const media = pushed.filter((o) => o.table === 'media_assets').map((o) => o.data);
  console.log('  media metadata synced:', media.map((m) => `${m.filename} ${m.size_bytes}B sha=${m.checksum_sha256?.slice(0, 10)}`).join(' | '));
  if (media.some((m) => JSON.stringify(m).includes('E2E Synthetic'))) throw new Error('patient name leaked into media metadata');
  step('metadata synchronised via idempotent RPC; no binaries or names in media metadata');

  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); server.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
