const test = require('brittle')
const EventEmitter = require('events')
const { createSyncEngine } = require('../sync-engine.js')

function fakeCore (pending) {
  const ee = new EventEmitter()
  return Object.assign(ee, {
    syncCalls: 0, applied: [],
    async sync () { this.syncCalls++ },
    async pendingWallpaper () { return pending.shift() || null },
    async markApplied (id) { this.applied.push(id) }
  })
}
function fakePlatform (opts = {}) {
  return { setCalls: [], async setWallpaper (p) { this.setCalls.push(p); if (opts.fail) throw new Error('setter boom') } }
}

test('applyPending: null pending is a no-op (no setter, no ack)', async (t) => {
  const core = fakeCore([]); const platform = fakePlatform()
  const eng = createSyncEngine({ core, platform })
  await eng.applyPending()
  t.is(platform.setCalls.length, 0)
  t.is(core.applied.length, 0)
})

test('applyPending: sets wallpaper then marks applied on success', async (t) => {
  const core = fakeCore([{ id: 's1', filePath: '/r/s1.png' }]); const platform = fakePlatform()
  const eng = createSyncEngine({ core, platform })
  await eng.applyPending()
  t.is(platform.setCalls[0], '/r/s1.png')
  t.alike(core.applied, ['s1'], 'ack written after setter success')
})

test('applyPending: setter failure skips markApplied and emits error (stays queued)', async (t) => {
  const core = fakeCore([{ id: 's2', filePath: '/r/s2.png' }]); const platform = fakePlatform({ fail: true })
  const eng = createSyncEngine({ core, platform })
  const errors = []; eng.on('error', (e) => errors.push(e))
  await eng.applyPending()
  t.is(platform.setCalls.length, 1)
  t.is(core.applied.length, 0, 'NOT acked on failure')
  t.is(errors.length, 1)
})

test("start(): a 'wallpaper' event triggers applyPending (real-time path)", async (t) => {
  const core = fakeCore([{ id: 's3', filePath: '/r/s3.png' }]); const platform = fakePlatform()
  const eng = createSyncEngine({ core, platform }); eng.start()
  core.emit('wallpaper', { id: 's3', filePath: '/r/s3.png' })
  await new Promise((r) => setTimeout(r, 20))
  t.alike(core.applied, ['s3'])
  eng.stop()
})

test("applyPending: a rejecting core call surfaces via 'error', not a throw", async (t) => {
  const core = fakeCore([])
  core.pendingWallpaper = async () => { throw new Error('pendingWallpaper boom') }
  const platform = fakePlatform()
  const eng = createSyncEngine({ core, platform })
  const errors = []; eng.on('error', (e) => errors.push(e))
  await t.execution(eng.applyPending())
  t.is(platform.setCalls.length, 0, 'setter never reached')
  t.is(errors.length, 1)
  t.is(errors[0].message, 'pendingWallpaper boom')
})

test('syncNow(): calls core.sync then applyPending and updates lastSync', async (t) => {
  const core = fakeCore([{ id: 's4', filePath: '/r/s4.png' }]); const platform = fakePlatform()
  const eng = createSyncEngine({ core, platform })
  t.is(eng.lastSync, null)
  await eng.syncNow()
  t.is(core.syncCalls, 1)
  t.alike(core.applied, ['s4'])
  t.ok(typeof eng.lastSync === 'number')
})

test("syncNow(): emits 'synced' after lastSync is stamped", async (t) => {
  const core = fakeCore([])
  const eng = createSyncEngine({ core, platform: fakePlatform() })
  const seen = []; eng.on('synced', () => seen.push(eng.lastSync))
  await eng.syncNow()
  t.is(seen.length, 1)
  t.is(seen[0], eng.lastSync)
})

test('syncNow(): a failed core.sync does not stamp lastSync or emit synced', async (t) => {
  const core = fakeCore([])
  core.sync = async () => { throw new Error('sync boom') }
  const eng = createSyncEngine({ core, platform: fakePlatform() })
  eng.on('error', () => {})
  let synced = 0; eng.on('synced', () => synced++)
  await eng.syncNow()
  t.is(eng.lastSync, null)
  t.is(synced, 0)
})

test("start(): a received wallpaper counts as a sync (stamps lastSync, emits 'synced')", async (t) => {
  const core = fakeCore([])
  const eng = createSyncEngine({ core, platform: null }); eng.start()
  t.teardown(() => eng.stop())
  let synced = 0; eng.on('synced', () => synced++)
  core.emit('wallpaper', { id: 's5', filePath: '/r/s5.png' })
  t.is(synced, 1)
  t.ok(typeof eng.lastSync === 'number')
})
