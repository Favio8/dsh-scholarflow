import { Worker } from 'node:worker_threads'
import { type ParsedBody, parseRange } from '../../shared/materials.ts'
import { ScholarError } from '../../shared/errors.ts'
import { type z } from 'zod'

export async function parseMaterialBytes(bytes: Uint8Array, mediaType: string, signal: AbortSignal, range?: z.infer<typeof parseRange>): Promise<ParsedBody> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.resolve('#scholarflow-parser')), { workerData: { bytes, mediaType, range }, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 }, stdout: true, stderr: true })
    // Parser logs may contain source fragments. They are never forwarded to Host logs.
    worker.stdout.resume(); worker.stderr.resume()
    const timer = setTimeout(() => finish(new ScholarError('PARSE_TIMEOUT', '解析超过 20 秒，请缩小资料或解析范围。')), 20000)
    let done = false
    const abort = () => finish(new ScholarError('CANCELLED', '已取消资料解析；原始资料未改变。'))
    const finish = (error?: Error, data?: ParsedBody) => {
      if (done) return
      done = true; clearTimeout(timer); signal.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) reject(error); else resolve(data!)
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    worker.on('message', result => result.ok ? finish(undefined, result.data) : finish(new ScholarError(result.code, result.message)))
    worker.on('error', () => finish(new ScholarError('MATERIAL_PARSE_FAILED', '资料解析进程失败；原始资料未改变。')))
    worker.on('exit', () => { if (!done) finish(new ScholarError('MATERIAL_PARSE_FAILED', '资料解析进程提前退出；原始资料未改变。')) })
  })
}
