import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./lib/types";

import keysRoutes from "./routes/keys";
import parseRoutes from "./routes/parse";
import billingRoutes from "./routes/billing";

const app = new Hono<{ Bindings: Env }>();

/* ── CORS ──────────────────────────────────────────────── */
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

/* ── Security headers ──────────────────────────────────── */
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
});

/* ── Health check ──────────────────────────────────────── */
app.get("/health", (c) =>
  c.json({ status: "ok", service: c.env.APP_NAME || "PDF→JSON API" }),
);

/* ── Mount routes ──────────────────────────────────────── */
app.route("/", keysRoutes);
app.route("/", parseRoutes);
app.route("/", billingRoutes);

/* ── Landing page ──────────────────────────────────────── */
app.get("/", (c) => {
  return c.html(LANDING_HTML);
});

export default app;

// ─────────────────────────────────────────────────────────
// Landing page (embedded)
// ─────────────────────────────────────────────────────────
const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PDF to JSON — Parse any invoice or receipt instantly</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0e0e11; --surface: #18181c; --border: #2a2a30;
      --accent: #7c6af7; --green: #22c55e; --red: #ef4444;
      --text: #f0f0f4; --muted: #8b8b9a; --code-bg: #111115; --radius: 14px;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
    a { color: var(--accent); text-decoration: none; }
    nav { display: flex; align-items: center; justify-content: space-between; padding: 18px 40px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(14,14,17,.94); backdrop-filter: blur(12px); z-index: 100; }
    .logo { font-weight: 800; font-size: 18px; letter-spacing: -.5px; }
    .logo span { color: var(--accent); }
    .nav-r { display: flex; gap: 20px; align-items: center; font-size: 14px; }
    .nav-r a { color: var(--muted); }
    .nav-r a:hover { color: var(--text); }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: .15s; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: #6b5aed; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-outline:hover { border-color: var(--accent); color: var(--accent); }
    .btn:disabled { opacity: .45; cursor: not-allowed; }
    .hero { text-align: center; padding: 72px 20px 56px; max-width: 700px; margin: 0 auto; }
    .badge { display: inline-block; background: #1e1b4b; color: #a78bfa; border: 1px solid #3730a3; border-radius: 99px; padding: 4px 14px; font-size: 11px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; margin-bottom: 22px; }
    h1 { font-size: clamp(34px, 6vw, 58px); font-weight: 800; letter-spacing: -2px; line-height: 1.08; margin-bottom: 18px; }
    h1 em { color: var(--accent); font-style: normal; }
    .hero-sub { font-size: 18px; color: var(--muted); margin-bottom: 48px; }
    .upload-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); max-width: 640px; margin: 0 auto; overflow: hidden; }
    .upload-card-head { padding: 18px 26px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 6px var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.35} }
    .upload-body { padding: 28px; }
    .drop-zone { border: 2px dashed var(--border); border-radius: 12px; padding: 56px 20px; text-align: center; cursor: pointer; transition: border-color .15s, background .15s; position: relative; }
    .drop-zone:hover, .drop-zone.drag { border-color: var(--accent); background: #15131f; }
    .drop-zone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
    .drop-icon { font-size: 40px; margin-bottom: 12px; }
    .drop-label { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
    .drop-sub { font-size: 13px; color: var(--muted); }
    .chosen-file { margin-top: 10px; font-size: 14px; color: var(--accent); font-weight: 600; }
    .parse-btn { width: 100%; margin-top: 18px; padding: 14px; font-size: 16px; border-radius: 10px; justify-content: center; }
    .result-wrap { margin-top: 20px; display: none; }
    .result-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
    .result-label .tag { background: var(--green); color: #000; border-radius: 4px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .result-label .tag.err { background: var(--red); color: #fff; }
    pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px; padding: 18px; font-family: "SF Mono","Fira Code",monospace; font-size: 12px; color: #86efac; max-height: 360px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
    pre.err { color: #fca5a5; border-color: var(--red); }
    .spinner { display: none; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; width: 22px; height: 22px; animation: spin .7s linear infinite; margin: 18px auto 0; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .demo-note { margin-top: 14px; text-align: center; font-size: 12px; color: var(--muted); }
    .demo-note a { color: var(--accent); }
    section { padding: 80px 20px; }
    .container { max-width: 1060px; margin: 0 auto; }
    .sec-label { text-align: center; color: var(--accent); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px; }
    h2 { text-align: center; font-size: clamp(24px, 4vw, 38px); font-weight: 800; letter-spacing: -1px; margin-bottom: 14px; }
    .sub { text-align: center; color: var(--muted); font-size: 16px; margin-bottom: 52px; }
    .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; }
    .step { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 26px; }
    .step-n { width: 34px; height: 34px; background: var(--accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; margin-bottom: 14px; }
    .step h3 { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
    .step p { font-size: 13px; color: var(--muted); line-height: 1.55; }
    .step code { background: var(--code-bg); color: var(--accent); padding: 1px 6px; border-radius: 4px; font-size: 11px; }
    .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 18px; }
    .plan { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 26px; position: relative; }
    .plan.pop { border-color: var(--accent); }
    .pop-tag { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--accent); color: #fff; border-radius: 99px; padding: 2px 14px; font-size: 11px; font-weight: 700; letter-spacing: .5px; white-space: nowrap; }
    .plan-name { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; margin-bottom: 10px; }
    .plan-price { font-size: 36px; font-weight: 800; letter-spacing: -1.5px; line-height: 1; margin-bottom: 4px; }
    .plan-price span { font-size: 14px; font-weight: 400; color: var(--muted); }
    .plan-limit { font-size: 13px; color: var(--muted); margin-bottom: 18px; padding-bottom: 18px; border-bottom: 1px solid var(--border); }
    .plan ul { list-style: none; display: flex; flex-direction: column; gap: 9px; margin-bottom: 22px; }
    .plan li { font-size: 13px; display: flex; align-items: center; gap: 7px; }
    .plan li .check { color: var(--green); font-weight: 800; flex-shrink: 0; }
    .plan .btn { width: 100%; justify-content: center; }
    .sec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; }
    .sec-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; }
    .sec-card .icon { font-size: 26px; margin-bottom: 10px; }
    .sec-card h3 { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
    .sec-card p { font-size: 13px; color: var(--muted); line-height: 1.55; }
    .trust-bar { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 32px; }
    .trust-pill { background: #0f1f0f; border: 1px solid #16a34a33; color: #86efac; border-radius: 99px; padding: 6px 16px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
    .trust-pill .dot-g { width: 7px; height: 7px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
    .code-block .c { color: var(--muted); }
    .code-block .s { color: #86efac; }
    .code-block .u { color: #67e8f9; }
    .code-block .o { color: #fde68a; }
    /* Donation banner */
    .donate-banner { background: linear-gradient(135deg, #1a1a2e, #16213e); border: 1px solid var(--border); border-radius: var(--radius); max-width: 640px; margin: 0 auto 40px; padding: 28px; text-align: center; }
    .donate-banner h3 { font-size: 16px; margin-bottom: 8px; }
    .donate-banner p { font-size: 13px; color: var(--muted); margin-bottom: 16px; }
    .donate-row { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; align-items: center; }
    .donate-row a { display: inline-flex; align-items: center; gap: 8px; padding: 10px 22px; border-radius: 10px; font-size: 14px; font-weight: 600; text-decoration: none; transition: .15s; }
    .kofi-btn { background: #ff5e5b; color: #fff; }
    .kofi-btn:hover { background: #e54e4b; }
    .wallet-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .wallet-addr { font-family: "SF Mono","Fira Code",monospace; font-size: 10px; color: var(--muted); word-break: break-all; max-width: 240px; cursor: pointer; }
    .wallet-addr:hover { color: var(--accent); }
    .qr-img { width: 100px; height: 100px; border-radius: 8px; border: 2px solid var(--border); }
    footer { text-align: center; padding: 38px 20px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
    @media (max-width: 600px) {
      nav { padding: 14px 18px; }
      .nav-r a:not(.btn) { display: none; }
      .hero { padding: 50px 16px 36px; }
      section { padding: 56px 16px; }
    }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: var(--code-bg); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  </style>
</head>
<body>
<nav>
  <div class="logo">pdf<span>&rarr;</span>json</div>
  <div class="nav-r">
    <a href="#how-it-works">How it works</a>
    <a href="#security">Security</a>
    <a href="#pricing">Pricing</a>
    <a href="#for-devs">For devs</a>
  </div>
</nav>

<div class="hero">
  <div class="badge">&#10024; no signup &middot; no credit card</div>
  <h1>Drop a PDF.<br/><em>Get clean JSON.</em></h1>
  <p class="hero-sub">Upload any invoice or receipt and see structured data in seconds.</p>
</div>

<div style="padding:0 20px 40px">
  <div class="upload-card">
    <div class="upload-card-head">
      <div class="dot"></div>
      Live demo &mdash; try it right now
    </div>
    <div class="upload-body">
      <div class="drop-zone" id="drop-zone">
        <input type="file" id="file-input" accept=".pdf" />
        <div class="drop-icon">&#128196;</div>
        <div class="drop-label">Drop your PDF here</div>
        <div class="drop-sub">or click to browse &middot; invoices &amp; receipts work great</div>
        <div class="chosen-file" id="chosen-name"></div>
      </div>
      <button class="btn btn-primary parse-btn" id="parse-btn" onclick="runDemo()" disabled>Parse PDF &rarr;</button>
      <div class="spinner" id="spinner"></div>
      <div class="result-wrap" id="result-wrap">
        <div class="result-label"><span>Result</span><span class="tag" id="doc-tag"></span></div>
        <pre id="result-pre"></pre>
      </div>
      <p class="demo-note" id="demo-note">5 free tries per day &middot; no account needed &middot; <a href="#pricing">Need more?</a></p>
    </div>
  </div>
</div>

<!-- DONATION BANNER -->
<div style="padding:0 20px 60px">
  <div class="donate-banner">
    <h3>&#9749; Support this project</h3>
    <p>If this tool saves you time, consider buying me a coffee or sending a small tip.</p>
    <div class="donate-row">
      <a href="https://ko-fi.com/inksky" target="_blank" class="kofi-btn">&#9749; Buy me a coffee</a>
      <div class="wallet-wrap">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=8yQSRrGn9hSUG1n5vTidMWjVpGmBgEvrT8sWTA3WZqY" class="qr-img" alt="USDC Wallet QR" />
        <div class="wallet-addr" onclick="navigator.clipboard.writeText('8yQSRrGn9hSUG1n5vTidMWjVpGmBgEvrT8sWTA3WZqY').then(()=>this.textContent='Copied!')">8yQSRrGn9hSUG1n5vTidMWjVpGmBgEvrT8sWTA3WZqY</div>
        <span style="font-size:11px;color:var(--muted)">USDC on Solana</span>
      </div>
    </div>
  </div>
</div>

<section id="how-it-works" style="border-top:1px solid var(--border)">
  <div class="container">
    <div class="sec-label">Simple by design</div>
    <h2>Zero setup. One endpoint.</h2>
    <p class="sub">No GUI to learn. No templates to draw. No zones to configure.</p>
    <div class="steps">
      <div class="step"><div class="step-n">1</div><h3>Upload a PDF</h3><p>Call <code>POST /parse</code> with your file. Invoices, receipts, contracts &mdash; handled automatically.</p></div>
      <div class="step"><div class="step-n">2</div><h3>An LLM reads it</h3><p>A large language model extracts vendor, invoice number, line items, totals, tax, dates and currency &mdash; from any layout, no templates.</p></div>
      <div class="step"><div class="step-n">3</div><h3>You get JSON</h3><p>Structured data ready to insert directly into your database. No regex, no post-processing, no guessing.</p></div>
    </div>
  </div>
</section>

<section id="security" style="border-top:1px solid var(--border); background: #0a0f0a;">
  <div class="container">
    <div class="sec-label" style="color:#4ade80">Security &amp; privacy</div>
    <h2>Your documents stay yours. Always.</h2>
    <p class="sub">Sensitive financial data deserves serious protection. Here's exactly how we handle it.</p>
    <div class="sec-grid">
      <div class="sec-card"><div class="icon">&#128683;</div><h3>Zero data retention</h3><p>Your PDF is loaded into memory, parsed, then immediately discarded. We never write your document to disk, a database, or any storage system.</p></div>
      <div class="sec-card"><div class="icon">&#128274;</div><h3>TLS-only transport</h3><p>All data in transit is encrypted with TLS 1.2+. Plain HTTP connections are rejected. HSTS headers ensure your browser always connects securely.</p></div>
      <div class="sec-card"><div class="icon">&#129514;</div><h3>In-memory processing</h3><p>Parsing happens entirely in-process. File bytes are explicitly released after the response is sent. No temp files, no caches, no side-channels.</p></div>
      <div class="sec-card"><div class="icon">&#128737;</div><h3>Attack mitigation</h3><p>Rate limiting on every endpoint, strict CORS, security headers (CSP, X-Frame-Options, HSTS), and SSRF protection on URL inputs.</p></div>
      <div class="sec-card"><div class="icon">&#128273;</div><h3>Hashed API keys</h3><p>API keys are SHA-256 hashed before storage. Even in the event of a database breach, raw keys cannot be recovered or replayed.</p></div>
      <div class="sec-card"><div class="icon">&#128065;&#8205;&#128488;&#65039;</div><h3>No logs of your content</h3><p>We log request metadata (timestamp, key tier, page count) but never the contents of your documents. Nothing traceable to your data is stored.</p></div>
    </div>
    <div class="trust-bar">
      <div class="trust-pill"><div class="dot-g"></div> Files never stored</div>
      <div class="trust-pill"><div class="dot-g"></div> TLS encrypted</div>
      <div class="trust-pill"><div class="dot-g"></div> Keys hashed</div>
      <div class="trust-pill"><div class="dot-g"></div> SSRF protected</div>
      <div class="trust-pill"><div class="dot-g"></div> Rate limited</div>
      <div class="trust-pill"><div class="dot-g"></div> No content logs</div>
    </div>
  </div>
</section>

<section id="pricing">
  <div class="container">
    <div class="sec-label">Straightforward</div>
    <h2>Flat monthly pricing</h2>
    <p class="sub">No per-page fees. No templates to maintain. Cancel anytime.</p>
    <div class="plans" id="plans-grid"><p style="text-align:center;color:var(--muted)">Loading&hellip;</p></div>
    <p style="text-align:center;margin-top:26px;font-size:13px;color:var(--muted)">Need more than 20,000 parses? <a href="mailto:hi@inksky.net">Email us</a> for a custom plan.</p>
  </div>
</section>

<section id="for-devs" style="border-top:1px solid var(--border)">
  <div class="container">
    <div class="sec-label">For developers</div>
    <h2>Integrate in minutes</h2>
    <p class="sub">One API key. One endpoint. Works with any language.</p>
    <div style="max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:20px">
      <div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:8px">1 &middot; Get a free API key</p>
        <div class="code-block">curl -X POST <span class="u">/keys</span> \\<br/>&nbsp;&nbsp;-H <span class="s">"Content-Type: application/json"</span> \\<br/>&nbsp;&nbsp;-d <span class="s">'{"email":"you@example.com"}'</span></div>
      </div>
      <div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:8px">2 &middot; Parse any PDF</p>
        <div class="code-block">curl -X POST <span class="u">/parse</span> \\<br/>&nbsp;&nbsp;-H <span class="s">"Authorization: Bearer pdfa_your_key"</span> \\<br/>&nbsp;&nbsp;-F <span class="s">"file=@invoice.pdf"</span></div>
      </div>
      <div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:8px">Response</p>
        <div class="code-block"><span class="o">{</span><br/>&nbsp;&nbsp;<span class="s">"document_type"</span>: <span class="s">"invoice"</span>,<br/>&nbsp;&nbsp;<span class="s">"vendor"</span>: { <span class="s">"name"</span>: <span class="s">"Acme Corp"</span>, ... },<br/>&nbsp;&nbsp;<span class="s">"invoice_number"</span>: <span class="s">"INV-2025-042"</span>,<br/>&nbsp;&nbsp;<span class="s">"total"</span>: 2750.00,<br/>&nbsp;&nbsp;<span class="s">"line_items"</span>: [ ... ],<br/>&nbsp;&nbsp;<span class="s">"currency"</span>: <span class="s">"USD"</span><br/><span class="o">}</span></div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <a href="#pricing" class="btn btn-primary">Get started &rarr;</a>
      </div>
    </div>
  </div>
</section>

<footer>
  pdf&rarr;json API &nbsp;&middot;&nbsp; <a href="#security">Security</a> &nbsp;&middot;&nbsp; <a href="https://ko-fi.com/inksky" target="_blank">Support</a> &nbsp;&middot;&nbsp; <a href="mailto:hi@inksky.net">hi@inksky.net</a>
  <br/><span style="font-size:11px;margin-top:6px;display:block">Your files are never stored. Processed in-memory and discarded immediately.</span>
</footer>

<script>
  var chosenFile = null;
  var zone  = document.getElementById('drop-zone');
  var input = document.getElementById('file-input');
  zone.addEventListener('click', function(e) { if (e.target !== input) input.click(); });
  input.addEventListener('change', function() { if (input.files[0]) setFile(input.files[0]); });
  zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', function() { zone.classList.remove('drag'); });
  zone.addEventListener('drop', function(e) {
    e.preventDefault(); zone.classList.remove('drag');
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });
  function setFile(f) {
    chosenFile = f;
    document.getElementById('chosen-name').textContent = '\\uD83D\\uDCCE ' + f.name;
    var btn = document.getElementById('parse-btn');
    btn.disabled = false;
    btn.textContent = 'Parse "' + f.name + '" \\u2192';
    document.getElementById('result-wrap').style.display = 'none';
  }
  async function runDemo() {
    if (!chosenFile) return;
    var btn=document.getElementById('parse-btn'),spinner=document.getElementById('spinner'),
        wrap=document.getElementById('result-wrap'),pre=document.getElementById('result-pre'),
        tag=document.getElementById('doc-tag');
    btn.disabled=true; btn.textContent='Parsing\\u2026'; spinner.style.display='block'; wrap.style.display='none';
    var form=new FormData(); form.append('file',chosenFile);
    try {
      var res=await fetch('/demo',{method:'POST',body:form});
      var data=await res.json();
      spinner.style.display='none'; wrap.style.display='block';
      if(!res.ok){pre.className='err';pre.textContent=data.detail||JSON.stringify(data,null,2);tag.textContent='Error';tag.className='tag err';}
      else{pre.className='';pre.textContent=JSON.stringify(data.result,null,2);tag.textContent=data.document_type;tag.className='tag';
        var rem=data.demo_remaining_today;
        document.getElementById('demo-note').innerHTML=rem+' free '+(rem===1?'try':'tries')+' left today \\u00B7 <a href="#pricing">Upgrade for more</a>';}
    }catch(e){spinner.style.display='none';wrap.style.display='block';pre.className='err';pre.textContent='Network error: '+e.message;tag.textContent='Error';tag.className='tag err';}
    btn.disabled=false;btn.textContent='Parse "'+chosenFile.name+'" \\u2192';
  }
  async function loadPlans(){
    try{
      var resp=await fetch('/billing/plans');var data=await resp.json();
      var feats={free:['50 parses/month','Invoice & receipt extraction','JSON output'],starter:['500 parses/month','AI-powered extraction','Email support'],pro:['3,000 parses/month','AI-powered extraction','Priority support'],scale:['20,000 parses/month','AI-powered extraction','SLA + priority']};
      document.getElementById('plans-grid').innerHTML=data.plans.map(function(p){
        var fs=(feats[p.tier]||[]).map(function(f){return '<li><span class="check">\\u2713</span> '+f+'</li>';}).join('');
        var cta=p.price==='$0'?'<button class="btn btn-outline" onclick="window.scrollTo({top:0,behavior:\\'smooth\\'})">Try free demo</button>':'<a href="#for-devs" class="btn btn-primary">Get started &rarr;</a>';
        return '<div class="plan '+(p.tier==='starter'?'pop':'')+'\">'+(p.tier==='starter'?'<div class="pop-tag">Most popular</div>':'')+
          '<div class="plan-name">'+p.name+'</div><div class="plan-price">'+p.price+'<span>/mo</span></div>'+
          '<div class="plan-limit">'+p.monthly_limit.toLocaleString()+' parses/month</div><ul>'+fs+'</ul>'+cta+'</div>';
      }).join('');
    }catch(e){console.warn('Could not load plans',e);}
  }
  loadPlans();
</script>
</body>
</html>`;
