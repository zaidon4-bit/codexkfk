import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const defaultSettings = { thinkingLevel: "high", additionalMode: "standard" };
const navItems = [
  ["chat", "Chat", "◌"], ["workspace", "Workspace", "⌘"], ["tasks", "Task plan", "☷"],
  ["sessions", "Sessions", "◷"], ["skills", "Skills & rules", "✳"], ["settings", "Settings", "⚙"]
];

function makeLineDiff(beforeText, afterText) {
  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  if (before.length * after.length > 150000) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (suffix < before.length-prefix && suffix < after.length-prefix && before[before.length-1-suffix] === after[after.length-1-suffix]) suffix++;
    return [
      ...before.slice(0,prefix).map(text=>({kind:"same",text})),
      ...before.slice(prefix,before.length-suffix).map(text=>({kind:"removed",text})),
      ...after.slice(prefix,after.length-suffix).map(text=>({kind:"added",text})),
      ...before.slice(before.length-suffix).map(text=>({kind:"same",text}))
    ];
  }
  const dp = Array.from({length:before.length+1},()=>new Uint16Array(after.length+1));
  for(let i=before.length-1;i>=0;i--) for(let j=after.length-1;j>=0;j--) dp[i][j] = before[i]===after[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j],dp[i][j+1]);
  const lines=[];let i=0,j=0;
  while(i<before.length&&j<after.length){
    if(before[i]===after[j]){lines.push({kind:"same",text:before[i]});i++;j++;}
    else if(dp[i+1][j]>=dp[i][j+1]){lines.push({kind:"removed",text:before[i++]});}
    else{lines.push({kind:"added",text:after[j++]});}
  }
  while(i<before.length)lines.push({kind:"removed",text:before[i++]});
  while(j<after.length)lines.push({kind:"added",text:after[j++]});
  return lines;
}

function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  return fetch(url, { credentials: "same-origin", ...options, headers });
}

function readSettings() {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem("codecraft-settings") || "{}") }; }
  catch { return defaultSettings; }
}

function App() {
  const [page, setPage] = useState("chat");
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [account, setAccount] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(readSettings);
  const [lastMeta, setLastMeta] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    apiFetch("/api/health").then(r => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
    apiFetch("/api/auth/me").then(async r => { if (!r.ok) throw new Error("Not signed in"); return r.json(); })
      .then(data => setAuthUser(data.user)).catch(() => setAuthUser(null)).finally(() => setAuthLoading(false));
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);
  useEffect(() => {
    if (!authUser) { setAccount(null); return; }
    apiFetch("/api/account").then(r => r.ok ? r.json() : null).then(data => {
      setAccount(data);
      if (data) setHealth(h => ({ ...(h || {}), aiConfigured: data.apiConfigured, modelLabel: data.model || "API not assigned" }));
    }).catch(() => setAccount(null));
  }, [authUser]);
  useEffect(() => { localStorage.setItem("codecraft-settings", JSON.stringify(settings)); }, [settings]);

  async function sendMessage(event) {
    event?.preventDefault?.();
    const content = draft.trim();
    if (!content || busy || pendingApproval) return;
    const next = [...messages, { role: "user", content }];
    setMessages(next); setDraft(""); setBusy(true); setError(""); setLastMeta(null); setPendingApproval(null);
    try {
      const response = await apiFetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next, settings }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      if (data.pendingApproval) {
        setPendingApproval(data.pendingApproval);
        const partial = data.partialReply || "The agent requested an action that needs your approval.";
        setMessages([...next, { role: "assistant", content: partial, model: data.model, usage: data.usage, toolEvents: data.toolEvents || [] }]);
        setLastMeta({ elapsedMs: data.elapsedMs, usage: data.usage, model: data.model, appliedSettings: data.appliedSettings, toolEvents: data.toolEvents || [] });
      } else {
        setMessages([...next, { role: "assistant", content: data.reply || "(Empty response)", model: data.model, usage: data.usage, toolEvents: data.toolEvents || [] }]);
        setLastMeta({ elapsedMs: data.elapsedMs, usage: data.usage, model: data.model, appliedSettings: data.appliedSettings, toolEvents: data.toolEvents || [] });
      }
    } catch (err) { setError(err.message || "Something went wrong."); }
    finally { setBusy(false); }
  }

  async function decideAgentAction(approve) {
    if (!pendingApproval || busy) return;
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/agent/continue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: pendingApproval.runId, approve }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      if (data.pendingApproval) {
        setPendingApproval(data.pendingApproval);
      } else {
        setPendingApproval(null);
        setMessages(current => [...current, { role: "assistant", content: data.reply || (approve ? "Approved action completed." : "Action rejected. I will continue without it."), model: data.model, usage: data.usage, toolEvents: data.toolEvents || [] }]);
        setLastMeta({ elapsedMs: data.elapsedMs, usage: data.usage, model: data.model, appliedSettings: data.appliedSettings, toolEvents: data.toolEvents || [] });
      }
    } catch (err) { setError(err.message || "Could not continue the agent request."); }
    finally { setBusy(false); }
  }

  function freshChat() { setMessages([]); setError(""); setLastMeta(null); setPendingApproval(null); setPage("chat"); }
  async function saveSession() {
    if (!messages.length) return setError("Send at least one message before saving a session.");
    try {
      const r = await apiFetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error || "Could not save session.");
      setError(""); alert(`Session saved: ${data.session.title}`);
    } catch (e) { setError(e.message); }
  }

  async function handleLogout() {
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch { /* clear client state regardless */ }
    setAuthUser(null); setAccount(null); setMessages([]); setPage("chat");
  }
  if (authLoading) return <div className="auth-loading"><span className="brand-mark">C</span><p>Loading CodeCraft AI…</p></div>;
  if (!authUser) return <AuthPage onLogin={user => { setAuthUser(user); setPage("chat"); }} />;
  const visibleNavItems = authUser.role === "admin" ? [...navItems, ["admin", "Admin console", "▣"]] : navItems;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">C</span><span className="brand-word">CodeCraft<span className="muted"> AI</span></span></div>
      <button className="new-chat" onClick={freshChat}><span className="plus">＋</span><span>New chat</span></button>
      <nav className="navigation">{visibleNavItems.map(([id, label, icon]) => <button key={id} className={`nav-item ${page === id ? "active" : ""}`} onClick={() => { setPage(id); setError(""); }}><span className="nav-icon">{icon}</span><span>{label}</span></button>)}</nav>
      <div className="sidebar-divider" />
      <div className="sidebar-note"><span className={`status-dot ${health?.aiConfigured ? "online" : ""}`}></span><span>{health?.aiConfigured ? "Provider configured" : "Provider setup needed"}</span></div>
      <div className="sidebar-bottom"><span className="mini-mark">✳</span><span>Independent coding assistant<br/>Built for practical engineering</span></div>
    </aside>
    <section className="main-panel">
      <header className="topbar"><div><span className="eyebrow">CODECRAFT WORKSPACE</span><h1>{visibleNavItems.find(n => n[0] === page)?.[1] || "Workspace"}</h1></div><div className="top-actions"><div className="status-pill"><span className={`status-dot ${health?.aiConfigured ? "online" : ""}`}></span>{health?.aiConfigured ? "API ready" : "API needed"}</div>{page === "chat" && messages.length > 0 && <button className="quiet-button" onClick={saveSession}>Save session</button>}<button className="quiet-button" onClick={handleLogout}>Log out</button></div></header>
      {page === "chat" && <ChatPage {...{messages, draft, setDraft, busy, error, endRef, sendMessage, health, settings, setSettings, lastMeta, pendingApproval, onAgentDecision: decideAgentAction}} />}
      {page === "workspace" && <WorkspacePage setError={setError} error={error} />}
      {page === "tasks" && <TasksPage setError={setError} error={error} />}
      {page === "sessions" && <SessionsPage setMessages={setMessages} setPage={setPage} setError={setError} error={error} />}
      {page === "skills" && <SkillsPage setError={setError} error={error} />}
      {page === "settings" && <SettingsPage settings={settings} setSettings={setSettings} health={health} account={account} setError={setError} error={error} />}
      {page === "admin" && authUser.role === "admin" && <AdminPage setError={setError} error={error} onUpdated={() => apiFetch("/api/account").then(r=>r.json()).then(setAccount).catch(()=>{})} />}
    </section>
  </main>;
}

function ThinkingControls({ settings, setSettings, compact = false }) {
  return <div className={`controls-panel ${compact ? "compact" : ""}`}>
    <div className="section-heading"><div><span className="eyebrow">MODEL BEHAVIOR</span><h3>Reasoning mode · Thinking level</h3></div><span className="pill-note">API-supported only</span></div>
    <div className="thinking-options">{[["low","Low","Quick reasoning"],["medium","Medium","Balanced"],["high","High","Deeper reasoning"],["xhigh","X High","Highest supported effort; some models map this to High"]].map(([id,label,desc]) => <button key={id} className={`thinking-option ${settings.thinkingLevel === id ? "selected" : ""}`} onClick={() => setSettings(s => ({...s, thinkingLevel:id}))}><span className="radio-dot">{settings.thinkingLevel === id ? "●" : "○"}</span><span className="option-title">{label}</span><span className="option-desc">{desc}</span></button>)}</div>
    <p className="subtle-notice">Reasoning mode requests more or less model reasoning through the provider API when supported; it does not expose hidden chain-of-thought. A selected level alone does not prove the provider honored it. Run the diagnostics below to see which parameter was actually sent.</p>
    <div className="section-heading additional-heading"><div><span className="eyebrow">ADDITIONAL OPTIONS</span><h3>Response mode</h3></div></div>
    <div className="mode-options">{[
      ["standard","Standard","Provider defaults; no extra token cap."],
      ["quick","Quick response","Prompt requests a concise, fast answer; the selected thinking level stays unchanged and no extra output cap is added."],
      ["long","Long response","Requests up to 10,000 output tokens (a cap, not a minimum)."],
      ["deep","Reasoning mode · Accurate / deep analysis","Requests a 10,000-token thinking budget on ODiRouter Gemini 2.5 Pro; other models need provider mapping."]
    ].map(([id,label,desc]) => <button key={id} className={`mode-option ${settings.additionalMode === id ? "selected" : ""}`} onClick={() => setSettings(s => ({...s, additionalMode:id}))}><span className="radio-dot">{settings.additionalMode === id ? "●" : "○"}</span><span><strong>{label}</strong><small>{desc}</small></span></button>)}</div>
    <p className="subtle-notice">These settings are kept separately. A UI selection cannot force a model to think longer unless the API gateway and model support the mapped parameter.</p>
  </div>;
}

function ChatPage({ messages, draft, setDraft, busy, error, endRef, sendMessage, health, settings, setSettings, lastMeta, pendingApproval, onAgentDecision }) {
  return <>
    <section className="conversation">
      {messages.length === 0 ? <div className="welcome">
        <div className="orb"><span>✳</span></div><p className="eyebrow">YOUR DEVELOPMENT PARTNER</p><h2>Build something<br/><span>that works.</span></h2>
        <p className="welcome-copy">Explore code, plan features, inspect files and organize development work from one workspace.</p>
        <div className="suggestions">{["Explain a tricky bug","Plan a full-stack web app","Review this code for risks"].map(item => <button key={item} onClick={() => setDraft(item)}>{item}<span>↗</span></button>)}</div>
        {!health?.aiConfigured && <p className="setup-hint">Configure the server-side provider environment variables to enable AI replies.</p>}
        <div className="quick-thinking"><span className="eyebrow">CURRENT THINKING</span><div className="mini-segment">{[["low","Low"],["medium","Medium"],["high","High"],["xhigh","X High"]].map(([id,label]) => <button key={id} className={settings.thinkingLevel===id?"chosen":""} onClick={() => setSettings(s=>({...s,thinkingLevel:id}))}>{label}</button>)}</div><button className="text-link" onClick={() => document.getElementById("thinking-drawer")?.classList.toggle("open")}>Thinking & response options ↗</button><div id="thinking-drawer" className="inline-drawer"><ThinkingControls settings={settings} setSettings={setSettings} compact /></div></div>
      </div> : <div className="messages">{messages.map((m,i)=><article key={i} className={`message ${m.role}`}><div className="avatar">{m.role==="user"?"Y":"✳"}</div><div className="message-body"><div className="message-label">{m.role==="user"?"YOU":"CODECRAFT AI"}</div><div className="message-content">{m.content}</div>{m.role==="assistant"&&m.toolEvents?.length>0&&<div className="tool-trace"><div className="tool-trace-title">TOOLS USED IN THIS TURN</div>{m.toolEvents.map((event,j)=><div className="tool-trace-row" key={`${event.name}-${j}`}><span className={`tool-result-status ${event.status}`}>{event.status.replace(/_/g," ").toUpperCase()}</span><strong>{event.name}</strong><span>{event.detail}</span></div>)}</div>}{m.usage?.total_tokens!=null&&<div className="message-meta">{m.usage.total_tokens.toLocaleString()} tokens · {m.model||"AI model"}</div>}</div></article>)}{busy&&<article className="message assistant"><div className="avatar">✳</div><div className="message-body"><div className="message-label">CODECRAFT AI</div><div className="thinking"><i></i><i></i><i></i><span>Working · {settings.thinkingLevel.toUpperCase()}</span></div></div></article>}{pendingApproval&&<ApprovalPanel pending={pendingApproval} busy={busy} onDecision={onAgentDecision}/>}<div ref={endRef}/></div>}
    </section>
    <div className="composer-wrap">{error&&<div className="error-message">{error}</div>}{lastMeta&&<div className="request-meta"><span>{lastMeta.elapsedMs} ms</span><span>{lastMeta.usage?.total_tokens != null ? `${lastMeta.usage.total_tokens.toLocaleString()} tokens` : "Token usage not returned"}</span><span>{lastMeta.model}</span><span>{settings.thinkingLevel.toUpperCase()} · {settings.additionalMode}</span>{lastMeta.appliedSettings&&<span>{lastMeta.appliedSettings.reasoningParameterApplied?`Reasoning parameter sent: ${lastMeta.appliedSettings.thinkingField||"thinking budget"}${lastMeta.appliedSettings.thinkingValue?`=${lastMeta.appliedSettings.thinkingValue}`:""}`:"Provider reasoning parameter not sent"}</span>}{lastMeta.appliedSettings?.deepBudgetTokensRequested&&<span>Thinking budget requested: {Number(lastMeta.appliedSettings.deepBudgetTokensRequested).toLocaleString()}</span>}</div>}
      <form className="composer" onSubmit={sendMessage}><textarea value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(e);}}} placeholder="Ask CodeCraft anything about code..." rows="1" disabled={busy||!!pendingApproval}/><div className="composer-footer"><span>Enter to send · Shift + Enter for a new line</span><button className="send-button" type="submit" disabled={busy||!!pendingApproval||!draft.trim()} aria-label="Send message">↑</button></div></form><p className="disclaimer">AI can make mistakes. Review code and tool output before using them.</p>
    </div>
  </>;
}

function ApprovalPanel({ pending, busy, onDecision }) {
  const args = pending.arguments || {};
  const labels = { write_file: "Write / replace file", delete_file: "Delete file", run_command: "Run command", create_task: "Create task" };
  const previewOld = String(pending.currentContent || "");
  const previewNew = String(args.content || "");
  const diffLines = pending.tool === "write_file" ? makeLineDiff(previewOld.slice(0, 6000), previewNew.slice(0, 6000)).slice(0, 140) : [];
  const truncatedDiff = previewOld.length > 6000 || previewNew.length > 6000 || diffLines.length >= 140;
  return <section className="approval-panel"><div className="approval-top"><span className="approval-icon">!</span><div><strong>Approval required</strong><p>{labels[pending.tool] || pending.tool} · {pending.reason}</p></div></div><div className="approval-detail"><span className="eyebrow">PROPOSED ACTION</span><strong>{args.path || args.command || args.title || pending.tool}</strong>{pending.tool === "write_file" && <><div className="approval-diff">{diffLines.map((line,i)=><span key={i} className={`diff-line ${line.kind}`}>{line.kind==="added"?"+ ":line.kind==="removed"?"− ":"  "}{line.text||" "}{"\n"}</span>)}</div>{truncatedDiff&&<small className="diff-truncated">Diff preview is truncated. Open the Workspace editor for a fuller review after import/save.</small>}</>}{pending.tool === "delete_file" && <><p>This permanently removes the file from the workspace, but file history should allow undo.</p><details className="old-file-preview"><summary>Preview file content</summary><pre>{previewOld.slice(0,3000)}{previewOld.length>3000?"\n… (preview truncated)":""}</pre></details></>}{pending.tool === "run_command" && <p>Commands are restricted to the server's allowlist and still execute code from the workspace. Approve only if you trust this workspace.</p>}</div><div className="approval-actions"><button className="quiet-button" disabled={busy} onClick={() => onDecision(false)}>Reject</button><button className="primary-button" disabled={busy} onClick={() => onDecision(true)}>Approve action</button></div><p className="subtle-notice">Nothing in this action runs until you approve it. Review the path, command, and proposed change first.</p></section>;
}

function WorkspacePage({ setError, error }) {
  const [files,setFiles]=useState([]); const [current,setCurrent]=useState(""); const [content,setContent]=useState(""); const [savedContent,setSavedContent]=useState(""); const [query,setQuery]=useState(""); const [hits,setHits]=useState([]); const [output,setOutput]=useState(""); const [busy,setBusy]=useState(false); const [commandsEnabled,setCommandsEnabled]=useState(false); const [diffVisible,setDiffVisible]=useState(false); const [uploadStatus,setUploadStatus]=useState(""); const uploadRef=useRef(null);
  const reload=async()=>{const r=await apiFetch("/api/workspace/files");const d=await r.json();if(!r.ok)throw new Error(d.error);setFiles(d.files||[]);};
  useEffect(()=>{reload().catch(e=>setError(e.message));apiFetch("/api/health").then(r=>r.json()).then(d=>setCommandsEnabled(d.commandExecutionEnabled));},[]);
  const openFile=async p=>{try{const r=await apiFetch(`/api/workspace/read?path=${encodeURIComponent(p)}`);const d=await r.json();if(!r.ok)throw new Error(d.error);setCurrent(p);setContent(d.content);setSavedContent(d.content);setDiffVisible(false);setError("");}catch(e){setError(e.message);}};
  const save=async()=>{if(!current)return;setBusy(true);try{const r=await apiFetch("/api/workspace/write",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:current,content})});const d=await r.json();if(!r.ok)throw new Error(d.error);setSavedContent(content);setDiffVisible(false);setError("File saved.");await reload();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const createFile=async()=>{const p=prompt("Relative file path (example: src/app.js)");if(!p)return;try{const r=await apiFetch("/api/workspace/write",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:p,content:""})});const d=await r.json();if(!r.ok)throw new Error(d.error);await reload();await openFile(p);}catch(e){setError(e.message);}};
  const uploadFolder=async e=>{
    const selected=Array.from(e.target.files||[]);e.target.value="";if(!selected.length)return;
    if(selected.length>200){setError("Select a project folder with at most 200 files per import.");return;}
    const firstRoot=(selected[0].webkitRelativePath||selected[0].name).split("/")[0];
    const allowed=/\.(md|txt|json|js|jsx|ts|tsx|mjs|cjs|html|css|scss|sass|less|yml|yaml|toml|py|go|rs|java|kt|sh|sql|xml|vue|svelte|php|rb|swift|dart|c|cc|cpp|h|hpp|gradle|properties|ini|conf|lock|svg|gitignore|dockerignore)$/i;
    let imported=0,skipped=0,total=0;setBusy(true);setUploadStatus("Importing files…");
    try{
      for(const file of selected){
        const raw=file.webkitRelativePath||file.name;let parts=raw.split("/");if(parts.length>1&&parts[0]===firstRoot)parts=parts.slice(1);
        if(!parts.length||parts.some(part=>part.startsWith(".")||["node_modules","dist","build","coverage"].includes(part))||!allowed.test(parts[parts.length-1])||file.size>300000||total+file.size>20000000){skipped++;continue;}
        const rel=parts.join("/");let text;try{text=await file.text();}catch{skipped++;continue;}
        if(text.includes("\u0000")||new TextEncoder().encode(text).length>300000){skipped++;continue;}
        const r=await apiFetch("/api/workspace/write",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:rel,content:text})});
        if(!r.ok){skipped++;continue;}imported++;total+=file.size;
        setUploadStatus(`Imported ${imported} files…`);
      }
      await reload();setError("");setUploadStatus(`Imported ${imported} files; skipped ${skipped}.`);
    }catch(err){setError(err.message||"Could not import project folder.");setUploadStatus("");}
    finally{setBusy(false);}
  };
  const action=async endpoint=>{try{const r=await apiFetch(endpoint,{method:"POST"});const d=await r.json();if(!r.ok)throw new Error(d.error);setError(d.message||"Done.");if(d.path)await openFile(d.path);}catch(e){setError(e.message);}};
  const search=async e=>{e.preventDefault();try{const r=await apiFetch("/api/workspace/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query})});const d=await r.json();if(!r.ok)throw new Error(d.error);setHits(d.hits||[]);setError("");}catch(e){setError(e.message);}};
  const runCommand=async cmd=>{if(!window.confirm(`Approve running the “${cmd}” command in this workspace? Commands may execute project-defined scripts. Proceed only in an isolated sandbox.`))return;setBusy(true);setOutput("Running…");try{const r=await apiFetch("/api/commands/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:cmd,confirmed:true})});const d=await r.json();if(!r.ok)throw new Error(d.error);setOutput(`${cmd}${d.notConfigured?" · NOT CONFIGURED":` · exit ${d.exitCode}`}\n${d.output}`);}catch(e){setOutput(e.message);}finally{setBusy(false);}};
  return <div className="page-content"><div className="page-intro"><div><h2>Project workspace</h2><p>Browse and edit text files in the isolated <code>workspace/</code> directory.</p></div><div className="page-intro-actions"><input ref={uploadRef} className="hidden-file-input" type="file" webkitdirectory="" directory="" multiple onChange={uploadFolder}/><button className="quiet-button" onClick={()=>uploadRef.current?.click()}>Import folder</button><button className="primary-button" onClick={createFile}>＋ New file</button></div></div>{uploadStatus&&<div className="inline-message">{uploadStatus}</div>}{error&&<div className="inline-message">{error}</div>}
    <div className="workspace-grid"><aside className="file-pane"><div className="pane-title">FILES <button onClick={()=>reload().catch(e=>setError(e.message))}>↻</button></div>{files.length===0&&<p className="empty-note">No files yet.</p>}{files.map(f=><button key={f.path} className={`file-row ${current===f.path?"selected":""}`} onClick={()=>f.type==="file"&&openFile(f.path)} disabled={f.type!=="file"}><span>{f.type==="directory"?"▸":"·"}</span><span>{f.path}</span></button>)}</aside>
      <section className="editor-pane"><div className="editor-header"><span>{current||"No file selected"}{content!==savedContent&&current?" • unsaved":""}</span><div><button className="small-button" disabled={!current} onClick={()=>setDiffVisible(v=>!v)}>{diffVisible?"Editor":"Diff"}</button><button className="small-button" onClick={()=>action("/api/workspace/undo")}>Undo</button><button className="small-button" onClick={()=>action("/api/workspace/redo")}>Redo</button><button className="primary-button small" disabled={!current||busy||content===savedContent} onClick={save}>Save</button></div></div>{diffVisible&&current?<pre className="diff-view">{makeLineDiff(savedContent,content).map((line,i)=><span key={i} className={`diff-line ${line.kind}`}>{line.kind==="added"?"+ ":line.kind==="removed"?"− ":"  "}{line.text||" "}{"\n"}</span>)}</pre>:<textarea className="code-editor" value={content} onChange={e=>setContent(e.target.value)} spellCheck="false" placeholder="Select a file from the left, or create one." disabled={!current}/>}</section></div>
    <div className="tool-row"><form className="search-box" onSubmit={search}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search text across workspace…"/><button type="submit">Search</button></form><div className="command-buttons">{[["build","Build"],["test","Test"],["lint","Lint"],["typecheck","Typecheck"],["git-status","Git status"],["git-diff-check","Git diff check"]].map(([id,label])=><button key={id} className="small-button" onClick={()=>runCommand(id)}>{label}</button>)}</div></div>
    {hits.length>0&&<div className="results-list"><h3>Search results</h3>{hits.map((h,i)=><button key={i} onClick={()=>openFile(h.path)}><b>{h.path}:{h.line}</b><span>{h.preview}</span></button>)}</div>}{output&&<pre className="command-output">{output}</pre>}{!commandsEnabled&&<p className="subtle-notice">Command execution is disabled by default for safety. Enable it only for a trusted local workspace or an isolated sandbox; see README.md.</p>}
  </div>;
}

function TasksPage({setError,error}) {
  const [tasks,setTasks]=useState([]);const [title,setTitle]=useState("");
  const load=()=>apiFetch("/api/tasks").then(r=>r.json()).then(d=>setTasks(d.tasks||[])).catch(e=>setError(e.message));useEffect(()=>{load();},[]);
  const add=async e=>{e.preventDefault();if(!title.trim())return;try{const r=await apiFetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title})});const d=await r.json();if(!r.ok)throw new Error(d.error);setTasks(t=>[d.task,...t]);setTitle("");setError("");}catch(e){setError(e.message);}};
  const update=async(task,status)=>{try{const r=await apiFetch(`/api/tasks/${task.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});const d=await r.json();if(!r.ok)throw new Error(d.error);setTasks(ts=>ts.map(t=>t.id===task.id?d.task:t));}catch(e){setError(e.message);}};
  const remove=async task=>{await apiFetch(`/api/tasks/${task.id}`,{method:"DELETE"});setTasks(ts=>ts.filter(t=>t.id!==task.id));};
  return <div className="page-content"><div className="page-intro"><div><h2>Plan the work</h2><p>Track implementation steps and mark what has been verified.</p></div></div>{error&&<div className="inline-message">{error}</div>}<form className="task-form" onSubmit={add}><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Add a development task…"/><button className="primary-button" type="submit">Add task</button></form><div className="task-stats"><span>{tasks.filter(t=>t.status==="todo").length} To do</span><span>{tasks.filter(t=>t.status==="doing").length} In progress</span><span>{tasks.filter(t=>t.status==="done").length} Done</span></div><div className="task-list">{tasks.map(t=><div className="task-card" key={t.id}><span className={`task-check ${t.status}`} onClick={()=>update(t,t.status==="done"?"todo":"done")}>{t.status==="done"?"✓":t.status==="doing"?"◒":"○"}</span><div className="task-main"><strong className={t.status==="done"?"completed":""}>{t.title}</strong><small>Created {new Date(t.createdAt).toLocaleString()}</small></div><select value={t.status} onChange={e=>update(t,e.target.value)}><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option></select><button className="icon-button" onClick={()=>remove(t)} title="Delete task">×</button></div>)}{tasks.length===0&&<div className="empty-card">Your task list is empty. Add the first step of your project.</div>}</div></div>;
}

function SessionsPage({setMessages,setPage,setError,error}) {
  const [sessions,setSessions]=useState([]);const [busy,setBusy]=useState(false);
  const load=()=>apiFetch("/api/sessions").then(r=>r.json()).then(d=>setSessions(d.sessions||[])).catch(e=>setError(e.message));useEffect(()=>{load();},[]);
  const open=async id=>{setBusy(true);try{const r=await apiFetch(`/api/sessions/${id}`);const d=await r.json();if(!r.ok)throw new Error(d.error);setMessages(d.session.messages);setPage("chat");setError("");}catch(e){setError(e.message);}finally{setBusy(false);}};
  const remove=async id=>{await apiFetch(`/api/sessions/${id}`,{method:"DELETE"});setSessions(s=>s.filter(x=>x.id!==id));};
  return <div className="page-content"><div className="page-intro"><div><h2>Saved sessions</h2><p>Save useful conversations and return to them later.</p></div><button className="small-button" onClick={load}>Refresh</button></div>{error&&<div className="inline-message">{error}</div>}<div className="session-list">{sessions.map(s=><div className="session-card" key={s.id}><div className="session-icon">◷</div><div className="session-main"><strong>{s.title}</strong><small>{s.count} messages · {new Date(s.updatedAt).toLocaleString()}</small></div><button className="small-button" disabled={busy} onClick={()=>open(s.id)}>Open</button><button className="icon-button" onClick={()=>remove(s.id)}>×</button></div>)}{sessions.length===0&&<div className="empty-card">No saved sessions yet. Use “Save session” from Chat.</div>}</div></div>;
}

function SkillsPage({setError,error}) {
  const [skills,setSkills]=useState([]);const [name,setName]=useState("");const [content,setContent]=useState("Describe a repeatable coding workflow here.");const [rules,setRules]=useState("");
  const load=async()=>{const r=await apiFetch("/api/skills");const d=await r.json();if(!r.ok)throw new Error(d.error);setSkills(d.skills||[]);};useEffect(()=>{load().catch(e=>setError(e.message));apiFetch("/api/workspace/read?path=AGENTS.md").then(r=>r.ok?r.json():null).then(d=>d&&setRules(d.content));},[]);
  const saveSkill=async e=>{e.preventDefault();try{const r=await apiFetch("/api/skills",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,content})});const d=await r.json();if(!r.ok)throw new Error(d.error);setName("");await load();setError("Skill saved. Its instructions will be included in future chat requests.");}catch(e){setError(e.message);}};
  const saveRules=async()=>{try{const r=await apiFetch("/api/workspace/write",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:"AGENTS.md",content:rules})});const d=await r.json();if(!r.ok)throw new Error(d.error);setError("Project rules saved.");}catch(e){setError(e.message);}};
  return <div className="page-content"><div className="page-intro"><div><h2>Project instructions & skills</h2><p>Keep project conventions and reusable workflows close to your code.</p></div></div>{error&&<div className="inline-message">{error}</div>}<section className="settings-card"><div className="section-heading"><div><span className="eyebrow">AGENTS.MD</span><h3>Project rules</h3></div><button className="primary-button small" onClick={saveRules}>Save rules</button></div><textarea className="rules-editor" value={rules} onChange={e=>setRules(e.target.value)} placeholder="Describe conventions, build commands, and review requirements…"/></section><section className="settings-card"><div className="section-heading"><div><span className="eyebrow">REUSABLE WORKFLOWS</span><h3>Skills</h3></div></div><form className="skill-form" onSubmit={saveSkill}><input value={name} onChange={e=>setName(e.target.value)} placeholder="Skill name (e.g. security-review)"/><textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="Instructions in Markdown…"/><button className="primary-button" type="submit">Save skill</button></form><div className="skill-list">{skills.map(s=><div className="skill-item" key={s.name}><strong>{s.name}</strong><p>{s.content}</p></div>)}{skills.length===0&&<p className="empty-note">No custom skills created yet.</p>}</div></section><p className="subtle-notice">Skills and project rules currently provide prompt context. They are not yet autonomous tools, external plugins, or MCP servers.</p></div>;
}

function AuthPage({ onLogin }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await apiFetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Sign in failed."); onLogin(d.user);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <main className="auth-screen"><section className="auth-card"><div className="auth-brand"><span className="brand-mark">C</span><span>CodeCraft<span className="muted"> AI</span></span></div><span className="eyebrow">PRIVATE DEVELOPER WORKSPACE</span><h1>Sign in to build.</h1><p className="auth-subtitle">Use the account provided by your administrator.</p>{error && <div className="inline-message danger">{error}</div>}<form onSubmit={submit} className="auth-form"><label>Email address<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /></label><label>Password<input type="password" required minLength={1} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Your password" /></label><button className="primary-button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form><p className="auth-footnote">Provider API keys are managed securely by the administrator and are never shown here.</p></section></main>;
}

function AdminPage({ setError, error }) {
  const [overview, setOverview] = useState(null); const [users, setUsers] = useState([]); const [prompts, setPrompts] = useState([]); const [usage, setUsage] = useState([]);
  const [selectedId, setSelectedId] = useState(""); const [email, setEmail] = useState(""); const [newPassword, setNewPassword] = useState(""); const [newLimit, setNewLimit] = useState("100000");
  const [providerName, setProviderName] = useState("ODiRouter"); const [baseUrl, setBaseUrl] = useState("https://api.odirouter.ai/v1"); const [model, setModel] = useState(""); const [apiKey, setApiKey] = useState(""); const [tokenLimit, setTokenLimit] = useState("100000");
  const [promptModel, setPromptModel] = useState("*"); const [promptText, setPromptText] = useState(""); const [newPromptModel, setNewPromptModel] = useState("");
  const [thinkingField, setThinkingField] = useState(""); const [thinkingLowValue, setThinkingLowValue] = useState(""); const [thinkingMediumValue, setThinkingMediumValue] = useState("");
  const [thinkingHighValue, setThinkingHighValue] = useState(""); const [thinkingXHighValue, setThinkingXHighValue] = useState("");
  const [maxOutputField, setMaxOutputField] = useState(""); const [thinkingBudgetField, setThinkingBudgetField] = useState("");
  const [busy, setBusy] = useState(false); const [testingApi, setTestingApi] = useState(false); const [tab, setTab] = useState("users");
  const selectedUser = users.find(u => u.id === selectedId);
  async function request(url, options) { const r = await apiFetch(url, options); const d = await r.json(); if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`); return d; }
  async function refresh() {
    try {
      const [o,u,p,us] = await Promise.all([request("/api/admin/overview"),request("/api/admin/users"),request("/api/admin/prompts"),request("/api/admin/usage")]);
      setOverview(o); setUsers(u.users); setPrompts(p.prompts); setUsage(us.events);
      if (selectedId && !u.users.some(x=>x.id===selectedId)) setSelectedId("");
      const activePrompt = p.prompts.find(x=>x.modelId===promptModel) || p.prompts.find(x=>x.modelId==="*");
      if (activePrompt) { setPromptModel(activePrompt.modelId); setPromptText(activePrompt.systemPrompt); }
    } catch(e) { setError(e.message); }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!selectedUser) return;
    setProviderName(selectedUser.providerName || "ODiRouter"); setBaseUrl(selectedUser.baseUrl || "https://api.odirouter.ai/v1");
    setModel(selectedUser.model || ""); setTokenLimit(String(selectedUser.monthlyTokenLimit)); setApiKey("");
  }, [selectedId]);
  useEffect(() => {
    const p = prompts.find(x=>x.modelId===promptModel);
    setPromptText(p?.systemPrompt || "");
    setThinkingField(p?.thinkingField || ""); setThinkingLowValue(p?.thinkingLowValue || ""); setThinkingMediumValue(p?.thinkingMediumValue || "");
    setThinkingHighValue(p?.thinkingHighValue || ""); setThinkingXHighValue(p?.thinkingXHighValue || "");
    setMaxOutputField(p?.maxOutputField || ""); setThinkingBudgetField(p?.thinkingBudgetField || "");
  }, [promptModel, prompts]);
  async function createUser(e) {
    e.preventDefault(); setBusy(true); setError("");
    try { const d = await request("/api/admin/users", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:newPassword,monthlyTokenLimit:Number(newLimit)})}); setEmail("");setNewPassword("");setSelectedId(d.user.id); await refresh(); setTab("users"); }
    catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function saveApi(e) {
    e.preventDefault(); if(!selectedUser) return setError("Select a user first."); setBusy(true);setError("");
    try { await request(`/api/admin/users/${selectedUser.id}/api`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({providerName,baseUrl,model,apiKey})}); setApiKey("");await refresh();setError("API configuration saved. The secret is stored encrypted and cannot be retrieved from the UI."); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function saveLimit() {
    if(!selectedUser) return;setBusy(true);setError("");
    try{await request(`/api/admin/users/${selectedUser.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({monthlyTokenLimit:Number(tokenLimit)})});await refresh();setError("Usage limit updated.");}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function toggleUser(user) {
    try { await request(`/api/admin/users/${user.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!user.enabled})}); await refresh(); }
    catch(e){setError(e.message);}
  }
  async function testApi() {
    if(!selectedUser?.apiConfigured) return setError("Save an API configuration first.");
    setTestingApi(true); setError("");
    try { const d = await request(`/api/admin/users/${selectedUser.id}/api/test`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})}); setError(`API connection succeeded: ${d.model} · ${d.elapsedMs} ms. Test reply: ${d.reply || "(empty)"}`); await refresh(); }
    catch(e){setError(e.message);} finally{setTestingApi(false);}
  }
  async function savePrompt(e) {
    e.preventDefault();setBusy(true);setError("");
    try{await request("/api/admin/prompts",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({modelId:promptModel,systemPrompt:promptText,thinkingField,thinkingLowValue,thinkingMediumValue,thinkingHighValue,thinkingXHighValue,maxOutputField,thinkingBudgetField})});await refresh();setError(`System prompt and thinking mapping saved for ${promptModel}.`);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div className="page-content admin-page">
    <div className="page-intro"><div><h2>Administrator console</h2><p>Manage accounts, encrypted API credentials, model-specific system prompts, and usage.</p></div><button className="quiet-button" onClick={refresh}>Refresh</button></div>
    {error && <div className="inline-message">{error}</div>}
    <div className="admin-stats">{[["Accounts",overview?.users??"—"],["APIs assigned",overview?.configuredAccounts??"—"],["Models / prompts",overview?.prompts??"—"],["Tokens this month",Number(overview?.monthTokens||0).toLocaleString()]].map(([k,v])=><div className="admin-stat" key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>
    <div className="admin-tabs">{[["users","Users & API"],["prompts","System prompts"],["usage","Usage log"],["create","Create account"]].map(([id,label])=><button className={tab===id?"active":""} onClick={()=>setTab(id)} key={id}>{label}</button>)}</div>
    {tab==="users" && <div className="admin-grid">
      <section className="settings-card"><div className="section-heading"><div><span className="eyebrow">ACCOUNTS</span><h3>Users</h3></div><span className="pill-note">Select to configure</span></div>
        <div className="admin-user-list">{users.map(u=><button className={`admin-user ${selectedId===u.id?"selected":""}`} key={u.id} onClick={()=>setSelectedId(u.id)}><span className="admin-user-icon">{u.role==="admin"?"A":"U"}</span><span className="admin-user-main"><strong>{u.email}</strong><small>{u.role} · {u.apiConfigured?`${u.model}`:"No API assigned"}</small><small>{Number(u.monthTokens).toLocaleString()} / {u.monthlyTokenLimit===0?"∞":Number(u.monthlyTokenLimit).toLocaleString()} tokens this month</small></span><span className={`capability-status ${u.enabled?"done":"gated"}`}>{u.enabled?"Active":"Disabled"}</span></button>)}</div>
      </section>
      <section className="settings-card"><div className="section-heading"><div><span className="eyebrow">ASSIGNED PROVIDER</span><h3>{selectedUser?selectedUser.email:"Select a user"}</h3></div></div>
        {!selectedUser ? <div className="empty-card">Choose an account from the list.</div> : <><form className="admin-form" onSubmit={saveApi}><label>Provider name<input value={providerName} onChange={e=>setProviderName(e.target.value)} required /></label><label>Base URL<input type="url" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} required placeholder="https://provider.example/v1" /></label><label>Model ID<input value={model} onChange={e=>setModel(e.target.value)} required placeholder="provider/model-slug" /></label><label>API key <small>{selectedUser.apiConfigured?"(blank keeps existing key)":"(required)"}</small><input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} autoComplete="new-password" placeholder={selectedUser.apiConfigured?"Stored securely; enter only to rotate":"Paste user's provider API key"} required={!selectedUser.apiConfigured} /></label><button className="primary-button" disabled={busy}>{busy?"Saving…":"Save API settings"}</button></form><button className="quiet-button test-api-button" onClick={testApi} disabled={testingApi || !selectedUser.apiConfigured}>{testingApi?"Testing API…":"Test saved API (may incur a small provider charge)"}</button><div className="admin-limit"><label>Monthly token limit (0 = unlimited)<input type="number" min="0" max="1000000000" value={tokenLimit} onChange={e=>setTokenLimit(e.target.value)} /></label><button className="quiet-button" onClick={saveLimit} disabled={busy}>Save limit</button></div><p className="subtle-notice">API keys are encrypted at rest. They are never shown again after saving. Use the user's own key if the user should pay the provider directly. This app records token usage; it does not yet process monetary payments.</p><button className="danger-button" onClick={async()=>{if(!confirm("Remove this user's API configuration?"))return;try{await request(`/api/admin/users/${selectedUser.id}/api`,{method:"DELETE"});await refresh();}catch(e){setError(e.message);}}}>Remove assigned API</button><button className="quiet-button" onClick={()=>toggleUser(selectedUser)}>{selectedUser.enabled?"Disable user":"Enable user"}</button></>}
      </section></div>}
    {tab==="create" && <section className="settings-card"><div className="section-heading"><div><span className="eyebrow">NEW CUSTOMER</span><h3>Create user account</h3></div></div><form className="admin-form admin-create-form" onSubmit={createUser}><label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label><label>Initial password (12+ characters)<input type="password" minLength="12" required value={newPassword} onChange={e=>setNewPassword(e.target.value)} autoComplete="new-password" /></label><label>Monthly token limit<input type="number" min="0" max="1000000000" value={newLimit} onChange={e=>setNewLimit(e.target.value)} /></label><button className="primary-button" disabled={busy}>{busy?"Creating…":"Create user"}</button></form><p className="subtle-notice">New users cannot use the coding assistant until an API key and model are assigned.</p></section>}
    {tab==="prompts" && <section className="settings-card"><div className="section-heading"><div><span className="eyebrow">MODEL INSTRUCTIONS</span><h3>System prompt per model</h3></div></div><div className="prompt-picker"><label>Existing prompt<select value={promptModel} onChange={e=>setPromptModel(e.target.value)}>{prompts.map(p=><option key={p.modelId} value={p.modelId}>{p.modelId==="*"?"Default for all models (*)":p.modelId}</option>)}</select></label><label>Or enter a new model ID<input value={newPromptModel} onChange={e=>setNewPromptModel(e.target.value)} placeholder="e.g. provider/model-slug" /><button className="quiet-button" type="button" onClick={()=>{if(newPromptModel.trim()){setPromptModel(newPromptModel.trim());setPromptText("");setNewPromptModel("");}}}>Create prompt slot</button></label></div><form className="admin-form" onSubmit={savePrompt}><label>System prompt for <strong>{promptModel}</strong><textarea className="rules-editor" rows="14" value={promptText} onChange={e=>setPromptText(e.target.value)} required minLength="5" maxLength="50000" /></label><div className="reasoning-config"><div className="reasoning-config-title"><strong>Thinking / output parameter mapping</strong><small>Leave fields blank to use server .env defaults. Parameter names are provider-specific.</small></div><label>Thinking parameter path<input value={thinkingField} onChange={e=>setThinkingField(e.target.value)} placeholder="e.g. reasoning_effort or reasoning.effort" /></label><div className="reasoning-value-grid"><label>Low value<input value={thinkingLowValue} onChange={e=>setThinkingLowValue(e.target.value)} placeholder="low" /></label><label>Medium value<input value={thinkingMediumValue} onChange={e=>setThinkingMediumValue(e.target.value)} placeholder="medium" /></label><label>High value<input value={thinkingHighValue} onChange={e=>setThinkingHighValue(e.target.value)} placeholder="high" /></label><label>X High value<input value={thinkingXHighValue} onChange={e=>setThinkingXHighValue(e.target.value)} placeholder="xhigh" /></label></div><label>Long response output-token parameter<input value={maxOutputField} onChange={e=>setMaxOutputField(e.target.value)} placeholder="max_completion_tokens" /></label><label>Deep analysis budget parameter<input value={thinkingBudgetField} onChange={e=>setThinkingBudgetField(e.target.value)} placeholder="Provider-specific; leave blank if unsupported" /></label></div><button className="primary-button" disabled={busy}>{busy?"Saving…":"Save prompt & thinking mapping"}</button></form><p className="subtle-notice">The model-specific prompt and parameter mapping are applied server-side. Use a parameter name and value the assigned provider/model actually supports. No model can be guaranteed to follow a prompt 100% of the time; sensitive actions are controlled by server permissions.</p></section>}
    {tab==="usage" && <section className="settings-card"><div className="section-heading"><div><span className="eyebrow">METERING</span><h3>Recent usage events</h3></div><span className="pill-note">Latest 300 requests</span></div><div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>Time</th><th>User</th><th>Model</th><th>Input</th><th>Output</th><th>Total</th></tr></thead><tbody>{usage.map((u,i)=><tr key={`${u.createdAt}-${i}`}><td>{new Date(u.createdAt).toLocaleString()}</td><td>{u.email}</td><td>{u.modelId}</td><td>{Number(u.inputTokens).toLocaleString()}</td><td>{Number(u.outputTokens).toLocaleString()}</td><td>{Number(u.totalTokens).toLocaleString()}</td></tr>)}</tbody></table></div><p className="subtle-notice">Token counts come from provider usage responses where available. No currency amount is guessed because provider rates vary by model and may change.</p></section>}
  </div>;
}

function SettingsPage({settings,setSettings,health,account,setError,error}) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const runDiagnostics = async () => {
    if (!confirm("Run workspace tool tests and up to 8 live provider requests? Provider checks may consume your API quota.")) return;
    setRunningDiagnostics(true); setDiagnostics(null); setError("");
    try {
      const response = await apiFetch("/api/diagnostics/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerChecks: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Diagnostics failed (${response.status})`);
      setDiagnostics(data);
    } catch (e) { setError(e.message || "Could not run diagnostics."); }
    finally { setRunningDiagnostics(false); }
  };
  return <div className="page-content settings-page"><div className="page-intro"><div><h2>Settings & account</h2><p>Thinking controls remain separate from response modes.</p></div></div>{error&&<div className="inline-message">{error}</div>}
    <ThinkingControls settings={settings} setSettings={setSettings}/>
    <section className="settings-card"><div className="section-heading"><div><span className="eyebrow">YOUR ACCOUNT</span><h3>API & usage</h3></div><span className={`status-pill ${account?.apiConfigured?"success":""}`}>{account?.apiConfigured?"API assigned":"API not assigned"}</span></div><div className="config-grid"><div><span>Assigned provider</span><strong>{account?.providerName||"Not assigned"}</strong></div><div><span>Assigned model</span><strong>{account?.model||"Not assigned"}</strong></div><div><span>Tokens this month</span><strong>{Number(account?.usage?.total||0).toLocaleString()} / {account?.user?.monthlyTokenLimit===0?"Unlimited":Number(account?.user?.monthlyTokenLimit||0).toLocaleString()}</strong></div></div><p className="subtle-notice">API keys are administered on the server and are never exposed in your browser. Ask your administrator to assign or update your provider configuration if the assistant is not ready.</p></section>
    <section className="settings-card"><div className="section-heading"><div><span className="eyebrow">LIVE SELF-TEST</span><h3>Tools & reasoning diagnostics</h3><p>Tests workspace tools including path traversal, symlink, NUL-byte, and 300 KB limits; when configured, sends live requests for tool-calling, all four thinking choices, Deep mode, and Long mode.</p></div><button className="primary-button" onClick={runDiagnostics} disabled={runningDiagnostics}>{runningDiagnostics?"Running diagnostics…":"Run full diagnostics"}</button></div><p className="subtle-notice">Temporary test files/tasks are cleaned up afterward. Live provider tests can consume API quota. A parameter accepted by the gateway is not proof that the model honored it internally.</p>{diagnostics&&<><div className="diagnostic-summary"><span>Local tests passed: <strong>{diagnostics.summary?.passed??0}</strong></span><span>Failed: <strong>{diagnostics.summary?.failed??0}</strong></span><span>Skipped: <strong>{diagnostics.summary?.skipped??0}</strong></span><span>Not implemented: <strong>{diagnostics.summary?.notImplemented??0}</strong></span></div><div className="diagnostic-results">{(diagnostics.results||[]).map((item,i)=><div className="diagnostic-row" key={`${item.name}-${i}`}><span className={`tool-result-status ${item.status}`}>{item.status.toUpperCase()}</span><strong>{item.name}</strong><span>{item.message||item.detail||item.reason||item.explanation||item.count&&`${item.count} tools`||""}</span>{item.tools&&<small>{item.tools.map(t=>t.name).join(", ")}</small>}</div>)}</div><div className="diagnostic-provider"><h4>Live provider checks · {diagnostics.provider?.status||"not run"}</h4>{diagnostics.provider?.explanation&&<p>{diagnostics.provider.explanation}</p>}{(diagnostics.provider?.checks||[]).map((item,i)=><div className="diagnostic-row" key={`${item.name}-${i}`}><span className={`tool-result-status ${item.status}`}>{item.status.toUpperCase()}</span><strong>{item.name}</strong><span>{item.message||""}{item.model?` · model: ${item.model}`:""}{item.toolCallReturned!=null?` · tool call returned: ${item.toolCallReturned}${item.toolCallNames?.length?` (${item.toolCallNames.join(", ")})`:""}`:""}{item.usage?.reasoning_tokens!=null?` · reasoning tokens reported: ${item.usage.reasoning_tokens}`:""}{item.reasoningVerification?.evidence?` · evidence: ${item.reasoningVerification.evidence}`:""}{item.appliedSettings?.reasoningParameterApplied?` · parameter sent: ${item.appliedSettings.thinkingField?`${item.appliedSettings.thinkingField}=${item.appliedSettings.thinkingValue}`:item.appliedSettings.deepBudgetField?`${item.appliedSettings.deepBudgetField}=${item.appliedSettings.deepBudgetTokensRequested}`:"thinking budget"}`:""}{item.appliedSettings?.outputField?` · output cap: ${item.appliedSettings.outputField}=${item.appliedSettings.outputTokenLimitRequested}`:""}</span></div>)}</div>{diagnostics.provider?.note&&<p className="subtle-notice">{diagnostics.provider.note}</p>}</>}</section>
    <section className="settings-card"><div className="section-heading"><div><span className="eyebrow">PROVIDER CAPABILITIES</span><h3>Connection status</h3></div></div><div className="capability-list">{[["Available","Agent exposes 8 workspace tools and shows per-turn tool traces"],["Test with diagnostics","Function/tool calling must work on the assigned provider model"],["Test with diagnostics","Thinking levels send request parameters only when a provider mapping is available"],["Test with diagnostics","Deep/Long attempt provider-specific budget/cap settings; Quick adds concise-response prompt guidance"],["Available","Per-user API assignment and token metering"],["Available","Model-specific administrator system prompts"],["Available","Per-user workspace, sessions, tasks and file history"],["Safety-gated","Build/test/lint/typecheck commands; disabled by default"],["Not implemented","Web search, MCP servers, LSP diagnostics"],["Not implemented","Parallel subagents, Git worktrees, plugin lifecycle"],["Required before public production","Isolated command sandbox, persistent hosting volume, backups, operational monitoring"]].map(([status,label])=><div key={label} className="capability-row"><span className={`capability-status ${status=== "Available"?"done":status==="Safety-gated"?"gated":"planned"}`}>{status}</span><span>{label}</span></div>)}</div></section>
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
