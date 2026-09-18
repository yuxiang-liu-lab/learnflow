(() => {
  "use strict";
  if (globalThis.__qaInspectionLoaded) return;
  globalThis.__qaInspectionLoaded = true;
  const host = document.createElement("div");
  const shadow = host.attachShadow({mode:"closed"});
  host.style.cssText = "all:initial!important;position:fixed!important;right:12px!important;top:90px!important;z-index:2147483646!important;display:block!important;";
  shadow.innerHTML = `<style>
    :host{color-scheme:light} *{box-sizing:border-box}
    section{width:290px;max-width:calc(100vw - 24px);max-height:calc(100vh - 16px);overflow:auto;background:#fff;color:#17263b;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 8px 30px #17263b26;font:14px/1.5 system-ui,sans-serif}
    header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#eff6ff;position:sticky;top:0;cursor:grab;touch-action:none;user-select:none}
    header.dragging, header.dragging *{cursor:grabbing}
    h2{font-size:16px;margin:0} button{font:inherit;cursor:pointer;color:#174b8a;background:white;border:1px solid #b7c9dd;border-radius:6px;padding:5px 9px}
    .body{padding:14px} p{margin:0 0 10px;overflow-wrap:anywhere} ol{padding-left:24px;margin:6px 0 14px} .small{color:#526479;font-size:12px}
    section.collapsed{width:auto} section.collapsed .body{display:none}
  </style><section aria-label="LearnFlow"><header><h2>Practice · LearnFlow</h2><button id="toggle" aria-expanded="true" aria-label="Collapse LearnFlow">−</button></header>
  <div class="body"><p id="connection" class="small">Connecting to extension worker…</p><p id="detected">Question detected: No</p><p id="audio">Audio detected: Waiting for question</p><p id="status" role="status" aria-live="polite">Waiting for a question</p><p id="question"></p><ol id="choices" type="A"></ol>
  <div id="result" hidden><p><strong>Suggested answer:</strong> <span id="answer"></span></p><p id="answer-text"></p><p><strong>Explanation:</strong> <span id="explanation"></span></p><p><strong>Confidence:</strong> <span id="confidence"></span></p><p class="small" id="model-used"></p></div>
  <details><summary>Practice debug (local only)</summary><p class="small">Local inspection only. Copy this output to diagnose prompt detection. No diagnostics are sent automatically.</p><button id="copy-parser-debug">Copy Practice debug</button><pre id="parser-diagnostics" class="small" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto"></pre></details><details id="audio-debug" hidden><summary>Audio debug (optional)</summary><p id="audio-source" class="small"></p><p id="audio-evidence" class="small"></p><pre id="audio-diagnostics" class="small" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></details><p class="small">Supports text questions and question-specific native MP3 listening players. Confidence is the model’s estimate.</p><button id="again">Analyze again</button> <button id="settings">Settings</button></div></section>`;
  document.documentElement.append(host);
  const get = id => shadow.getElementById(id);
  const section = shadow.querySelector("section");
  let current = null, timer, collapsed = false, generation = 0, activeRequest = null;
  let observer, healthTimer, contextLost = false, connected = false;
  let fetchDiagnostics = null, mediaEvents = [], traceQuestion = null;
  const watchedPlayers = new WeakSet();
  function verifyAudio(snapshot,response) {
    if(!snapshot.data.audio)return;
    const expected=snapshot.data.audioSources?.length?snapshot.data.audioSources:[snapshot.data.audio];
    const actual=response.audioSources || (response.audio?[response.audio]:[]);
    if(actual.length!==expected.length||expected.some((source,i)=>actual[i]?.url!==source.url||expected.length>1&&(actual[i]?.id!==source.id||actual[i]?.label!==source.label)||!/^[a-f0-9]{64}$/.test(actual[i]?.sha256||'')||!(actual[i]?.byteLength>0)))throw new Error('Audio unavailable — not all question excerpts were verified.');
  }
  function renderAudioDebug(snapshot = current) {
    if (!snapshot?.data.audio) return;
    get('audio-debug').hidden = false;
    get('audio-diagnostics').textContent = JSON.stringify({
      ...(snapshot.audioDiagnostics || {}),
      fetchHTTPStatus:null,contentType:null,finalRedirectedURL:null,
      ...(fetchDiagnostics || {}),
      sources:(snapshot.audioDiagnostics?.sources||[]).map(source=>({...source,...fetchDiagnostics?.sources?.find(item=>item.id===source.id)})),
      failureStage:fetchDiagnostics?.failureStage ?? snapshot.audioDiagnostics?.failureStage ?? null,
      mediaEvents
    },null,2);
  }
  function watchMedia(snapshot) {
    if(traceQuestion !== snapshot.data.id) {traceQuestion=snapshot.data.id;mediaEvents=[];}
    for(const player of snapshot.players || []) {
      if(watchedPlayers.has(player) || !player.addEventListener)continue;
      watchedPlayers.add(player);
      mediaEvents.push({event:'inspection',...snapshot.audioDiagnostics});
      for(const event of ['loadstart','loadedmetadata','loadeddata','canplay','play','emptied','error']) {
        player.addEventListener(event,()=>{
          if(contextLost || !connected)return;
          const live=qaReadQuestion();
          if(!live.ok || !live.players?.includes(player))return;
          mediaEvents.push({event,...live.audioDiagnostics});mediaEvents=mediaEvents.slice(-12);
          // Media readiness is diagnostic only. Rescan/dedupe by clip identity.
          scan();
        });
      }
    }
  }
  const messaging = qaCreateMessaging(error => {
    contextLost = true;
    connected = false;
    generation++;
    activeRequest = null;
    current = null;
    clearTimeout(timer);
    clearInterval(healthTimer);
    observer?.disconnect();
    clearResult();
    get("connection").textContent = `LearnFlow ${QA_BUILD_VERSION} — context disconnected`;
    get("again").disabled = false;
    get("status").textContent = error.message;
    console.warn("[LearnFlow] Extension context unavailable; observer stopped. Reload the Cengage tab.");
  });
  const placement = qaEnableDragging(host, section, shadow.querySelector("header"), messaging);
  function clearResult() {
    get("result").hidden = true;
    get("audio-source").textContent = "";
    get("audio-diagnostics").textContent = "";
    fetchDiagnostics = null;
    get("audio-debug").hidden = true;
    get("audio-debug").open = false;
    get("audio-evidence").textContent = "";
    for (const id of ["answer", "answer-text", "explanation", "confidence", "model-used"]) get(id).textContent = "";
  }
  function invalidate() {
    generation++;
    if (activeRequest && !contextLost) messaging.send({type:"QA_CANCEL", requestId:activeRequest}).catch(() => {});
    activeRequest = null; get("again").disabled = false; clearResult();
  }
  async function analyze(force) {
    if (contextLost || !messaging.check() || !current) return;
    invalidate();
    const requestId = crypto.randomUUID();
    activeRequest = requestId;
    const token = generation;
    const snapshot = current;
    renderAudioDebug(snapshot);
    get("again").disabled = true;
    get("status").textContent = snapshot.data.audio ? "Audio detected — retrieving and analyzing clip…" : "Analyzing…";
    let deadline;
    try {
      const response = await Promise.race([
        messaging.send({type:"QA_ANALYZE", requestId, question:snapshot.data, force:!!force}),
        new Promise((_, reject) => {deadline = setTimeout(() => reject(new Error("Request timed out. Try Analyze again.")), snapshot.data.audio ? 60000 : 30000);})
      ]);
      if (token !== generation || current?.fingerprint !== snapshot.fingerprint) return;
      // Re-read the DOM before displaying: a transition may precede its observer.
      const live = qaReadQuestion();
      if (!live.ok || live.fingerprint !== snapshot.fingerprint) {invalidate(); scan(); return;}
      fetchDiagnostics = response?.diagnostics || (snapshot.data.audio ? {failureStage:response?.ok ? null : "analysis-or-worker",errorCode:response?.error?.code || null} : null);
      renderAudioDebug(live);
      if (!response?.ok) {
        if(snapshot.data.audio)get("audio-debug").open = true;
        get("status").textContent = response?.error?.message || "Analysis failed. Try again.";
        get("audio").textContent = snapshot.data.audio ? (snapshot.data.audio.kind === "unsupported" ? "Audio required — clip unavailable" : "Audio detected: Yes — no verified analysis available") : "Audio detected: No — text question";
        return;
      }
      const value = response.suggestion;
      verifyAudio(snapshot,response);
      const choice = snapshot.data.choices.find(c => c.answer === value?.answer);
      if (!choice || value.answerText !== choice.text || typeof value.explanation !== "string" || !value.explanation.trim() ||
          !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error("Invalid answer response. Try Analyze again.");
      get("answer").textContent = value.answer;
      get("answer-text").textContent = choice.text;
      get("explanation").textContent = value.explanation;
      get("confidence").textContent = `${Math.round(value.confidence * 100)}%`;
      get("model-used").textContent = `Model: ${response.model}`;
      get("result").hidden = false;
      get("audio").textContent = snapshot.data.audio ? (snapshot.data.audioSources?.length>1?"Audio detected: Yes — all excerpts analyzed":"Audio detected: Yes — clip analyzed") : "Audio detected: No — text question";
      get("audio-evidence").textContent = snapshot.data.audio && Array.isArray(response.audibleEvidence) ? `audibleEvidence: ${JSON.stringify(response.audibleEvidence)}` : "";
      get("audio-debug").hidden = !snapshot.data.audio;
      get("audio-source").textContent = snapshot.data.audioSources?.length>1 ? "Analyzed excerpts: "+response.audioSources.map(s=>s.label+" · "+s.byteLength+" bytes · SHA-256 "+s.sha256).join("; ") : snapshot.data.audio ? `Analyzed question MP3: ${fetchDiagnostics?.resolvedMediaURL || snapshot.audioDiagnostics?.resolvedMediaURL || "(see diagnostics)"} · ${response.audio.byteLength.toLocaleString()} bytes · SHA-256 ${response.audio.sha256} · Prompt: ${response.promptVersion || "unknown"}` : "";
      get("status").textContent = "Ready";
      if (!placement.hasPreferredPosition() && !collapsed && !fits(live.elements)) collapse(true);
    } catch (cause) {
      if (token === generation) get("status").textContent = cause.message || "Extension unavailable. Reload the quiz page.";
    } finally {
      clearTimeout(deadline);
      if (token === generation) {activeRequest = null; get("again").disabled = false;}
    }
  }
  function collapse(value) {
    collapsed = value; section.classList.toggle("collapsed", value);
    get("toggle").textContent = value ? "+" : "−";
    get("toggle").setAttribute("aria-expanded", String(!value));
    get("toggle").setAttribute("aria-label", value ? "Expand LearnFlow" : "Collapse LearnFlow");
    placement.reclamp();
  }
  function fits(elements) {
    const panel = section.getBoundingClientRect();
    return !elements.some(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      return [...range.getClientRects()].some(rect => rect.width && rect.height && rect.left < panel.right && rect.right > panel.left && rect.top < panel.bottom && rect.bottom > panel.top);
    });
  }
  function scan(force = false) {
    if (contextLost || !messaging.check()) {
      get("status").textContent = "Extension reloaded or disconnected. Reload this Cengage tab to reconnect LearnFlow.";
      return;
    }
    const result = qaReadQuestion();
    get("parser-diagnostics").textContent=JSON.stringify(result.parserDiagnostics || {reason:result.reason},null,2);
    if (result.ok)watchMedia(result);
    if (!force && result.ok && current?.fingerprint === result.fingerprint) {current = result; renderAudioDebug(); return;}
    invalidate();
    current = result.ok ? result : null;
    get("detected").textContent = `Question detected: ${result.ok ? "Yes" : "No"}`;
    get("question").textContent = result.ok ? result.data.question : "";
    get("choices").replaceChildren();
    get("status").textContent = result.ok ? "Question detected" : result.reason;
    get("audio").textContent = result.ok ? (result.data.audio ? (result.data.audio.kind === "unsupported" ? "Audio required — clip unavailable" : "Audio detected: Yes — listening question") : "Audio detected: No — text question") : "Audio detected: Waiting for question";
    if (result.ok) {
      for (const choice of result.data.choices) {
        const li = document.createElement("li"); li.textContent = choice.text; get("choices").append(li);
      }
      console.info("[LearnFlow] Question detected:", result.data.question);
      console.info("[LearnFlow] Choices:", result.data.choices.map(c => `${c.answer}: ${c.text}`));
      if (!placement.hasPreferredPosition() && !collapsed && !fits(result.elements)) collapse(true);
      void analyze(force);
    } else console.info("[LearnFlow]", result.reason);
  }
  get('copy-parser-debug').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(get('parser-diagnostics').textContent);get('copy-parser-debug').textContent='Copied';}
    catch{get('copy-parser-debug').textContent='Select debug text and copy manually';}
  });
  get("toggle").addEventListener("click", () => {
    collapse(!collapsed);
  });
  get("again").addEventListener("click", () => {
    if (!connected && !contextLost) void start();
    else scan(true);
  });
  get("settings").addEventListener("click", () => {
    messaging.send({type:"QA_OPEN_SETTINGS"}).then(response => {
      if (!response?.ok) get("status").textContent = "Could not open Settings. Use the extension icon.";
    }).catch(() => {get("status").textContent = "Extension disconnected — reload this Cengage tab to reconnect LearnFlow.";});
  });
  observer = new MutationObserver(records => {
    if (records.every(record => record.target === host || host.contains(record.target))) return;
    const next = qaReadQuestion();
    if (current && (!next.ok || next.fingerprint !== current.fingerprint)) {
      invalidate();
      current = null; get("question").textContent = ""; get("choices").replaceChildren();
      get("detected").textContent = "Question detected: No";
      get("status").textContent = "Question changed — detecting…";
    }
    clearTimeout(timer); timer = setTimeout(scan, 200);
  });
  window.addEventListener("pagehide", () => {
    invalidate(); current = null; observer.disconnect(); clearInterval(healthTimer); clearTimeout(timer);
  });
  window.addEventListener("pageshow", event => {if (event.persisted && !contextLost) void start();});
  async function start() {
    try {
      const hello = await messaging.send({type:"QA_HELLO"});
      if (!hello?.ok) throw new Error("Worker handshake failed. Reload the extension, then this Cengage tab.");
      if (contextLost) return;
      connected = true;
      get("connection").textContent = `Connected: v${hello.version} · quiz frame ${hello.frameId}`;
      console.info("[LearnFlow] Worker connected", {version:hello.version, frameId:hello.frameId, origin:hello.origin});
      observer.observe(document.body, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:["class","style","hidden","aria-describedby","aria-label","aria-labelledby","for","name","id","src","type"]});
      clearInterval(healthTimer);
      healthTimer = setInterval(() => messaging.check(), 2000);
      scan();
    } catch (cause) {
      if (!contextLost) get("status").textContent = cause.message || "Worker unavailable. Reload the extension and Cengage tab.";
    }
  }
  if (!contextLost) void start();
})();
