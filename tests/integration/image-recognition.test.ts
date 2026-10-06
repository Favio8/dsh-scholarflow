import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callStageModelWithImage } from '../../src/host/executor/model.ts'

const signal = () => new AbortController().signal
const selected = { provider: 'TEST_ONLY-provider', model: 'TEST_ONLY-model' }
const image = { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]), mediaType: 'image/png', name: '截图.png' }

/** A Host stand-in whose attachment service mirrors the real admission contract. */
function host(overrides = {}) {
  const calls = { admitted: [], streamed: [], logged: [], flushes: 0 }
  const ctx = {
    attachments: {
      async admitPromptContent(content) {
        calls.admitted.push(content)
        // The real service replaces each upload with a durable reference; text passes through.
        return content.map(part => part.type === 'image' ? { type: 'image', attachment: { id: 'att_TEST_ONLY' } } : part)
      },
    },
    sessions: { async flush() { calls.flushes += 1; return true } },
    llm: {
      async *stream(request) {
        calls.streamed.push(request)
        yield { type: 'text-delta', text: '{"text":"要求：四页，第一页封面"}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    ...overrides,
  }
  const session = { id: 'session_TEST_ONLY', append(_type, message) { calls.logged.push(message) } }
  return { ctx, session, calls }
}

test('V4: an image is admitted through the host attachment service, never assembled by hand', async () => {
  const { ctx, session, calls } = host()
  const text = await callStageModelWithImage(ctx, session, selected, {
    runId: 'TEST_ONLY-run', signal: signal(), system: 'system', instruction: 'instruction', context: {}, image,
  })
  assert.equal(text, '{"text":"要求：四页，第一页封面"}')
  // The bytes went in as canonical base64 and the durable reference came back out.
  assert.equal(calls.admitted.length, 1)
  assert.equal(calls.admitted[0][1].type, 'image')
  assert.equal(calls.admitted[0][1].mediaType, 'image/png')
  assert.equal(Buffer.from(calls.admitted[0][1].data, 'base64').toString('latin1'), Buffer.from(image.bytes).toString('latin1'))
  // The request the provider receives carries the admitted block, not the raw bytes.
  const sent = calls.streamed[0].messages.at(-1)
  assert.equal(sent.content.some((part: any) => part.type === 'image' && part.attachment.id === 'att_TEST_ONLY'), true)
  assert.equal(sent.content.some((part: any) => 'data' in part), false)
})

test('V4: the stage log redacts the image instead of duplicating its bytes', async () => {
  const { ctx, session, calls } = host()
  await callStageModelWithImage(ctx, session, selected, {
    runId: 'TEST_ONLY-run', signal: signal(), system: 'system', instruction: 'instruction', context: {}, image,
  })
  const logged = JSON.stringify(calls.logged)
  // A session log is reconstructable by the host, so the plugin must not also persist the
  // upload there: the base64 must not appear in what this plugin appends.
  assert.equal(logged.includes(Buffer.from(image.bytes).toString('base64')), false, '日志不得包含图片 base64')
  // The payload is JSON-embedded in the message text, so match the marker rather than a quoting.
  assert.equal(logged.includes('<附件>'), true, '日志用占位符记录图片')
  assert.equal(calls.flushes, 2, '请求与结果各确认一次持久化')
})

test('V4: the run is refused rather than reported as success when it is not durable', async () => {
  const { ctx, session } = host({ sessions: { async flush() { return false } } })
  await assert.rejects(callStageModelWithImage(ctx, session, selected, {
    runId: 'TEST_ONLY-run', signal: signal(), system: 'system', instruction: 'instruction', context: {}, image,
  }), { code: 'UNSUPPORTED_DSH_CAPABILITY' })
})

test('V4: provider failures and truncation keep their own codes', async () => {
  const failing = host({ llm: { async *stream() { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMITED' } } } } } })
  await assert.rejects(callStageModelWithImage(failing.ctx, failing.session, selected, {
    runId: 'TEST_ONLY-run', signal: signal(), system: 'system', instruction: 'instruction', context: {}, image,
  }), { code: 'RATE_LIMITED' })

  const truncated = host({ llm: { async *stream() { yield { type: 'text-delta', text: '{"text":"部分' }; yield { type: 'finish', reason: { kind: 'max-tokens' } } } } })
  await assert.rejects(callStageModelWithImage(truncated.ctx, truncated.session, selected, {
    runId: 'TEST_ONLY-run', signal: signal(), system: 'system', instruction: 'instruction', context: {}, image,
  }), { code: 'MODEL_OUTPUT_LIMIT_REACHED' })

  const empty = host({ llm: { async *stream() { yield { type: 'finish', reason: { kind: 'stop' } } } } })
  await assert.rejects(callStageModelWithImage(empty.ctx, empty.session, selected, {
    runId: 'TEST_ONLY-run', signal: signal(), system: 'system', instruction: 'instruction', context: {}, image,
  }), { code: 'MODEL_OUTPUT_INCOMPLETE' })
})
