import { useState, useRef } from 'react'
import axios from 'axios'
import {
  Upload, FileText, FileBadge2, ShieldCheck, ShieldX, AlertTriangle,
  CheckCircle2, XCircle, Clock, Download, Loader2, ChevronDown, ChevronRight,
  Info, Lock, Hash, User, Link2, FileSearch, ExternalLink,
} from 'lucide-react'

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(val) { return val ?? '—' }

function fmtDate(val) {
  if (!val) return '—'
  try { return new Date(val).toLocaleString() } catch { return val }
}

function truncHash(h) {
  if (!h) return '—'
  return h.length > 16 ? `${h.slice(0, 16)}…` : h
}

function fmtBytes(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

// ─── small atoms ─────────────────────────────────────────────────────────────

function StatusPill({ ok, label }) {
  return ok
    ? <span className="badge-green"><CheckCircle2 size={10} aria-hidden="true" />{label}</span>
    : <span className="badge-red"><XCircle size={10} aria-hidden="true" />{label}</span>
}

function InfoRow({ label, value, mono, title }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-navy-700/60 last:border-0">
      <span className="text-xs text-slate-500 font-medium shrink-0">{label}</span>
      <span
        className={`text-right break-all ${mono ? 'font-mono text-xs text-slate-400' : 'text-sm font-semibold text-slate-200'}`}
        title={title}
      >
        {value}
      </span>
    </div>
  )
}

function Collapsible({ icon: Icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/[0.03] transition-colors duration-150 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40 focus-visible:ring-inset"
        aria-expanded={open}
      >
        <span className="w-7 h-7 rounded-lg bg-navy-700 flex items-center justify-center shrink-0">
          <Icon size={13} className="text-slate-400" aria-hidden="true" />
        </span>
        <span className="flex-1 text-sm font-semibold text-slate-200">{title}</span>
        {open
          ? <ChevronDown size={14} className="text-slate-500 transition-transform duration-200" aria-hidden="true" />
          : <ChevronRight size={14} className="text-slate-500 transition-transform duration-200" aria-hidden="true" />
        }
      </button>
      {open && (
        <div className="px-5 pb-4 border-t border-navy-700/60 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── verdict banner ───────────────────────────────────────────────────────────

const VERDICT_CONFIG = {
  VALID: {
    bg:    'bg-emerald-500/10 border-emerald-500/30',
    icon:  ShieldCheck,
    icCls: 'text-emerald-400',
    iconBg:'bg-emerald-500/15',
    title: 'Document Valid',
    body:  'Cryptographic signature verified · Certificate chain trusted · Timestamp authentic',
  },
  INVALID: {
    bg:    'bg-red-500/10 border-red-500/30',
    icon:  ShieldX,
    icCls: 'text-red-400',
    iconBg:'bg-red-500/15',
    title: 'Verification Failed',
    body:  'One or more cryptographic checks failed. This document cannot be trusted.',
  },
  UNVERIFIABLE: {
    bg:    'bg-amber-500/10 border-amber-500/30',
    icon:  AlertTriangle,
    icCls: 'text-amber-400',
    iconBg:'bg-amber-500/15',
    title: 'Cannot Verify',
    body:  'Verification could not be completed. The document may be corrupt or unsupported.',
  },
}

function VerdictBanner({ verdict }) {
  const cfg = VERDICT_CONFIG[verdict] || VERDICT_CONFIG.UNVERIFIABLE
  const Icon = cfg.icon
  return (
    <div className={`flex items-center gap-5 p-5 rounded-2xl border ${cfg.bg} animate-scale-in`} role="alert">
      <div className={`w-14 h-14 rounded-2xl ${cfg.iconBg} flex items-center justify-center shrink-0`}>
        <Icon size={28} className={cfg.icCls} aria-hidden="true" />
      </div>
      <div>
        <p className={`text-xl font-bold ${cfg.icCls}`}>{cfg.title}</p>
        <p className="text-sm text-slate-400 mt-0.5 leading-relaxed">{cfg.body}</p>
      </div>
    </div>
  )
}

// ─── upload zone ─────────────────────────────────────────────────────────────

function UploadZone({ onResult }) {
  const [file, setFile]     = useState(null)
  const [drag, setDrag]     = useState(false)
  const [busy, setBusy]     = useState(false)
  const [err,  setErr]      = useState('')
  const inputRef = useRef()

  function accept(f) {
    if (!f) return
    setFile(f)
    setErr('')
  }

  async function verify() {
    if (!file) return
    setBusy(true)
    setErr('')
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await axios.post('/verify', form)
      onResult(data, file.name)
    } catch (e) {
      setErr(e.response?.data?.detail || 'Verification failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const isPdf = file?.name?.toLowerCase().endsWith('.pdf')
  const isXml = file?.name?.toLowerCase().endsWith('.xml')

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        onClick={() => !busy && inputRef.current.click()}
        onDrop={e => { e.preventDefault(); setDrag(false); accept(e.dataTransfer.files[0]) }}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        role="button"
        tabIndex={0}
        aria-label="Click or drag to upload a signed document"
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && inputRef.current.click()}
        className={[
          'relative rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer',
          'flex flex-col items-center justify-center gap-4 py-14 px-8',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50',
          drag
            ? 'border-gold-400/60 bg-gold-500/5 shadow-glow-gold-sm'
            : file
            ? 'border-violet-500/40 bg-violet-500/5'
            : 'border-navy-600 bg-navy-800/40 hover:border-navy-500 hover:bg-navy-800/60',
        ].join(' ')}
      >
        <input
          ref={inputRef} type="file" accept=".pdf,.xml"
          className="hidden" aria-hidden="true"
          onChange={e => accept(e.target.files[0])}
        />

        {file ? (
          <>
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${isPdf ? 'bg-gold-500/15 border border-gold-500/30' : 'bg-violet-500/15 border border-violet-500/30'}`}>
              {isPdf
                ? <FileText size={28} className="text-gold-400" aria-hidden="true" />
                : <FileBadge2 size={28} className="text-violet-400" aria-hidden="true" />
              }
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-200 text-sm">{file.name}</p>
              <p className="text-xs text-slate-500 mt-1">
                {fmtBytes(file.size)} · {isPdf ? 'PDF Document' : isXml ? 'XML Signature' : 'Document'}
              </p>
            </div>
            <span className="text-[11px] text-slate-600 font-medium">Click to replace</span>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-2xl bg-navy-700 border border-navy-600 flex items-center justify-center">
              <Upload size={26} className="text-slate-500" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-300">Drop your signed document here</p>
              <p className="text-xs text-slate-600 mt-1">PDF (PAdES) or XML (XAdES) · Max 20 MB</p>
            </div>
          </>
        )}

        {drag && (
          <div className="absolute inset-0 rounded-2xl bg-gold-500/5 flex items-center justify-center pointer-events-none">
            <p className="text-sm font-bold text-gold-400">Release to upload</p>
          </div>
        )}
      </div>

      {/* Error */}
      {err && (
        <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400 animate-fade-in">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {err}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {file && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { setFile(null); setErr('') }}
            disabled={busy}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={!file || busy}
          onClick={verify}
        >
          {busy
            ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Verifying…</>
            : <><ShieldCheck size={15} aria-hidden="true" /> Verify Document</>
          }
        </button>
      </div>

      {/* Trust signals */}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pt-1">
        {[
          { icon: FileSearch, label: 'pyHanko PAdES' },
          { icon: FileBadge2, label: 'lxml XAdES'    },
          { icon: Clock,      label: 'RFC 3161'       },
          { icon: Lock,       label: 'RS256'          },
        ].map(({ icon: I, label }) => (
          <span key={label} className="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium">
            <I size={11} className="text-slate-600" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── cert card ────────────────────────────────────────────────────────────────

function CertCard({ cert, index, isSigner, trusted }) {
  return (
    <div className="rounded-xl bg-navy-750 border border-navy-600/60 p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-navy-700 text-slate-400 font-mono">
          #{index + 1}
        </span>
        {isSigner && (
          <span className="badge-violet text-[10px]">
            <PenIcon /> Signer
          </span>
        )}
        {trusted && isSigner && (
          <span className="badge-green text-[10px]">
            <CheckCircle2 size={9} aria-hidden="true" /> Trusted CA
          </span>
        )}
        {cert.is_ca && (
          <span className="badge-gold text-[10px]">CA</span>
        )}
      </div>
      <div className="space-y-0">
        <InfoRow label="Subject" value={fmt(cert.subject)}  />
        <InfoRow label="Issuer"  value={fmt(cert.issuer)}   />
        <InfoRow label="Serial"  value={fmt(cert.serial)} mono />
        <InfoRow label="Valid"   value={cert.valid_from ? `${fmtDate(cert.valid_from)} → ${fmtDate(cert.valid_until)}` : '—'} />
      </div>
    </div>
  )
}

function PenIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  )
}

// ─── full report ─────────────────────────────────────────────────────────────

function VerificationReport({ result, filename, onReset }) {
  function exportJson() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `VaultIQ-Report-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sig  = result.signer_identity    || {}
  const ts   = result.timestamp_validity || {}
  const certs = result.cert_chain        || []

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="page-title">Verification Report</h2>
          <p className="text-xs text-slate-500 font-mono mt-1 truncate max-w-xs" title={filename}>
            {filename}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" className="btn-secondary text-xs" onClick={exportJson}>
            <Download size={13} aria-hidden="true" /> Export JSON
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={onReset}>
            <Upload size={13} aria-hidden="true" /> New Document
          </button>
        </div>
      </div>

      {/* Verdict */}
      <VerdictBanner verdict={result.overall_verdict} />

      {/* Quick checks grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Signature',  ok: result.signature_valid },
          { label: 'Certificate', ok: result.cert_trusted   },
          { label: 'Hash',        ok: result.hash_integrity?.intact },
          { label: 'Timestamp',   ok: ts.present            },
        ].map(({ label, ok }) => (
          <div key={label} className="card p-4 flex flex-col items-center gap-2.5 text-center">
            <span className="section-label">{label}</span>
            <StatusPill ok={!!ok} label={ok ? 'Valid' : 'Invalid'} />
          </div>
        ))}
      </div>

      {/* Document metadata */}
      <Collapsible icon={FileText} title="Document Metadata" defaultOpen>
        <div className="mt-3 space-y-0">
          <InfoRow label="Type"        value={fmt(result.document_type)} />
          <InfoRow label="Conformance" value={fmt(result.pades_conformance_level)} />
          <InfoRow
            label="SHA-256"
            value={truncHash(result.file_hash_sha256)}
            mono
            title={result.file_hash_sha256}
          />
          <InfoRow label="Verified At" value={fmtDate(result.verified_at)} />
        </div>
      </Collapsible>

      {/* Signer Identity */}
      <Collapsible icon={User} title="Signer Identity" defaultOpen>
        <div className="mt-3 space-y-0">
          <InfoRow label="Common Name"   value={sig.common_name} />
          <InfoRow label="Organization"  value={sig.organization} />
          <InfoRow label="Email"         value={sig.email} />
          <InfoRow label="Serial"        value={sig.serial_number} mono title={sig.serial_number} />
          <InfoRow label="Valid From"    value={fmtDate(sig.not_valid_before)} />
          <InfoRow label="Valid Until"   value={fmtDate(sig.not_valid_after)} />
        </div>
      </Collapsible>

      {/* Timestamp */}
      <Collapsible icon={Clock} title="Timestamp Authority (RFC 3161)">
        <div className="mt-3 space-y-0">
          {ts.present ? (
            <>
              <InfoRow label="Signing Time"    value={fmtDate(ts.timestamp)} />
              <InfoRow label="TSA"             value={fmt(ts.tsa)} />
              <InfoRow label="Hash Algorithm"  value={fmt(ts.hash_algorithm)} mono />
              <InfoRow label="Serial"          value={fmt(ts.serial_number)} mono />
              <InfoRow label="Token Valid"     value={ts.valid ? 'Yes' : 'No'} />
            </>
          ) : (
            <p className="text-xs text-slate-600 py-2">No RFC 3161 timestamp present in this document.</p>
          )}
        </div>
      </Collapsible>

      {/* Certificate chain */}
      <Collapsible icon={Link2} title={`Certificate Chain${certs.length ? ` (${certs.length})` : ''}`}>
        <div className="mt-3 space-y-3">
          {certs.length > 0
            ? certs.map((c, i) => (
                <CertCard
                  key={i}
                  cert={c}
                  index={i}
                  isSigner={i === 0}
                  trusted={result.cert_trusted && i === 0}
                />
              ))
            : <p className="text-xs text-slate-600 py-2">No certificate chain data available.</p>
          }
        </div>
      </Collapsible>

      {/* Validation details */}
      {result.details && (
        <Collapsible icon={Info} title="Validation Details">
          <ul className="mt-3 space-y-1.5">
            {(Array.isArray(result.details) ? result.details : String(result.details).split('. ').filter(Boolean))
              .map((d, i) => (
                <li
                  key={i}
                  className="text-[11px] font-mono text-slate-400 bg-navy-750 rounded-lg px-3 py-2 border border-navy-700/50"
                >
                  {d}
                </li>
              ))}
          </ul>
        </Collapsible>
      )}

      {/* Footer hint */}
      <div className="flex items-center justify-center gap-2 pt-2">
        <Lock size={11} className="text-slate-600" aria-hidden="true" />
        <p className="text-[11px] text-slate-600 text-center">
          Verification powered by pyHanko · lxml · freetsa.org RFC 3161
        </p>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [result,   setResult]   = useState(null)
  const [filename, setFilename] = useState('')

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">

      {/* Page header */}
      <div className="mb-8 flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center shrink-0 shadow-glow-violet">
          <ShieldCheck size={20} className="text-violet-400" aria-hidden="true" />
        </div>
        <div>
          <h1 className="page-title">Compliance Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Cryptographic verification of PAdES and XAdES signed documents
          </p>
        </div>
        {result && (
          <div className="ml-auto">
            <span className={result.overall_verdict === 'VALID' ? 'badge-green' : 'badge-red'}>
              {result.overall_verdict}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      {result
        ? <VerificationReport
            result={result}
            filename={filename}
            onReset={() => { setResult(null); setFilename('') }}
          />
        : <UploadZone
            onResult={(data, name) => { setResult(data); setFilename(name) }}
          />
      }
    </div>
  )
}
