"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Film,
  Globe2,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Unplug,
  XCircle
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

interface TelegramStatus {
  connected: boolean;
  loginPending?: boolean;
  user?: {
    id: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  };
}

interface DownloadJob {
  id: string;
  source: "TELEGRAM" | "WEB";
  sourceUrl: string;
  state: "PENDING" | "DOWNLOADING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELED";
  progress: number;
  downloadedBytes: string;
  totalBytes: string;
  speedBps: string;
  etaSeconds: number | null;
  fileName: string | null;
  error: string | null;
  mediaId: string | null;
  createdAt: string;
}

const formatBytes = (value: string | number) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

const formatEta = (seconds: number | null) => {
  if (seconds === null || seconds < 0) return "Tempo restante in calcolo";
  if (seconds < 60) return `${seconds}s rimanenti`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s rimanenti`;
};

const stateLabel: Record<DownloadJob["state"], string> = {
  PENDING: "In coda",
  DOWNLOADING: "Download in corso",
  PROCESSING: "Aggiunta alla libreria",
  COMPLETED: "Completato",
  FAILED: "Errore",
  CANCELED: "Annullato"
};

function FrameoMark() {
  return <span className="brand-mark"><span /><span /><span /></span>;
}

export function DownloadCenter() {
  const [status, setStatus] = useState<TelegramStatus>({ connected: false });
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [authStep, setAuthStep] = useState<"credentials" | "code" | "password">("credentials");
  const [delivery, setDelivery] = useState<"app" | "sms" | "call" | "other" | null>(null);
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [telegramUrl, setTelegramUrl] = useState("");
  const [webUrl, setWebUrl] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [statusResponse, jobsResponse] = await Promise.all([
        fetch("/api/downloads/status", { cache: "no-store" }),
        fetch("/api/downloads", { cache: "no-store" })
      ]);
      const statusPayload = await statusResponse.json();
      const jobsPayload = await jobsResponse.json();
      setStatus(statusPayload.telegram ?? { connected: false });
      if (statusPayload.telegram?.loginPending) setAuthStep((current) => current === "credentials" ? "code" : current);
      setJobs(jobsPayload.jobs ?? []);
    } catch {
      if (!quiet) setError("Frameo non riesce a leggere lo stato dei download.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const hasActivity = jobs.some((job) => ["PENDING", "DOWNLOADING", "PROCESSING"].includes(job.state));
    const timer = window.setInterval(() => void refresh(true), hasActivity ? 1200 : 5000);
    return () => window.clearInterval(timer);
  }, [jobs, refresh]);

  const activeCount = useMemo(
    () => jobs.filter((job) => ["PENDING", "DOWNLOADING", "PROCESSING"].includes(job.state)).length,
    [jobs]
  );

  const postJson = async (url: string, body?: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Operazione non riuscita");
    return payload;
  };

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await postJson("/api/downloads/telegram/request-code", { apiId, apiHash, phone });
      if (result.authorized) {
        await refresh();
      } else {
        setDelivery(result.delivery === "app" || result.delivery === "sms" || result.delivery === "call" ? result.delivery : "other");
        setAuthStep("code");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Accesso Telegram non riuscito");
    } finally { setBusy(false); }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await postJson("/api/downloads/telegram/verify", {
        code: authStep === "code" ? code : "",
        password: authStep === "password" ? password : undefined
      });
      if (result.passwordRequired) {
        setAuthStep("password");
      } else {
        setCode(""); setPassword("");
        await refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Verifica non riuscita");
    } finally { setBusy(false); }
  };

  const enqueue = async (event: FormEvent) => {
    event.preventDefault();
    if (!telegramUrl.trim()) return;
    setBusy(true); setError("");
    try {
      await postJson("/api/downloads", { source: "telegram", url: telegramUrl.trim() });
      setTelegramUrl("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Download non avviato");
    } finally { setBusy(false); }
  };

  const enqueueWeb = async (event: FormEvent) => {
    event.preventDefault();
    if (!webUrl.trim()) return;
    setBusy(true); setError("");
    try {
      await postJson("/api/downloads", { source: "web", url: webUrl.trim() });
      setWebUrl("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Download non avviato");
    } finally { setBusy(false); }
  };

  return (
    <div className="download-page">
      <aside className="download-sidebar">
        <a className="download-brand" href="/"><FrameoMark /><strong>Frameo</strong></a>
        <a className="download-back" href="/"><ArrowLeft size={17} /> Torna alla libreria</a>
        <nav>
          <p>SORGENTI</p>
          <a className="download-source-link" href="#telegram-source"><Send size={18} /> Telegram <i className={status.connected ? "is-online" : ""} /></a>
          <a className="download-source-link" href="#web-source"><Globe2 size={18} /> Pagina web</a>
        </nav>
        <div className="download-sidebar-note">
          <ShieldCheck size={18} />
          <span><strong>Download privati</strong><small>Credenziali e sessione restano nello storage locale di Frameo.</small></span>
        </div>
      </aside>

      <main className="download-main">
        <header className="download-header">
          <div><span>INGESTIONE MEDIA</span><h1>Download center</h1><p>Porta video da fonti esterne direttamente nella tua libreria.</p></div>
          <div className="download-header-status"><span>{activeCount}</span><small>{activeCount === 1 ? "trasferimento attivo" : "trasferimenti attivi"}</small></div>
        </header>

        {error ? <div className="download-error"><XCircle size={18} /><span>{error}</span><button onClick={() => setError("")}>Chiudi</button></div> : null}

        <section id="telegram-source" className="source-panel telegram-panel">
          <div className="source-panel-heading">
            <span className="telegram-icon"><Send size={23} fill="currentColor" /></span>
            <div><p>TELEGRAM</p><h2>{status.connected ? "Scarica da un messaggio" : "Collega il tuo account"}</h2></div>
            {status.connected ? <span className="connection-pill"><i /> Connesso</span> : <span className="connection-pill is-offline">Non connesso</span>}
          </div>

          {loading ? <div className="download-loading"><LoaderCircle className="spin" size={20} /> Controllo la sessione Telegram…</div> : status.connected ? (
            <div className="telegram-connected">
              <div className="telegram-account">
                <span>{(status.user?.firstName?.[0] ?? status.user?.username?.[0] ?? "T").toUpperCase()}</span>
                <div><strong>{[status.user?.firstName, status.user?.lastName].filter(Boolean).join(" ") || status.user?.username || "Account Telegram"}</strong><small>{status.user?.username ? `@${status.user.username}` : status.user?.phone}</small></div>
                <button onClick={async () => { setBusy(true); await postJson("/api/downloads/telegram/disconnect"); await refresh(); setBusy(false); }} disabled={busy}><Unplug size={15} /> Scollega</button>
              </div>
              <form className="download-url-form" onSubmit={enqueue}>
                <label><span>Link del messaggio Telegram</span><div><Link2 size={18} /><input type="url" value={telegramUrl} onChange={(event) => setTelegramUrl(event.target.value)} placeholder="https://t.me/c/123456789/42" required /><button disabled={busy || !telegramUrl.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} Scarica</button></div></label>
                <p><Check size={13} /> Funziona con canali pubblici, gruppi e canali privati ai quali il tuo account ha accesso.</p>
              </form>
            </div>
          ) : authStep === "credentials" ? (
            <form className="telegram-auth" onSubmit={requestCode}>
              <div className="auth-explainer"><KeyRound size={21} /><span><strong>Credenziali Telegram API</strong><small>Creale una sola volta su <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">my.telegram.org/apps <ExternalLink size={11} /></a>. Non sono le credenziali di un bot.</small></span></div>
              <div className="auth-grid">
                <label><span>API ID</span><input inputMode="numeric" value={apiId} onChange={(event) => setApiId(event.target.value)} placeholder="12345678" required /></label>
                <label><span>API Hash</span><input value={apiHash} onChange={(event) => setApiHash(event.target.value)} placeholder="a1b2c3d4…" required /></label>
                <label className="auth-phone"><span>Numero di telefono</span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+393331234567" required /></label>
              </div>
              <button className="auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Smartphone size={17} />} Invia il codice</button>
            </form>
          ) : (
            <form className="telegram-auth verify-auth" onSubmit={verify}>
              <div className="auth-explainer">{authStep === "code" ? <Smartphone size={21} /> : <LockKeyhole size={21} />}<span><strong>{authStep === "code" ? "Inserisci il codice ricevuto" : "Verifica in due passaggi"}</strong><small>{authStep === "code" ? delivery === "app" ? "Telegram indica che il codice è stato inviato nella chat ufficiale Telegram, su un dispositivo già connesso." : delivery === "sms" ? "Telegram indica che il codice è stato inviato via SMS." : delivery === "call" ? "Telegram indica che il codice sarà comunicato con una chiamata." : "Inserisci il codice ricevuto da Telegram. Se hai ricaricato la pagina, il tipo di invio non è più visibile." : "L'account richiede anche la password 2FA."}</small></span></div>
              <label><span>{authStep === "code" ? "Codice Telegram" : "Password 2FA"}</span><input autoFocus type={authStep === "password" ? "password" : "text"} inputMode={authStep === "code" ? "numeric" : undefined} value={authStep === "code" ? code : password} onChange={(event) => authStep === "code" ? setCode(event.target.value) : setPassword(event.target.value)} required /></label>
              <div><button type="button" onClick={() => setAuthStep("credentials")}>Ricomincia</button><button className="auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Verifica</button></div>
            </form>
          )}
        </section>

        <section id="web-source" className="source-panel web-panel">
          <div className="source-panel-heading">
            <span className="web-icon"><Globe2 size={23} /></span>
            <div><p>PAGINA WEB</p><h2>Scarica un video da un link</h2></div>
            <span className="connection-pill"><i /> Pronto</span>
          </div>
          <div className="web-source-content">
            <form className="download-url-form" onSubmit={enqueueWeb}>
              <label><span>Link della pagina o del video</span><div><Link2 size={18} /><input type="url" value={webUrl} onChange={(event) => setWebUrl(event.target.value)} placeholder="https://esempio.com/pagina-con-video" required /><button disabled={busy || !webUrl.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} Scarica</button></div></label>
              <p><Check size={13} /> Frameo cerca video nelle pagine. Supporta cartelle Gofile pubbliche con un video e album Bunkr con più video.</p>
            </form>
            <p className="web-source-note">Funziona anche con link diretti a file video. Alcuni siti non sono supportati; video protetti da DRM, accesso privato o abbonamento non possono essere scaricati con questa funzione.</p>
          </div>
        </section>

        <section className="download-queue">
          <header><div><p>ATTIVITÀ</p><h2>Coda download</h2></div><button onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={15} /> Aggiorna</button></header>
          {jobs.length ? <div className="job-list">{jobs.map((job) => (
            <article className={`download-job is-${job.state.toLowerCase()}`} key={job.id}>
              <span className="job-icon">{job.state === "COMPLETED" ? <CheckCircle2 size={20} /> : job.state === "FAILED" ? <XCircle size={20} /> : job.state === "DOWNLOADING" ? <Download size={20} /> : job.state === "PROCESSING" ? <Film size={20} /> : <Clock3 size={20} />}</span>
              <div className="job-body">
                <div className="job-title"><span><strong>{job.fileName || (job.source === "WEB" ? job.sourceUrl : "Messaggio Telegram")}</strong><small>{job.source === "WEB" ? "Pagina web" : "Telegram"} · {stateLabel[job.state]} · {new Date(job.createdAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</small></span><b>{job.progress}%</b></div>
                <div className="job-progress"><i style={{ width: `${job.progress}%` }} /></div>
                <div className="job-meta"><span>{formatBytes(job.downloadedBytes)}{Number(job.totalBytes) ? ` / ${formatBytes(job.totalBytes)}` : ""}</span>{job.state === "DOWNLOADING" ? <span>{formatBytes(job.speedBps)}/s · {formatEta(job.etaSeconds)}</span> : null}{job.error ? <span className="job-error">{job.error}</span> : null}</div>
              </div>
              {job.state === "FAILED" || job.state === "CANCELED" ? <button className="retry-job" onClick={async () => { setBusy(true); setError(""); try { await postJson(`/api/downloads/${job.id}/retry`); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Nuovo tentativo non riuscito"); } finally { setBusy(false); } }} disabled={busy}><RefreshCw size={14} /> Riprova</button> : job.mediaId ? <a className="open-library" href="/"><Play size={14} /> Libreria</a> : null}
            </article>
          ))}</div> : <div className="empty-downloads"><Download size={28} /><strong>Nessun download ancora</strong><span>Incolla il link di una pagina web oppure di un messaggio Telegram con un video.</span></div>}
        </section>
      </main>
    </div>
  );
}
