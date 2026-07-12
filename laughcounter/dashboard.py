"""A tiny, dependency-free local web dashboard with a feedback loop.

Uses only :mod:`http.server` from the standard library. It serves one
self-contained HTML page plus a small JSON API:

* ``GET  /api/stats``          — the numbers the page renders.
* ``POST /api/mark``           — "I just laughed" (body: ``{"who": "me"|"guest"}``).
* ``POST /api/label``          — relabel a laugh (body: ``{"id": N, "action": ...}``
  where action is ``reject`` / ``confirm`` / ``me`` / ``guest``).

Open it on your phone (it's on your home wifi at the Mac mini's address) and the
big button becomes a one-tap way to say "I laughed" from the couch — which either
confirms a detection or logs the miss as training data.

Each request opens its own SQLite connection, so the server is safe to run in a
background thread while the listener writes new events. It binds to ``127.0.0.1``
by default; pass ``--host 0.0.0.0`` to reach it from your phone.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import stats
from .events import utcnow
from .storage import apply_label, apply_mark, read_rows


def build_stats(db_path: str | Path) -> dict:
    """Compute the dashboard payload from the database at ``db_path``."""
    rows = read_rows(db_path)
    return stats.compute(rows, now=utcnow())


def make_server(db_path: str | Path, host: str = "127.0.0.1", port: int = 8422):
    """Create (but do not start) a :class:`ThreadingHTTPServer` for the dashboard."""
    db_path = str(db_path)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - http.server API
            path = self.path.split("?", 1)[0]
            if path in ("/", "/index.html"):
                self._send(200, "text/html; charset=utf-8", _PAGE.encode("utf-8"))
            elif path == "/api/stats":
                payload = json.dumps(build_stats(db_path)).encode("utf-8")
                self._send(200, "application/json", payload)
            else:
                self._send(404, "text/plain; charset=utf-8", b"not found")

        def do_POST(self):  # noqa: N802 - http.server API
            path = self.path.split("?", 1)[0]
            data = self._read_json()
            if data is None:
                return
            try:
                if path == "/api/mark":
                    who = data.get("who", "me")
                    if who not in ("me", "guest"):
                        who = "me"
                    result = apply_mark(db_path, who=who)
                elif path == "/api/label":
                    rowid = int(data["id"])
                    action = str(data["action"])
                    result = apply_label(db_path, rowid, action)
                else:
                    self._send(404, "application/json", b'{"error":"not found"}')
                    return
            except (KeyError, TypeError, ValueError):
                self._send(400, "application/json", b'{"error":"bad request"}')
                return
            self._send(200, "application/json", json.dumps(result).encode("utf-8"))

        def _read_json(self):
            try:
                length = int(self.headers.get("Content-Length", 0) or 0)
            except ValueError:
                length = 0
            body = self.rfile.read(length) if length else b""
            try:
                return json.loads(body or b"{}")
            except json.JSONDecodeError:
                self._send(400, "application/json", b'{"error":"bad json"}')
                return None

        def _send(self, code: int, content_type: str, body: bytes):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):  # silence per-request stderr logging
            pass

    return ThreadingHTTPServer((host, port), Handler)


def serve(db_path: str | Path, host: str = "127.0.0.1", port: int = 8422) -> None:
    """Run the dashboard until interrupted."""
    server = make_server(db_path, host, port)
    print(f"LaughCounter dashboard → http://{host}:{port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:  # pragma: no cover - interactive
        pass
    finally:
        server.server_close()


# All dynamic values reach the page via textContent / numeric attributes — never
# interpolated as HTML — so database strings (e.g. source) can't inject markup.
_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LaughCounter</title>
<style>
  :root {
    --bg:#f7f7fb; --card:#ffffff; --ink:#1d1d27; --muted:#6b6b7b;
    --accent:#ffb703; --accent2:#fb8500; --bar:#8ecae6; --grid:#e6e6ef;
    --me:#2a9d8f; --guest:#e76f51;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#14141c; --card:#1e1e2a; --ink:#f0f0f5; --muted:#9a9aad;
      --accent:#ffd166; --accent2:#ffb703; --bar:#219ebc; --grid:#2a2a3a;
      --me:#4cc9b0; --guest:#f4a261;
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         background:var(--bg); color:var(--ink); }
  header { padding:24px 20px 6px; text-align:center; }
  h1 { margin:0; font-size:1.7rem; letter-spacing:.5px; }
  .sub { color:var(--muted); font-size:.9rem; margin-top:4px; }
  main { max-width:880px; margin:0 auto; padding:16px; }
  .laughbtn { display:block; width:100%; max-width:420px; margin:14px auto 4px;
    padding:18px; font-size:1.25rem; font-weight:700; color:#1d1d27; cursor:pointer;
    border:none; border-radius:16px; background:linear-gradient(90deg,var(--accent),var(--accent2));
    box-shadow:0 4px 14px rgba(251,133,0,.35); transition:transform .08s; }
  .laughbtn:active { transform:scale(.97); }
  .hint { text-align:center; color:var(--muted); font-size:.78rem; margin-bottom:14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
          gap:14px; margin-bottom:18px; }
  .card { background:var(--card); border-radius:14px; padding:18px;
          box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .stat .n { font-size:2rem; font-weight:700; line-height:1;
             background:linear-gradient(90deg,var(--accent),var(--accent2));
             -webkit-background-clip:text; background-clip:text; color:transparent; }
  .stat .l { color:var(--muted); font-size:.78rem; text-transform:uppercase;
             letter-spacing:.5px; margin-top:6px; }
  .card h2 { margin:0 0 12px; font-size:1rem; }
  svg { width:100%; height:auto; display:block; }
  .bar { fill:var(--bar); } .bar:hover { fill:var(--accent2); }
  .axis { fill:var(--muted); font-size:9px; }
  table { width:100%; border-collapse:collapse; font-size:.88rem; }
  td, th { padding:6px 6px; text-align:left; border-bottom:1px solid var(--grid); }
  th { color:var(--muted); font-weight:600; font-size:.72rem; text-transform:uppercase; }
  .who { font-weight:600; } .who.me { color:var(--me); } .who.guest { color:var(--guest); }
  .tag { font-size:.66rem; padding:1px 6px; border-radius:8px; background:var(--grid);
         color:var(--muted); text-transform:uppercase; letter-spacing:.4px; }
  .act { border:1px solid var(--grid); background:transparent; color:var(--muted);
    border-radius:8px; padding:2px 7px; font-size:.72rem; cursor:pointer; margin-right:3px; }
  .act:hover { color:var(--ink); border-color:var(--accent2); }
  .empty { color:var(--muted); text-align:center; padding:24px; }
  #toast { position:fixed; left:50%; bottom:26px; transform:translateX(-50%) translateY(80px);
    background:var(--me); color:#fff; padding:12px 22px; border-radius:24px; font-weight:600;
    box-shadow:0 6px 20px rgba(0,0,0,.25); opacity:0; transition:all .3s; pointer-events:none; }
  #toast.show { transform:translateX(-50%) translateY(0); opacity:1; }
  footer { text-align:center; color:var(--muted); font-size:.75rem; padding:20px; }
</style>
</head>
<body>
<header>
  <h1>😂 LaughCounter</h1>
  <div class="sub" id="sub">loading…</div>
</header>
<main>
  <button class="laughbtn" id="ilaughed">😂 I just laughed</button>
  <div class="hint">Tap when you laugh and didn't get a blip — it confirms a catch or logs the miss.</div>
  <div class="grid" id="stats"></div>
  <div class="card"><h2>Who's laughing</h2><div id="who"></div></div>
  <div class="card"><h2>Laughs by day</h2><div id="daychart"></div></div>
  <div class="card"><h2>When you laugh (hour of day)</h2><div id="hourchart"></div></div>
  <div class="card"><h2>Recent laughs</h2><div id="recent"></div></div>
</main>
<div id="toast"></div>
<footer>Runs entirely on your Mac mini. Audio stays local; only short laugh clips are kept, and only to improve accuracy.</footer>
<script>
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs={}, text){ const e=document.createElementNS(SVGNS,tag);
  for(const k in attrs) e.setAttribute(k, attrs[k]); if(text!=null) e.textContent=text; return e; }
function fmtDur(s){ if(s>=60){const m=Math.floor(s/60); return m+"m "+Math.round(s%60)+"s";} return s.toFixed(1)+"s"; }

let toastTimer;
function toast(msg){ const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove("show"), 2200); }

async function post(url, body){
  const r = await fetch(url, {method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify(body||{})});
  return r.json();
}

function statCard(n, label){ const c=document.createElement("div"); c.className="card stat";
  const a=document.createElement("div"); a.className="n"; a.textContent=n;
  const b=document.createElement("div"); b.className="l"; b.textContent=label;
  c.append(a,b); return c; }

function barChart(mount, items, labelFn){
  mount.textContent="";
  const W=800, H=200, pad=24, n=items.length;
  const max=Math.max(1, ...items.map(d=>d.count));
  const bw=(W-pad*2)/n;
  const svg=svgEl("svg",{viewBox:`0 0 ${W} ${H}`,preserveAspectRatio:"none"});
  for(let i=0;i<n;i++){
    const h=(H-pad*2)*(items[i].count/max);
    svg.appendChild(svgEl("rect",{class:"bar",x:pad+i*bw+2,y:H-pad-h,
      width:Math.max(1,bw-4),height:h,rx:2}));
    if(n<=24 || i%Math.ceil(n/12)===0)
      svg.appendChild(svgEl("text",{class:"axis",x:pad+i*bw+bw/2,y:H-8,"text-anchor":"middle"}, labelFn(items[i],i)));
    if(items[i].count>0)
      svg.appendChild(svgEl("text",{class:"axis",x:pad+i*bw+bw/2,y:H-pad-h-4,"text-anchor":"middle"}, items[i].count));
  }
  mount.appendChild(svg);
}

function renderWho(mount, s){
  mount.textContent="";
  const row=document.createElement("div"); row.className="grid";
  const items=[["me","you"],["guest","guests"],["unknown","unattributed"]];
  for(const [k,lbl] of items){
    const c=document.createElement("div"); c.className="card stat";
    const a=document.createElement("div"); a.className="n"; a.textContent=s.by_speaker[k]||0;
    if(k!=="unknown") a.style.color = k==="me" ? "var(--me)" : "var(--guest)", a.style.webkitTextFillColor="initial", a.style.background="none";
    const b=document.createElement("div"); b.className="l"; b.textContent=lbl;
    c.append(a,b); row.appendChild(c);
  }
  mount.appendChild(row);
  const h=s.by_label;
  const health=document.createElement("div"); health.className="hint"; health.style.marginTop="10px";
  health.textContent = `detection: ${h.auto} unreviewed · ${h.confirmed} confirmed · ${h.missed} you flagged as missed · ${h.rejected} rejected`;
  mount.appendChild(health);
}

function actButton(label, onClick){ const b=document.createElement("button"); b.className="act";
  b.textContent=label; b.onclick=onClick; return b; }

function renderRecent(mount, recent){
  mount.textContent="";
  if(!recent.length){ const p=document.createElement("div"); p.className="empty";
    p.textContent="No laughs recorded yet. Go find something funny!"; mount.appendChild(p); return; }
  const t=document.createElement("table");
  const thead=document.createElement("tr");
  ["When","Length","Who","Status","Fix"].forEach(h=>{const th=document.createElement("th"); th.textContent=h; thead.appendChild(th);});
  t.appendChild(thead);
  recent.forEach(r=>{ const tr=document.createElement("tr");
    const when=document.createElement("td"); when.textContent=new Date(r.start_ts*1000).toLocaleString(); tr.appendChild(when);
    const dur=document.createElement("td"); dur.textContent=fmtDur(r.duration); tr.appendChild(dur);
    const who=document.createElement("td"); const ws=document.createElement("span");
      ws.className="who "+r.speaker; ws.textContent=r.speaker; who.appendChild(ws); tr.appendChild(who);
    const st=document.createElement("td"); const tag=document.createElement("span");
      tag.className="tag"; tag.textContent=r.label; st.appendChild(tag); tr.appendChild(st);
    const fix=document.createElement("td");
    if(r.id!=null){
      fix.appendChild(actButton("not a laugh", ()=>label(r.id,"reject")));
      fix.appendChild(actButton("me", ()=>label(r.id,"me")));
      fix.appendChild(actButton("guest", ()=>label(r.id,"guest")));
    }
    tr.appendChild(fix);
    t.appendChild(tr); });
  mount.appendChild(t);
}

async function label(id, action){ await post("/api/label", {id, action});
  toast(action==="reject"?"Marked as not a laugh":"Updated"); refresh(); }

async function refresh(){
  let d; try { d = await (await fetch("/api/stats")).json(); }
  catch(e){ document.getElementById("sub").textContent="could not reach server"; return; }
  document.getElementById("sub").textContent =
    d.total+" laughs all-time · "+fmtDur(d.total_duration)+" of laughter";
  const s=document.getElementById("stats"); s.textContent="";
  s.append(
    statCard(d.today, "today"),
    statCard(d.week, "this week"),
    statCard(d.current_streak+"🔥", "day streak"),
    statCard(fmtDur(d.longest_laugh), "longest laugh"),
    statCard(d.busiest_hour==null?"—":(d.busiest_hour+":00"), "busiest hour"),
  );
  renderWho(document.getElementById("who"), d);
  barChart(document.getElementById("daychart"), d.per_day, (it)=>it.date.slice(5));
  barChart(document.getElementById("hourchart"), d.per_hour.map((c,h)=>({count:c,hour:h})), (it)=>it.hour);
  renderRecent(document.getElementById("recent"), d.recent);
}

document.getElementById("ilaughed").onclick = async ()=>{
  const res = await post("/api/mark", {who:"me"});
  toast(res.action==="confirmed" ? "Nice — confirmed that catch! 🎉" : "Logged the one we missed 🙏");
  refresh();
};
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>
"""
