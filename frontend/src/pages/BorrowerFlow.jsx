import { useState, useRef } from 'react'
import axios from 'axios'
import {
  Upload, FileImage, CheckCircle2, AlertCircle, Loader2,
  DollarSign, Calendar, FileText, Download, ArrowRight, ArrowLeft,
  ShieldCheck, Lock, Sparkles,
} from 'lucide-react'
import StepIndicator from '../components/StepIndicator'
import TrustScoreMeter from '../components/TrustScoreMeter'

const STEPS = ['Identity', 'Application', 'Risk Review', 'Agreement']

const PURPOSE_OPTIONS = [
  'Home Improvement', 'Debt Consolidation', 'Business', 'Education',
  'Medical', 'Vehicle Purchase', 'Personal', 'Other',
]

// ── helpers ──────────────────────────────────────────────────────────────────

function FieldError({ msg }) {
  if (!msg) return null
  return <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1"><AlertCircle size={12} />{msg}</p>
}

function InfoRow({ label, value, mono }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-navy-700 last:border-0">
      <span className="text-xs text-slate-500 font-medium">{label}</span>
      <span className={`text-sm font-semibold text-slate-200 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

// ── Step 1: KYC / Identity ────────────────────────────────────────────────────

function StepKYC({ onDone }) {
  const [file, setFile]       = useState(null)
  const [preview, setPreview] = useState(null)
  const [status, setStatus]   = useState('idle') // idle | loading | ok | err
  const [errMsg, setErrMsg]   = useState('')
  const [identity, setIdentity] = useState(null)
  const inputRef = useRef()

  function handleFile(f) {
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setStatus('idle')
    setErrMsg('')
    setIdentity(null)
  }

  function onDrop(e) {
    e.preventDefault()
    handleFile(e.dataTransfer.files[0])
  }

  async function submit() {
    if (!file) return
    setStatus('loading')
    setErrMsg('')
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await axios.post('/kyc/verify', form)
      setIdentity(data)
      setStatus('ok')
    } catch (e) {
      setStatus('err')
      setErrMsg(e.response?.data?.detail || 'KYC verification failed. Please try again.')
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-white">Identity Verification</h2>
        <p className="text-sm text-slate-400">Upload a clear photo of your government-issued ID</p>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current.click()}
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 overflow-hidden
          ${status === 'ok'
            ? 'border-emerald-500/50 bg-emerald-500/5'
            : 'border-navy-500 bg-navy-800/50 hover:border-brand/50 hover:bg-navy-700/50'
          }`}
        style={{ minHeight: 200 }}
      >
        <input
          ref={inputRef} type="file" accept="image/*"
          className="hidden"
          onChange={e => handleFile(e.target.files[0])}
        />
        {preview ? (
          <img src={preview} alt="ID preview" className="w-full h-52 object-cover" />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 p-10">
            <div className="w-14 h-14 rounded-2xl bg-navy-700 border border-navy-500 flex items-center justify-center">
              <FileImage size={24} className="text-slate-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-300">Drop your ID here</p>
              <p className="text-xs text-slate-500 mt-0.5">or click to browse · JPG, PNG, WEBP</p>
            </div>
          </div>
        )}

        {status === 'ok' && (
          <div className="absolute top-3 right-3 bg-emerald-500 rounded-full p-1">
            <CheckCircle2 size={14} className="text-white" />
          </div>
        )}
      </div>

      {/* Verified identity card */}
      {status === 'ok' && identity && (
        <div className="card p-4 space-y-1 animate-fade-in">
          <p className="section-title">Verified Identity</p>
          <InfoRow label="Full Name"    value={identity.name}     />
          <InfoRow label="Document ID"  value={identity.doc_id} mono />
          <InfoRow label="KYC Status"   value={identity.kyc_status} />
        </div>
      )}

      {/* Error */}
      {status === 'err' && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {errMsg}
        </div>
      )}

      <div className="flex gap-3">
        {file && status !== 'ok' && (
          <button
            className="btn-secondary flex-1"
            onClick={() => { setFile(null); setPreview(null); setStatus('idle') }}
          >
            Clear
          </button>
        )}
        {status === 'ok' ? (
          <button className="btn-primary flex-1" onClick={() => onDone(identity)}>
            Continue <ArrowRight size={15} />
          </button>
        ) : (
          <button
            className="btn-primary flex-1"
            disabled={!file || status === 'loading'}
            onClick={submit}
          >
            {status === 'loading'
              ? <><Loader2 size={15} className="animate-spin" /> Verifying…</>
              : <><ShieldCheck size={15} /> Verify Identity</>
            }
          </button>
        )}
      </div>

      <p className="text-center text-xs text-slate-600 flex items-center justify-center gap-1.5">
        <Lock size={11} /> Your document is processed locally and never stored
      </p>
    </div>
  )
}

// ── Step 2: Loan Application Form ─────────────────────────────────────────────

function StepLoanForm({ identity, onDone, onBack }) {
  const [form, setForm] = useState({ amount: '', purpose: '', duration_months: '12' })
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle')
  const [errMsg, setErrMsg] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })) }

  function validate() {
    const e = {}
    const amt = parseFloat(form.amount)
    if (!form.amount || isNaN(amt) || amt < 500)  e.amount   = 'Minimum loan amount is $500'
    if (amt > 500000)                              e.amount   = 'Maximum loan amount is $500,000'
    if (!form.purpose)                             e.purpose  = 'Please select a purpose'
    const dur = parseInt(form.duration_months)
    if (!dur || dur < 1 || dur > 360)              e.duration_months = 'Duration must be 1–360 months'
    return e
  }

  async function submit() {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setStatus('loading')
    setErrMsg('')
    try {
      const { data } = await axios.post('/loans/apply', {
        amount:          parseFloat(form.amount),
        purpose:         form.purpose,
        duration_months: parseInt(form.duration_months),
      }, {
        headers: { Authorization: `Bearer ${identity.token}` },
        validateStatus: s => s < 500,
      })

      if (data.status === 'BLOCKED') {
        setStatus('err')
        setErrMsg(data.message || 'Your application has been declined.')
        return
      }
      onDone(data)
    } catch (e) {
      setStatus('err')
      setErrMsg(e.response?.data?.detail || 'Submission failed. Please try again.')
    }
  }

  const monthlyEst = form.amount
    ? ((parseFloat(form.amount) * 0.08 / 12) / (1 - Math.pow(1 + 0.08 / 12, -parseInt(form.duration_months || 12)))).toFixed(2)
    : null

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-white">Loan Application</h2>
        <p className="text-sm text-slate-400">
          Applying as <span className="text-brand font-semibold">{identity.name}</span>
        </p>
      </div>

      <div className="card p-6 space-y-5">
        {/* Amount */}
        <div>
          <label className="label">Loan Amount</label>
          <div className="relative">
            <DollarSign size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="number" min="500" max="500000" placeholder="10,000"
              className="input pl-9"
              value={form.amount}
              onChange={e => set('amount', e.target.value)}
            />
          </div>
          <FieldError msg={errors.amount} />
        </div>

        {/* Purpose */}
        <div>
          <label className="label">Purpose</label>
          <select
            className="input appearance-none cursor-pointer"
            value={form.purpose}
            onChange={e => set('purpose', e.target.value)}
          >
            <option value="">Select purpose…</option>
            {PURPOSE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <FieldError msg={errors.purpose} />
        </div>

        {/* Duration */}
        <div>
          <label className="label flex justify-between">
            <span>Repayment Period</span>
            <span className="text-slate-400 font-normal">{form.duration_months} months</span>
          </label>
          <div className="relative">
            <Calendar size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="range" min="1" max="360" step="1"
              className="w-full h-2 rounded-full appearance-none bg-navy-600 accent-brand cursor-pointer"
              style={{ paddingLeft: 0, paddingRight: 0, border: 'none', background: 'none' }}
              value={form.duration_months}
              onChange={e => set('duration_months', e.target.value)}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-600 mt-1">
            <span>1 mo</span><span>360 mo</span>
          </div>
          <FieldError msg={errors.duration_months} />
        </div>

        {/* Monthly estimate */}
        {monthlyEst && !isNaN(monthlyEst) && (
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-brand/10 border border-brand/20">
            <span className="text-xs font-medium text-brand/80">Est. monthly payment</span>
            <span className="text-lg font-black text-brand">${monthlyEst}</span>
          </div>
        )}
      </div>

      {status === 'err' && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {errMsg}
        </div>
      )}

      <div className="flex gap-3">
        <button className="btn-secondary" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
        <button
          className="btn-primary flex-1"
          disabled={status === 'loading'}
          onClick={submit}
        >
          {status === 'loading'
            ? <><Loader2 size={15} className="animate-spin" /> Analysing…</>
            : <><Sparkles size={15} /> Submit & Analyse</>
          }
        </button>
      </div>
    </div>
  )
}

// ── Step 3: Risk Review ───────────────────────────────────────────────────────

const TIER_MESSAGES = {
  LOW:           { headline: 'Approved — Excellent Profile',   body: 'Your application meets all criteria. Proceed to download your loan agreement.' },
  MEDIUM:        { headline: 'Approved with Standard Terms',   body: 'Your application is approved. Review the agreement carefully before signing.' },
  HIGH:          { headline: 'Conditionally Approved',         body: 'Additional review recommended. You may still proceed but rates may be adjusted.' },
  MANUAL_REVIEW: { headline: 'Under Manual Review',            body: 'A compliance officer will review your application within 1 business day.' },
  BLOCKED:       { headline: 'Application Declined',           body: 'Unfortunately your application does not meet our current lending criteria.' },
}

function StepRiskReview({ loanData, identity, onDone, onBack }) {
  const [signing, setSigning] = useState(false)
  const [signErr, setSignErr] = useState('')

  const tier = loanData.risk_tier || 'MEDIUM'
  const msg  = TIER_MESSAGES[tier] || TIER_MESSAGES.MEDIUM
  const canProceed = ['LOW', 'MEDIUM', 'HIGH'].includes(tier)

  async function proceedToSign() {
    setSigning(true)
    setSignErr('')
    try {
      const { data } = await axios.post(
        `/loans/${loanData.loan_id}/sign`,
        {},
        { headers: { Authorization: `Bearer ${identity.token}` } }
      )
      onDone({ ...loanData, ...data })
    } catch (e) {
      setSignErr(e.response?.data?.detail || 'Signing failed. Please retry.')
      setSigning(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-white">AI Risk Assessment</h2>
        <p className="text-sm text-slate-400">Powered by Amazon Nova · Bedrock</p>
      </div>

      {/* Score meter */}
      <div className="card p-8 flex flex-col items-center gap-4">
        <TrustScoreMeter score={loanData.trust_score ?? 0} tier={tier} />

        <div className="w-full mt-2 space-y-0.5">
          <p className="font-bold text-white text-center">{msg.headline}</p>
          <p className="text-sm text-slate-400 text-center">{msg.body}</p>
        </div>
      </div>

      {/* Loan summary */}
      <div className="card p-4 space-y-0.5">
        <p className="section-title">Application Summary</p>
        <InfoRow label="Loan ID"   value={`#${loanData.loan_id}`}  mono />
        <InfoRow label="Amount"    value={`$${Number(loanData.amount).toLocaleString()}`} />
        <InfoRow label="Purpose"   value={loanData.purpose} />
        <InfoRow label="Term"      value={`${loanData.duration_months} months`} />
      </div>

      {/* AI narrative */}
      {loanData.risk_narrative && (
        <div className="card p-4 space-y-2">
          <p className="section-title flex items-center gap-1.5"><Sparkles size={11} /> AI Narrative</p>
          <p className="text-sm text-slate-300 leading-relaxed">{loanData.risk_narrative}</p>
        </div>
      )}

      {signErr && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {signErr}
        </div>
      )}

      <div className="flex gap-3">
        <button className="btn-secondary" onClick={onBack} disabled={signing}>
          <ArrowLeft size={15} /> Back
        </button>
        {canProceed && (
          <button className="btn-primary flex-1" disabled={signing} onClick={proceedToSign}>
            {signing
              ? <><Loader2 size={15} className="animate-spin" /> Signing…</>
              : <><FileText size={15} /> Generate & Sign Agreement</>
            }
          </button>
        )}
      </div>
    </div>
  )
}

// ── Step 4: Agreement Download ────────────────────────────────────────────────

function StepAgreement({ loanData, identity }) {
  const [downloading, setDownloading] = useState(null) // null | 'unsigned' | 'signed'
  const [dlErr, setDlErr]             = useState('')

  async function download(type) {
    setDownloading(type)
    setDlErr('')
    try {
      const path = type === 'signed'
        ? `/loans/${loanData.loan_id}/download-signed`
        : `/loans/${loanData.loan_id}/download-unsigned`

      const resp = await axios.get(path, {
        headers:      { Authorization: `Bearer ${identity.token}` },
        responseType: 'blob',
      })

      const ext  = type === 'signed' ? 'pades-t.pdf' : 'unsigned.pdf'
      const url  = URL.createObjectURL(resp.data)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `VaultIQ-Loan-${loanData.loan_id}-${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setDlErr('Download failed. Please try again.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-white">Loan Agreement Ready</h2>
        <p className="text-sm text-slate-400">Your digitally-signed agreement is available for download</p>
      </div>

      {/* Success banner */}
      <div className="card-glow p-6 flex flex-col items-center gap-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shadow-glow-sm">
          <CheckCircle2 size={30} className="text-emerald-400" />
        </div>
        <div>
          <p className="font-bold text-white text-lg">All Signatures Applied</p>
          <p className="text-sm text-slate-400 mt-1">PAdES-B · PAdES-T · XAdES-T</p>
        </div>
        <div className="w-full grid grid-cols-3 gap-2 mt-2">
          {['PAdES-B', 'PAdES-T', 'XAdES-T'].map(label => (
            <div key={label} className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-navy-700 border border-navy-600">
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span className="text-xs font-semibold text-slate-300">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Download buttons */}
      <div className="space-y-3">
        <button
          className="btn-primary w-full justify-center"
          onClick={() => download('signed')}
          disabled={!!downloading}
        >
          {downloading === 'signed'
            ? <><Loader2 size={15} className="animate-spin" /> Preparing…</>
            : <><Download size={15} /> Download Signed Agreement (PAdES-T)</>
          }
        </button>

        <button
          className="btn-secondary w-full justify-center"
          onClick={() => download('unsigned')}
          disabled={!!downloading}
        >
          {downloading === 'unsigned'
            ? <><Loader2 size={15} className="animate-spin" /> Preparing…</>
            : <><FileText size={15} /> Download Unsigned Copy</>
          }
        </button>
      </div>

      {dlErr && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {dlErr}
        </div>
      )}

      {/* Details */}
      <div className="card p-4">
        <p className="section-title">Transaction Details</p>
        <InfoRow label="Loan ID"        value={`#${loanData.loan_id}`}  mono />
        <InfoRow label="Amount"         value={`$${Number(loanData.amount).toLocaleString()}`} />
        <InfoRow label="Borrower"       value={identity.name} />
        <InfoRow label="Signing Status" value="Completed" />
      </div>

      <p className="text-center text-xs text-slate-600 flex items-center justify-center gap-1.5">
        <Lock size={11} />
        Documents are timestamped via RFC 3161 · freetsa.org
      </p>
    </div>
  )
}

// ── Main BorrowerFlow ─────────────────────────────────────────────────────────

export default function BorrowerFlow() {
  const [step, setStep]         = useState(0)
  const [identity, setIdentity] = useState(null)
  const [loanData, setLoanData] = useState(null)
  const [signedData, setSignedData] = useState(null)

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <StepIndicator steps={STEPS} current={step} />

      <div className="animate-slide-up">
        {step === 0 && (
          <StepKYC onDone={identity => { setIdentity(identity); setStep(1) }} />
        )}
        {step === 1 && identity && (
          <StepLoanForm
            identity={identity}
            onBack={() => setStep(0)}
            onDone={data => { setLoanData(data); setStep(2) }}
          />
        )}
        {step === 2 && loanData && (
          <StepRiskReview
            loanData={loanData}
            identity={identity}
            onBack={() => setStep(1)}
            onDone={data => { setSignedData(data); setStep(3) }}
          />
        )}
        {step === 3 && (signedData || loanData) && (
          <StepAgreement
            loanData={signedData || loanData}
            identity={identity}
          />
        )}
      </div>
    </div>
  )
}
