import { useState, useRef } from 'react'
import axios from 'axios'
import {
  Upload, FileText, FileBadge2, ShieldCheck, ShieldX, AlertTriangle,
  CheckCircle2, XCircle, Clock, Download, Loader2, ChevronDown,
  ChevronRight, Info, Lock, Hash, User, Calendar,
} from 'lucide-react'

// ── helpers ──────────────────────────────────────────────────────────────────

function Pill({ ok, label }) {
  return (
    <span className={`badge ${ok ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
      {ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
      {label}
    </span>
  )
}

function VerdictBanner({ verdict }) {
  const valid = verdict === 'VALID'
  const warn  = verdict === 'INVALID_TIMESTAMP'

  if (valid) return (
    <div className="flex items-center gap-4 p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30">
      <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
        <ShieldCheck size={24} className="text-emerald-400" />
      </div>
      <div>
        <p className="font-bold text-emerald-400 text-lg">Document Valid</p>
        <p className="text-sm text-slate-400">Signature verified · Certificate trusted · Timestamp authentic</p>
      </div>
    </div>
  )

  if (warn) return (
    <div className="flex items-center gap-4 p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30">
      <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
        <AlertTriangle size={24} className="text-amber-400" />
      </div>
      <div>
        <p className="font-bold text-amber-400 text-lg">Signature Valid — Timestamp Warning</p>
        <p className="text-sm text-slate-400">Signature cryptographically valid but timestamp could not be fully verified</p>
      </div>
    </div>
  )

  return (
    <div className="flex items-center gap-4 p-5 rounded-2xl bg-red-500/10 border border-red-500/30">
      <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0">
        <ShieldX size={24} className="text-red-400" />
      </div>
      <div>
        <p className="font-bold text-red-400 text-lg">Verification Failed</p>
        <p className="text-sm text-slate-400">{verdict === 'UNVERIFIABLE' ? 'Document could not be verified' : 'Signature or certificate is invalid'}</p>
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value, mono, code }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-navy-700 last:border-0">
      {Icon && <Icon size={14} className="text-slate-500 mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 font-medium mb-0.5">{label}</p>
        <p className={`text-sm text-slate-200 break-all ${mono || code ? 'font-mono text-xs' : 'font-semibold'}`}>{value ?? '—'}</p>
      </div>
    </div>
  )
}

function Collapsible({ title, icon: Icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-navy-700/50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        {Icon && <Icon size={15} className="text-brand shrink-0" />}
        <span className="flex-1 text-sm font-semibold text-slate-200">{title}</span>
        {open ? <ChevronDown size={15} className="text-slate-500" /> : <ChevronRight size={15} className="text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-4 border-t border-navy-700">{children}</div>}
    </div>
  )
}

// ── Upload zone ───────────────────────────────────────────────────────────────

function UploadZone({ onResult }) {
  const [file, setFile]   = useState(null)
  const [status, setStatus] = useState('idle') // idle | loading | ok | err
  const [errMsg, setErrMsg] = useState('')
  const inputRef = useRef()

  function handleFile(f) {
    if (!f) return
    setFile(f)
    setStatus('idle')
    setErrMsg('')
  }

  async function verify() {
    if (!file) return
    setStatus('loading')
    setErrMsg('')
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await axios.post('/verify', form)
      setStatus('ok')
      onResult(data, file.name)
    } catch (e) {
      setStatus('err')
      setErrMsg(e.response?.data?.detail || 'Verification failed. Please try again.')
    }
  }

  const isPdf = file?.name?.toLowerCase().endsWith('.pdf')
  const isXml = file?.name?.toLowerCase().endsWith('.xml')

  return (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-white">Document Verification</h2>
        <p className="text-sm text-slate-400">Upload a signed PDF (PAdES) or XML (XAdES) document</p>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current.click()}
        onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
        onDragOver={e => e.preventDefault()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 p-10
          flex flex-col items-center gap-4
          ${file
            ? 'border-brand/50 bg-brand/5'
            : 'border-navy-500 bg-navy-800/50 hover:border-brand/40 hover:bg-navy-700/40'
          }`}
      >
        <input
          ref={inputRef} type="file" accept=".pdf,.xml"
          className="hidden"
          onChange={e => handleFile(e.target.files[0])}
        />
        <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center
          ${file ? 'bg-brand/15 border-brand/30' : 'bg-navy-700 border-navy-500'}`}>
          {file
            ? (isPdf ? <FileText size={28} className="text-brand" /> : <FileBadge2 size={28} className="text-brand" />)
            : <Upload size={28} className="text-slate-400" />
          }
        </div>
        {file ? (
          <div className="text-center">
            <p className="font-semibold text-slate-200">{file.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {(file.size / 1024).toFixed(1)} KB · {isPdf ? 'PDF Document' : isXml ? 'XML Document' : 'Document'}
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm font-medium text-slate-300">Drop your document here</p>
            <p className="text-xs text-slate-500 mt-0.5">or click to browse · PDF or XML</p>
          </div>
        )}
      </div>

      {status === 'err' && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {errMsg}
        </div>
      )}

      <div className="flex gap-3">
        {file && (
          <button className="btn-secondary" onClick={() => { setFile(null); setStatus('idle') }}>
            Clear
          </button>
        )}
        <button
          className="btn-primary flex-1"
          disabled={!file || status === 'loading'}
          onClick={verify}
        >
          {status === 'loading'
            ? <><Loader2 size={15} className="animate-spin" /> Verifying…</>
            : <><ShieldCheck size={15} /> Verify Document</>
          }
        </button>
      </div>
    </div>
  )
}

// ── Verification Report ───────────────────────────────────────────────────────

function VerificationReport({ result, filename, onReset }) {
  function exportJson() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `VaultIQ-VerifyReport-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sig    = result.signer_identity    || {}
  const ts     = result.timestamp_validity || {}
  const certs  = result.cert_chain         || []

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Verification Report</h2>
          <p className="text-sm text-slate-500 mt-0.5 font-mono">{filename}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={exportJson}>
            <Download size={13} /> Export JSON
          </button>
          <button className="btn-ghost text-xs" onClick={onReset}>
            ← New Document
          </button>
        </div>
      </div>

      {/* Verdict banner */}
      <VerdictBanner verdict={result.overall_verdict} />

      {/* Quick checks */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-3 flex flex-col items-center gap-2 text-center">
          <span className="text-xs text-slate-500 font-medium">Signature</span>
          <Pill ok={result.signature_valid} label={result.signature_valid ? 'Valid' : 'Invalid'} />
        </div>
        <div className="card p-3 flex flex-col items-center gap-2 text-center">
          <span className="text-xs text-slate-500 font-medium">Certificate</span>
          <Pill ok={result.cert_trusted} label={result.cert_trusted ? 'Trusted' : 'Untrusted'} />
        </div>
        <div className="card p-3 flex flex-col items-center gap-2 text-center">
          <span className="text-xs text-slate-500 font-medium">Hash</span>
          <Pill ok={result.hash_integrity} label={result.hash_integrity ? 'Intact' : 'Tampered'} />
        </div>
        <div className="card p-3 flex flex-col items-center gap-2 text-center">
          <span className="text-xs text-slate-500 font-medium">Timestamp</span>
          <Pill ok={ts.valid} label={ts.valid ? 'Valid' : 'Invalid'} />
        </div>
      </div>

      {/* Document metadata */}
      <Collapsible title="Document Metadata" icon={FileText} defaultOpen>
        <div className="mt-3 space-y-0">
          <InfoRow icon={FileBadge2} label="Document Type"   value={result.document_type} />
          {result.pades_conformance_level && (
            <InfoRow icon={ShieldCheck} label="PAdES Level" value={result.pades_conformance_level} />
          )}
          <InfoRow icon={Calendar} label="Verified At" value={result.verified_at ? new Date(result.verified_at).toLocaleString() : '—'} />
        </div>
      </Collapsible>

      {/* Signer identity */}
      <Collapsible title="Signer Identity" icon={User} defaultOpen>
        <div className="mt-3 space-y-0">
          <InfoRow icon={User}    label="Common Name"   value={sig.common_name} />
          <InfoRow icon={Info}    label="Organization"  value={sig.organization} />
          <InfoRow icon={Info}    label="Country"       value={sig.country} />
          <InfoRow icon={Hash}    label="Serial Number" value={sig.serial_number} mono />
          <InfoRow icon={Calendar} label="Valid From"   value={sig.not_valid_before} />
          <InfoRow icon={Calendar} label="Valid Until"  value={sig.not_valid_after} />
        </div>
      </Collapsible>

      {/* Timestamp */}
      <Collapsible title="Timestamp Authority" icon={Clock}>
        <div className="mt-3 space-y-0">
          <InfoRow icon={Clock}    label="Signing Time"  value={ts.signing_time} />
          <InfoRow icon={Info}     label="TSA"           value={ts.tsa} />
          <InfoRow icon={Hash}     label="Hash Algorithm" value={ts.hash_algorithm} mono />
          <InfoRow icon={Info}     label="Serial"        value={ts.serial_number} mono />
        </div>
      </Collapsible>

      {/* Certificate chain */}
      {certs.length > 0 && (
        <Collapsible title={`Certificate Chain (${certs.length})`} icon={Lock}>
          <div className="mt-3 space-y-3">
            {certs.map((cert, i) => (
              <div key={i} className="rounded-xl bg-navy-700/50 border border-navy-600 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-navy-600 text-slate-400">
                    #{i + 1}
                  </span>
                  <span className="text-sm font-semibold text-slate-200">{cert.subject?.common_name || cert.subject}</span>
                </div>
                {cert.issuer && (
                  <p className="text-xs text-slate-500">
                    Issued by: {cert.issuer?.common_name || cert.issuer}
                  </p>
                )}
                {cert.thumbprint && (
                  <p className="text-xs font-mono text-slate-600 break-all">{cert.thumbprint}</p>
                )}
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      {/* Details / raw messages */}
      {result.details && result.details.length > 0 && (
        <Collapsible title="Validation Details" icon={Info}>
          <ul className="mt-3 space-y-1.5">
            {result.details.map((d, i) => (
              <li key={i} className="text-xs text-slate-400 font-mono bg-navy-700/50 rounded-lg px-3 py-2">
                {d}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
    </div>
  )
}

// ── Main AdminDashboard ───────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [result,   setResult]   = useState(null)
  const [filename, setFilename] = useState('')

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
            <ShieldCheck size={16} className="text-violet-400" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Compliance Dashboard</h1>
        </div>
        <p className="text-sm text-slate-500 ml-11">Cryptographic verification of PAdES and XAdES documents</p>
      </div>

      {result
        ? <VerificationReport
            result={result}
            filename={filename}
            onReset={() => { setResult(null); setFilename('') }}
          />
        : <UploadZone onResult={(data, name) => { setResult(data); setFilename(name) }} />
      }
    </div>
  )
}
