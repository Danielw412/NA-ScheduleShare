import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createPredictionReadyNotifier, smtpConfigured, smtpNotifierConfigFromEnvironment } from './notifier.js'
import { maxCollateralChangesFromEnvironment } from './prediction-engine.js'
import { createSchedulePolicyPredictionFunction } from './schedule-policy.js'
import { createScheduleEngineStore } from './supabase-store.js'
import type { ScheduleEngineStore } from './types.js'
import { processFullQueue, processNextJob } from './worker.js'

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function enabledFromEnvironment(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? '')
}

export function controlPanelHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Schedule Engine worker</title><style>
  :root{font-family:Inter,system-ui,sans-serif;color:#151515;background:#f4f4f2}*{box-sizing:border-box}body{margin:0}header{padding:22px 5vw;background:#101010;color:#fff;border-bottom:5px solid #f4b41a}header h1{margin:0;font-size:24px}header p{margin:5px 0 0;color:#bbb}main{width:min(1200px,92vw);margin:24px auto 40px}.toolbar,.stats,.job,.auto-control{background:#fff;border:1px solid #ccc;border-radius:9px}.toolbar{padding:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}button{min-height:42px;padding:10px 14px;border:1px solid #111;border-radius:7px;background:#111;color:#fff;font:750 13px Inter,system-ui,sans-serif;cursor:pointer}button.secondary{background:#fff;color:#111}button:disabled{opacity:.45;cursor:not-allowed}.auto-control{margin:14px 0 0;padding:14px 16px;display:flex;align-items:center;gap:12px;cursor:pointer}.auto-control input{position:absolute;opacity:0}.switch-track{width:44px;height:24px;flex:0 0 auto;padding:3px;border-radius:999px;background:#aaa;transition:background .15s}.switch-track:after{content:"";display:block;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0004;transition:transform .15s}.auto-control input:checked+.switch-track{background:#278b45}.auto-control input:checked+.switch-track:after{transform:translateX(20px)}.auto-copy{display:grid;gap:2px}.auto-copy strong{font-size:13px}.auto-copy small{color:#666;font-size:11px}.stats{display:grid;grid-template-columns:repeat(5,1fr);margin-top:14px;overflow:hidden}.stat{padding:16px;border-right:1px solid #ddd}.stat:last-child{border:0}.stat strong{display:block;font-size:26px}.stat span,.muted{font-size:12px;color:#666}.banner{padding:12px 14px;margin:14px 0;border-left:4px solid #f4b41a;border-radius:0 7px 7px 0;background:#fff7dd;font-size:13px}.jobs{display:grid;gap:10px}.job{overflow:hidden}.job summary{padding:14px;display:grid;grid-template-columns:12px 110px minmax(0,1fr) auto;gap:10px;align-items:center;cursor:pointer}.job summary span{min-width:0;overflow-wrap:anywhere}.dot{width:9px;height:9px;border-radius:50%;background:#888}.queued{background:#d28a00}.processing{background:#2878b5}.completed{background:#278b45}.failed{background:#c63535}.body{padding:15px;border-top:1px solid #ddd}.body p{margin:5px 0;overflow-wrap:anywhere}.body details{margin-top:12px}.body details summary{padding:0;display:list-item;font-weight:750}.debug{white-space:pre-wrap;overflow:auto;padding:12px;border-radius:7px;background:#161616;color:#d6f5d6;font:12px ui-monospace,monospace}.log{max-height:220px;overflow:auto;margin-top:16px;border-radius:8px}.log div{padding:7px 10px;border-bottom:1px solid #333}@media(max-width:700px){header{padding-inline:4vw}main{width:min(94vw,1200px)}.stats{grid-template-columns:1fr 1fr}.stat{border-bottom:1px solid #ddd}.job summary{grid-template-columns:12px 1fr}.job summary>*:nth-child(n+3){grid-column:2}.toolbar button{flex:1 1 140px}.auto-control{align-items:flex-start}}</style></head>
  <body><header><h1>Schedule Engine · Laptop worker</h1><p>Local queue control and diagnostics</p></header><main><div class="toolbar"><button id="one">Process one job</button><button id="queue">Process full queue</button><button class="secondary" id="refresh">Refresh</button><span id="worker" class="muted"></span></div><label class="auto-control"><input id="auto" type="checkbox"><span class="switch-track" aria-hidden="true"></span><span class="auto-copy"><strong>Automatically process new requests</strong><small>Checks the queue while this control panel is running.</small></span></label><div id="banner" class="banner">Connecting…</div><section id="stats" class="stats"></section><section id="jobs" class="jobs"></section><section class="debug log" id="log"></section></main><script>
  const el=id=>document.getElementById(id);let busy=false,lastJobsMarkup='',lastLogsMarkup='';
  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  async function request(path,method='GET'){const response=await fetch(path,{method});const body=await response.json();if(!response.ok)throw new Error(body.error||'Request failed');return body}
  function stat(label,value){return '<div class="stat"><strong>'+value+'</strong><span>'+label+'</span></div>'}
  function renderJobs(jobs){const jobsEl=el('jobs'),hadMarkup=lastJobsMarkup!=='';const openJobs=new Set([...jobsEl.querySelectorAll(':scope > details[open]')].map(item=>item.dataset.jobId));const openDebug=new Set([...jobsEl.querySelectorAll('.body > details[open]')].map(item=>item.dataset.debugId));const markup=jobs.map(job=>'<details class="job" data-job-id="'+esc(job.id)+'" '+(!hadMarkup&&['queued','processing'].includes(job.status)?'open':'')+'><summary><i class="dot '+esc(job.status)+'"></i><strong>'+esc(job.status)+'</strong><span>'+esc(job.user_name)+' · '+esc(job.source_courses.map(r=>r.course_name).join(' + '))+' → '+esc(job.replacement_courses.map(r=>r.course_name).join(' + '))+'</span><small>'+esc(new Date(job.created_at).toLocaleString())+'</small></summary><div class="body"><p><b>ID:</b> '+esc(job.id)+'</p><p><b>Worker:</b> '+esc(job.worker_id||'unclaimed')+' · <b>Attempts:</b> '+esc(job.attempt_count)+'</p><p><b>Result:</b> '+esc(job.no_valid_schedule_reason||job.error_message||job.notification_error||'no error')+'</p><details data-debug-id="'+esc(job.id)+'"><summary>Raw debug data</summary><pre class="debug">'+esc(JSON.stringify(job,null,2))+'</pre></details></div></details>').join('')||'<p class="banner">The queue is empty.</p>';if(markup===lastJobsMarkup)return;jobsEl.innerHTML=markup;lastJobsMarkup=markup;if(hadMarkup){jobsEl.querySelectorAll(':scope > details').forEach(item=>{item.open=openJobs.has(item.dataset.jobId)});jobsEl.querySelectorAll('.body > details').forEach(item=>{item.open=openDebug.has(item.dataset.debugId)})}}
  function renderLogs(lines){const markup=lines.map(line=>'<div>'+esc(line)+'</div>').join('');if(markup===lastLogsMarkup)return;const logEl=el('log'),scrollTop=logEl.scrollTop;logEl.innerHTML=markup;logEl.scrollTop=scrollTop;lastLogsMarkup=markup}
  async function refresh(){try{const data=await request('/api/status');busy=data.busy;el('one').disabled=busy;el('queue').disabled=busy;el('auto').checked=data.autoProcessing;el('worker').textContent='Worker: '+data.workerId;el('banner').textContent=(data.autoProcessing?'Automatic processing is on':'Manual processing mode')+' · Prediction engine ready · displacement limit: '+data.maxCollateralChanges+' collateral course changes · Email: '+(data.emailConfigured?'configured':'not configured')+'.';const counts=data.counts;el('stats').innerHTML=stat('Queued',counts.queued)+stat('Processing',counts.processing)+stat('Completed',counts.completed)+stat('Failed',counts.failed)+stat('Cancelled',counts.cancelled);renderJobs(data.jobs);renderLogs(data.logs)}catch(error){el('banner').textContent=error.message}}
  async function run(path){try{busy=true;el('one').disabled=true;el('queue').disabled=true;await request(path,'POST')}catch(error){el('banner').textContent=error.message}finally{await refresh()}}
  el('one').onclick=()=>run('/api/process-one');el('queue').onclick=()=>run('/api/process-queue');el('refresh').onclick=refresh;el('auto').onchange=async event=>{const input=event.currentTarget;input.disabled=true;try{await request('/api/auto-processing/'+(input.checked?'enable':'disable'),'POST');await refresh()}catch(error){input.checked=!input.checked;el('banner').textContent=error.message}finally{input.disabled=false}};refresh();setInterval(refresh,5000);
  </script></body></html>`
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

export function startControlPanel(options: {
  store: ScheduleEngineStore
  workerId: string
  predict: ReturnType<typeof createSchedulePolicyPredictionFunction>
  notify: ReturnType<typeof createPredictionReadyNotifier>
  maxCollateralChanges: number
  emailConfigured: boolean
  port: number
  autoProcessInitially?: boolean
  autoProcessIntervalMs?: number
}) {
  let busy = false
  let autoProcessing = options.autoProcessInitially ?? false
  const logs: string[] = [`${new Date().toISOString()} Control panel started.`]
  const log = (message: string) => { logs.unshift(`${new Date().toISOString()} ${message}`); logs.splice(100) }
  const workerOptions = { store: options.store, workerId: options.workerId, predict: options.predict, notify: options.notify }

  const runAutomaticQueue = async () => {
    if (!autoProcessing || busy) return
    busy = true
    let completed = 0
    let failed = 0
    try {
      while (autoProcessing) {
        const outcome = await processNextJob(workerOptions)
        if (outcome === 'empty') break
        if (outcome === 'completed') completed += 1
        else failed += 1
      }
      if (completed > 0 || failed > 0) log(`Automatic queue run: ${completed} completed, ${failed} failed.`)
    } catch (caught) {
      log(`Automatic processing error: ${caught instanceof Error ? caught.message : 'Unknown error.'}`)
    } finally {
      busy = false
    }
  }

  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      if (request.method === 'GET' && request.url === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(controlPanelHtml()); return }
      if (request.method === 'GET' && request.url === '/health') { json(response, 200, { ok: true, busy, autoProcessing }); return }
      if (request.method === 'GET' && request.url === '/api/status') {
        const jobs = await options.store.listJobs()
        const counts = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 }
        for (const job of jobs) counts[job.status] += 1
        json(response, 200, { busy, autoProcessing, workerId: options.workerId, maxCollateralChanges: options.maxCollateralChanges, emailConfigured: options.emailConfigured, counts, jobs, logs }); return
      }
      if (request.method === 'POST' && (request.url === '/api/auto-processing/enable' || request.url === '/api/auto-processing/disable')) {
        autoProcessing = request.url.endsWith('/enable')
        log(`Automatic processing ${autoProcessing ? 'enabled' : 'disabled'}.`)
        json(response, 200, { autoProcessing })
        if (autoProcessing) setTimeout(() => { void runAutomaticQueue() }, 0)
        return
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
  const autoTimer = setInterval(() => { void runAutomaticQueue() }, options.autoProcessIntervalMs ?? 3000)
  server.on('close', () => clearInterval(autoTimer))
  server.listen(options.port, '127.0.0.1', () => console.log(`Schedule Engine control panel: http://127.0.0.1:${options.port}`))
  if (autoProcessing) setTimeout(() => { void runAutomaticQueue() }, 0)
  return server
}

function main() {
  const url = requiredEnvironment('SUPABASE_URL')
  const store = createScheduleEngineStore(url, requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'))
  const workerId = process.env.SCHEDULE_ENGINE_WORKER_ID?.trim() || `laptop-${crypto.randomUUID()}`
  const maxCollateralChanges = maxCollateralChangesFromEnvironment(process.env.SCHEDULE_ENGINE_MAX_COLLATERAL_CHANGES)
  const smtpConfig = smtpNotifierConfigFromEnvironment()
  startControlPanel({ store, workerId, maxCollateralChanges, emailConfigured: smtpConfigured(smtpConfig),
    predict: createSchedulePolicyPredictionFunction({ maxCollateralChanges }),
    notify: createPredictionReadyNotifier(smtpConfig), port: Number(process.env.SCHEDULE_ENGINE_GUI_PORT || 4174),
    autoProcessInitially: enabledFromEnvironment(process.env.SCHEDULE_ENGINE_AUTO_PROCESS) })
}

if (process.env.NODE_ENV !== 'test') main()