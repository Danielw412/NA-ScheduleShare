import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createPredictionReadyNotifier, smtpConfigured, smtpNotifierConfigFromEnvironment } from './notifier.js'
import { createPredictionFunction, developmentPlaceholderAllowed } from './prediction-engine.js'
import { createScheduleEngineStore } from './supabase-store.js'
import type { ScheduleEngineStore } from './types.js'
import { processFullQueue, processNextJob } from './worker.js'

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

export function controlPanelHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Schedule Engine worker</title><style>
  :root{font-family:Inter,system-ui,sans-serif;color:#151515;background:#f2f1ed}*{box-sizing:border-box}body{margin:0}header{padding:22px 5vw;background:#101010;color:#fff;border-bottom:5px solid #f4b41a}header h1{margin:0;font-size:24px}header p{margin:5px 0 0;color:#bbb}main{width:min(1200px,92vw);margin:24px auto}.toolbar,.stats,.job{background:#fff;border:1px solid #ccc}.toolbar{padding:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}button{padding:10px 14px;border:1px solid #111;background:#111;color:#fff;font-weight:750;cursor:pointer}button.secondary{background:#fff;color:#111}button:disabled{opacity:.45}.stats{display:grid;grid-template-columns:repeat(5,1fr);margin-top:16px}.stat{padding:16px;border-right:1px solid #ddd}.stat:last-child{border:0}.stat strong{display:block;font-size:26px}.stat span,.muted{font-size:12px;color:#666}.banner{padding:12px;margin:16px 0;border-left:4px solid #f4b41a;background:#fff7dd}.jobs{display:grid;gap:10px}.job summary{padding:14px;display:grid;grid-template-columns:12px 110px 1fr auto;gap:10px;align-items:center;cursor:pointer}.dot{width:9px;height:9px;border-radius:50%;background:#888}.queued{background:#d28a00}.processing{background:#2878b5}.completed{background:#278b45}.failed{background:#c63535}.body{padding:15px;border-top:1px solid #ddd}.body p{margin:5px 0}.debug{white-space:pre-wrap;overflow:auto;padding:12px;background:#161616;color:#d6f5d6;font:12px ui-monospace,monospace}.log{max-height:220px;overflow:auto;margin-top:16px}.log div{padding:7px 10px;border-bottom:1px solid #333}@media(max-width:700px){.stats{grid-template-columns:1fr 1fr}.stat{border-bottom:1px solid #ddd}.job summary{grid-template-columns:12px 1fr}.job summary>*:nth-child(n+3){grid-column:2}.toolbar button{width:100%}}</style></head>
  <body><header><h1>Schedule Engine · Laptop worker</h1><p>Local queue control and diagnostics</p></header><main><div class="toolbar"><button id="one">Process one job</button><button id="queue">Process full queue</button><button class="secondary" id="refresh">Refresh</button><span id="worker" class="muted"></span></div><div id="banner" class="banner">Connecting…</div><section id="stats" class="stats"></section><section id="jobs" class="jobs"></section><section class="debug log" id="log"></section></main><script>
  const el=id=>document.getElementById(id);let busy=false;
  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  async function request(path,method='GET'){const response=await fetch(path,{method});const body=await response.json();if(!response.ok)throw new Error(body.error||'Request failed');return body}
  function stat(label,value){return '<div class="stat"><strong>'+value+'</strong><span>'+label+'</span></div>'}
  async function refresh(){try{const data=await request('/api/status');busy=data.busy;el('one').disabled=busy;el('queue').disabled=busy;el('worker').textContent='Worker: '+data.workerId;el('banner').textContent=(data.placeholderEnabled?'Development placeholder enabled.':'Prediction engine not implemented; real jobs will fail safely.')+' Email: '+(data.emailConfigured?'configured':'not configured')+'.';const counts=data.counts;el('stats').innerHTML=stat('Queued',counts.queued)+stat('Processing',counts.processing)+stat('Completed',counts.completed)+stat('Failed',counts.failed)+stat('Cancelled',counts.cancelled);el('jobs').innerHTML=data.jobs.map(job=>'<details class="job" '+(['queued','processing'].includes(job.status)?'open':'')+'><summary><i class="dot '+esc(job.status)+'"></i><strong>'+esc(job.status)+'</strong><span>'+esc(job.user_name)+' · '+esc(job.source_courses.map(r=>r.course_name).join(' + '))+' → '+esc(job.replacement_courses.map(r=>r.course_name).join(' + '))+'</span><small>'+esc(new Date(job.created_at).toLocaleString())+'</small></summary><div class="body"><p><b>ID:</b> '+esc(job.id)+'</p><p><b>Worker:</b> '+esc(job.worker_id||'unclaimed')+' · <b>Attempts:</b> '+esc(job.attempt_count)+'</p><p><b>Error:</b> '+esc(job.error_message||job.notification_error||'none')+'</p><details><summary>Raw debug data</summary><pre class="debug">'+esc(JSON.stringify(job,null,2))+'</pre></details></div></details>').join('')||'<p class="banner">The queue is empty.</p>';el('log').innerHTML=data.logs.map(line=>'<div>'+esc(line)+'</div>').join('')}catch(error){el('banner').textContent=error.message}}
  async function run(path){try{busy=true;el('one').disabled=true;el('queue').disabled=true;await request(path,'POST')}catch(error){el('banner').textContent=error.message}finally{await refresh()}}
  el('one').onclick=()=>run('/api/process-one');el('queue').onclick=()=>run('/api/process-queue');el('refresh').onclick=refresh;refresh();setInterval(refresh,5000);
  </script></body></html>`
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

export function startControlPanel(options: {
  store: ScheduleEngineStore
  workerId: string
  predict: ReturnType<typeof createPredictionFunction>
  notify: ReturnType<typeof createPredictionReadyNotifier>
  placeholderEnabled: boolean
  emailConfigured: boolean
  port: number
}) {
  let busy = false
  const logs: string[] = [`${new Date().toISOString()} Control panel started.`]
  const log = (message: string) => { logs.unshift(`${new Date().toISOString()} ${message}`); logs.splice(100) }
  const workerOptions = { store: options.store, workerId: options.workerId, predict: options.predict, notify: options.notify }
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      if (request.method === 'GET' && request.url === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(controlPanelHtml()); return }
      if (request.method === 'GET' && request.url === '/health') { json(response, 200, { ok: true, busy }); return }
      if (request.method === 'GET' && request.url === '/api/status') {
        const jobs = await options.store.listJobs()
        const counts = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 }
        for (const job of jobs) counts[job.status] += 1
        json(response, 200, { busy, workerId: options.workerId, placeholderEnabled: options.placeholderEnabled, emailConfigured: options.emailConfigured, counts, jobs, logs }); return
      }
      if (request.method === 'POST' && (request.url === '/api/process-one' || request.url === '/api/process-queue')) {
        if (busy) { json(response, 409, { error: 'The worker is already processing.' }); return }
        busy = true
        try {
          if (request.url.endsWith('process-one')) { const outcome = await processNextJob(workerOptions); log(`Process one: ${outcome}.`); json(response, 200, { outcome }) }
          else { const summary = await processFullQueue(workerOptions); log(`Queue finished: ${summary.completed} completed, ${summary.failed} failed.`); json(response, 200, summary) }
        } finally { busy = false }
        return
      }
      json(response, 404, { error: 'Not found.' })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Control panel request failed.'
      log(`Error: ${message}`); json(response, 500, { error: message })
    }
  }
  const server = createServer((request, response) => { void handler(request, response) })
  server.listen(options.port, '127.0.0.1', () => console.log(`Schedule Engine control panel: http://127.0.0.1:${options.port}`))
  return server
}

function main() {
  const url = requiredEnvironment('SUPABASE_URL')
  const store = createScheduleEngineStore(url, requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'))
  const workerId = process.env.SCHEDULE_ENGINE_WORKER_ID?.trim() || `laptop-${crypto.randomUUID()}`
  const placeholderEnabled = developmentPlaceholderAllowed(url, process.env.SCHEDULE_ENGINE_ENABLE_PLACEHOLDER, process.env.NODE_ENV)
  const smtpConfig = smtpNotifierConfigFromEnvironment()
  startControlPanel({ store, workerId, placeholderEnabled, emailConfigured: smtpConfigured(smtpConfig),
    predict: createPredictionFunction({ allowDevelopmentPlaceholder: placeholderEnabled }),
    notify: createPredictionReadyNotifier(smtpConfig), port: Number(process.env.SCHEDULE_ENGINE_GUI_PORT || 4174) })
}

if (process.env.NODE_ENV !== 'test') main()
