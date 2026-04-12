import { useState, useRef, useCallback } from 'react'
import axios from 'axios'
import {
  Upload,
  FileImage,
  CheckCircle2,
  AlertCircle,
  Loader2,
  DollarSign,
  Calendar,
  FileText,
  Download,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Lock,
  Sparkles,
  User,
  CreditCard,
  BadgeCheck,
  PenLine,
  ExternalLink,
  TrendingUp,
  Clock,
  Hash,
} from 'lucide-react'
import StepIndicator from '../components/StepIndicator'
import TrustScoreMeter from '../components/TrustScoreMeter'

// ── Constants ──────────────────────────────────────────────────────────────────

const STEPS = ['Identity', 'Application', 'Risk Review', 'Agreement']

const PURPOSE_OPTIONS = [
  'Home Improvement',
  'Debt Consolidation',
  'Business',
  'Education',
  'Medical',
  'Vehicle Purchase',
  'Personal',
  'Other',
]

const TIER_CONFIG = {
  LOW: {
    headline: 'Approved — Excellent Profile',
    body:     'Your credit profile meets all underwriting criteria. Your agreement is ready to sign.',
    color:    'text-emerald-400',
    border:   'border-emerald-500/30',
    bg:       'bg-emerald-500/8',
    badgeClass: 'badge-green',
    dot:      'bg-emerald-400',
  },
  MEDIUM: {
    headline: 'Conditionally Approved',
    body:     'Your application is approved under standard terms. Review all conditions in the agreement.',
    color:    'text-gold-400',
    border:   'border-gold-500/30',
    bg:       'bg-gold-500/8',
    badgeClass: 'badge-gold',
    dot:      'bg-gold-400',
  },
  HIGH: {
    headline: 'Elevated Risk — Analyst Review',
    body:     'Your application has been flagged for elevated risk. You may proceed, but adjusted terms will apply.',
    color:    'text-orange-400',
    border:   'border-orange-500/30',
    bg:       'bg-orange-500/8',
    badgeClass: 'badge-orange',
    dot:      'bg-orange-400',
  },
  MANUAL_REVIEW: {
    headline: 'Under Manual Review',
    body:     'A compliance officer will review your application within 1 business day. We will notify you by email.',
    color:    'text-violet-400',
    border:   'border-violet-500/30',
    bg:       'bg-violet-500/8',
    badgeClass: 'badge-violet',
    dot:      'bg-violet-400',
  },
  BLOCKED: {
    headline: 'Application Declined',
    body:     'Unfortunately your application does not meet our current lending criteria. You may reapply after 90 days.',
    color:    'text-red-400',
    border:   'border-red-500/30',
    bg:       'bg-red-500/8',
    badgeClass: 'badge-red',
    dot:      'bg-red-400',
  },
}

const SIGNING_STEPS = [
  { key: 'pades_b', label: 'PAdES-B', desc: 'Baseline signature' },
  { key: 'pades_t', label: 'PAdES-T', desc: 'RFC 3161 timestamp' },
  { key: 'xades_t', label: 'XAdES-T', desc: 'XML advanced signature' },
]

// ── Reusable micro-components ─────────────────────────────────────────────────

function FieldError({ msg }) {
  if (!msg) return null
  return (
    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1.5" role="alert">
      <AlertCircle size={11} aria-hidden="true" />
      {msg}
    </p>
  )
}

function InfoRow({ label, value, mono = false, highlight = false }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-navy-700 last:border-0">
      <span className="text-xs text-slate-500 font-medium">{label}</span>
      <span
        className={[
          'text-sm font-semibold',
          mono      ? 'font-mono text-slate-300' : 'text-slate-200',
          highlight ? 'text-gold-400'            : '',
        ].filter(Boolean).join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

function toErrString(val) {
  if (!val) return ''
  if (typeof val === 'string') return val
  if (Array.isArray(val)) return val.map(x => x?.msg || x?.message || JSON.stringify(x)).join(' · ')
  if (typeof val === 'object') return val.reason || val.message || val.detail || JSON.stringify(val)
  return String(val)
}

function ErrorBanner({ msg }) {
  const text = toErrString(msg)
  if (!text) return null
  return (
    <div
      className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400 animate-fade-in"
      role="alert"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </div>
  )
}

// Animated dot indicator used during signing
function SigningDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1" aria-hidden="true">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1 h-1 rounded-full bg-current opacity-60 animate-bounce"
          style={{ animationDelay: `${i * 120}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  )
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (bytes < 1024)         return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function calcMonthly(amount, months) {
  const P = parseFloat(amount)
  const n = parseInt(months, 10)
  if (!P || !n || isNaN(P) || isNaN(n) || P <= 0 || n <= 0) return null
  const r = 0.08 / 12
  const monthly = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
  return isFinite(monthly) ? monthly : null
}

// ── Step 1 — Identity Verification ───────────────────────────────────────────

function StepKYC({ onDone }) {
  const [file,     setFile]     = useState(null)
  const [preview,  setPreview]  = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [status,   setStatus]   = useState('idle') // idle | loading | ok | err
  const [errMsg,   setErrMsg]   = useState('')
  const [identity, setIdentity] = useState(null)
  const inputRef = useRef(null)

  const handleFile = useCallback((f) => {
    if (!f || !f.type.startsWith('image/')) {
      setErrMsg('Please upload an image file (JPG, PNG, WEBP, etc.).')
      setStatus('err')
      return
    }
    if (preview) URL.revokeObjectURL(preview)
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setStatus('idle')
    setErrMsg('')
    setIdentity(null)
  }, [preview])

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  function clearFile() {
    if (preview) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview(null)
    setStatus('idle')
    setErrMsg('')
    setIdentity(null)
    if (inputRef.current) inputRef.current.value = ''
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
      setErrMsg(
        e.response?.data?.detail ||
        e.response?.data?.message ||
        'KYC verification failed. Please ensure the document is legible and try again.'
      )
    }
  }

  const isLoading = status === 'loading'

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Section header */}
      <div className="text-center space-y-1.5">
        <h2 className="text-xl font-bold text-white tracking-tight">Identity Verification</h2>
        <p className="text-sm text-slate-400">
          Upload a clear photo of your government-issued ID to proceed
        </p>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload identity document — click or drag an image here"
        onClick={() => !isLoading && inputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); !isLoading && inputRef.current?.click() } }}
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        className={[
          'relative rounded-2xl border-2 border-dashed overflow-hidden transition-all duration-200',
          isLoading ? 'cursor-wait' : 'cursor-pointer',
          status === 'ok'
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : dragOver
              ? 'border-gold-400/60 bg-gold-500/5 shadow-glow-gold-sm'
              : 'border-navy-500 bg-navy-800/50 hover:border-gold-500/40 hover:bg-navy-700/40',
        ].join(' ')}
        style={{ minHeight: 204 }}
      >
        <input
          ref={inputRef}
          id="kyc-file-input"
          type="file"
          accept="image/*"
          className="sr-only"
          aria-hidden="true"
          onChange={e => handleFile(e.target.files[0])}
        />

        {/* Preview */}
        {preview ? (
          <div className="relative w-full h-52">
            <img
              src={preview}
              alt="Identity document preview"
              className="w-full h-full object-cover"
            />
            {/* Overlay for re-upload hint */}
            {status !== 'ok' && (
              <div className="absolute inset-0 bg-navy-900/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-200">
                <div className="flex flex-col items-center gap-2">
                  <Upload size={20} className="text-white" aria-hidden="true" />
                  <span className="text-xs font-semibold text-white">Replace image</span>
                </div>
              </div>
            )}
            {status === 'ok' && (
              <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-emerald-500 shadow-glow-green">
                <CheckCircle2 size={13} className="text-white" aria-hidden="true" />
                <span className="text-xs font-bold text-white">Verified</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 p-12">
            <div
              className={[
                'w-14 h-14 rounded-2xl border flex items-center justify-center transition-colors duration-200',
                dragOver
                  ? 'bg-gold-500/15 border-gold-400/50'
                  : 'bg-navy-700 border-navy-500',
              ].join(' ')}
            >
              <FileImage
                size={24}
                className={dragOver ? 'text-gold-400' : 'text-slate-400'}
                aria-hidden="true"
              />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-slate-300">
                {dragOver ? 'Drop to upload' : 'Drag & drop your ID here'}
              </p>
              <p className="text-xs text-slate-500">or click to browse · JPG, PNG, WEBP</p>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-navy-900/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
            <Loader2 size={28} className="text-gold-400 animate-spin" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-300">Running Nova AI OCR…</p>
          </div>
        )}
      </div>

      {/* File info strip */}
      {file && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-navy-800 border border-navy-700 animate-fade-in">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileImage size={15} className="text-slate-500 shrink-0" aria-hidden="true" />
            <span className="text-sm text-slate-300 font-medium truncate">{file.name}</span>
            <span className="text-xs text-slate-600 shrink-0">{fmtBytes(file.size)}</span>
          </div>
          {status !== 'ok' && (
            <button
              className="btn-ghost text-xs px-2 py-1 ml-2 shrink-0"
              onClick={clearFile}
              disabled={isLoading}
              aria-label="Remove selected file"
            >
              Remove
            </button>
          )}
        </div>
      )}

      {/* Verified identity card */}
      {status === 'ok' && identity && (
        <div className="card-gold p-5 space-y-3 animate-scale-in">
          <div className="flex items-center gap-2 mb-1">
            <BadgeCheck size={16} className="text-emerald-400" aria-hidden="true" />
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Verified Identity</span>
          </div>
          <div className="space-y-0">
            <InfoRow label="Full Name"    value={identity.name} />
            <InfoRow label="Document ID"  value={identity.doc_id} mono />
            <InfoRow
              label="KYC Status"
              value={
                <span className="badge-green">
                  <CheckCircle2 size={10} aria-hidden="true" />
                  {identity.kyc_status}
                </span>
              }
            />
          </div>
        </div>
      )}

      {/* Error */}
      <ErrorBanner msg={status === 'err' ? errMsg : ''} />

      {/* Actions */}
      <div className="flex gap-3">
        {file && status !== 'ok' && (
          <button
            className="btn-secondary"
            onClick={clearFile}
            disabled={isLoading}
            aria-label="Clear selected file"
          >
            Clear
          </button>
        )}

        {status === 'ok' ? (
          <button
            className="btn-primary flex-1"
            onClick={() => onDone(identity)}
            aria-label="Continue to loan application"
          >
            Continue
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        ) : (
          <button
            className="btn-primary flex-1"
            disabled={!file || isLoading}
            onClick={submit}
            aria-label={isLoading ? 'Verifying identity…' : 'Verify identity document'}
          >
            {isLoading ? (
              <>
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                Verifying…
              </>
            ) : (
              <>
                <ShieldCheck size={15} aria-hidden="true" />
                Verify Identity
              </>
            )}
          </button>
        )}
      </div>

      {/* Trust signals */}
      <div className="flex items-center justify-center gap-1.5 text-xs text-slate-600">
        <Lock size={10} aria-hidden="true" />
        <span>256-bit encryption · Magic-bytes validated · Nova AI OCR</span>
      </div>
    </div>
  )
}

// ── Step 2 — Loan Application ─────────────────────────────────────────────────

function StepLoanForm({ identity, onDone, onBack }) {
  const [form,   setForm]   = useState({ amount: '', purpose: '', duration_months: '24' })
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle') // idle | loading | err | blocked
  const [errMsg, setErrMsg] = useState('')

  function setField(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: '' }))
  }

  function validate() {
    const e   = {}
    const amt = parseFloat(form.amount)
    const dur = parseInt(form.duration_months, 10)
    if (!form.amount || isNaN(amt) || amt < 500)   e.amount          = 'Minimum loan amount is $500'
    else if (amt > 500000)                          e.amount          = 'Maximum loan amount is $500,000'
    if (!form.purpose)                              e.purpose         = 'Please select a loan purpose'
    if (!dur || isNaN(dur) || dur < 1 || dur > 360) e.duration_months = 'Duration must be between 1 and 360 months'
    return e
  }

  async function submit() {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }

    setStatus('loading')
    setErrMsg('')
    try {
      const { data } = await axios.post(
        '/loans/apply',
        {
          amount:          parseFloat(form.amount),
          purpose:         form.purpose,
          duration_months: parseInt(form.duration_months, 10),
        },
        {
          headers:        { Authorization: `Bearer ${identity.token}` },
          validateStatus: s => s < 500,
        }
      )

      if (data.status === 'BLOCKED') {
        setStatus('blocked')
        setErrMsg(data.message || 'Your application has been declined based on current lending criteria.')
        return
      }
      onDone(data)
    } catch (e) {
      setStatus('err')
      setErrMsg(
        e.response?.status === 403
          ? 'Your application was rejected. Please review the eligibility requirements.'
          : e.response?.data?.detail ||
            e.response?.data?.message ||
            'Submission failed. Please check your connection and try again.'
      )
    }
  }

  const isLoading = status === 'loading'
  const monthlyRaw = calcMonthly(form.amount, form.duration_months)
  const monthly    = monthlyRaw !== null ? monthlyRaw.toFixed(2) : null
  const totalCost  = monthlyRaw !== null ? (monthlyRaw * parseInt(form.duration_months, 10)).toFixed(2) : null

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <h2 className="text-xl font-bold text-white tracking-tight">Loan Application</h2>
        <p className="text-sm text-slate-400 flex items-center justify-center gap-2 flex-wrap">
          Applying as
          <span className="inline-flex items-center gap-1.5 font-semibold text-white">
            <User size={13} className="text-gold-400" aria-hidden="true" />
            {identity.name}
          </span>
          <span className="badge-green">
            <CheckCircle2 size={10} aria-hidden="true" />
            KYC Verified
          </span>
        </p>
      </div>

      {/* Blocked rejection card */}
      {status === 'blocked' && (
        <div className="card p-5 border-red-500/30 bg-red-500/5 space-y-2 animate-scale-in">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-red-400 shrink-0" aria-hidden="true" />
            <span className="text-sm font-bold text-red-400">Application Rejected</span>
          </div>
          <p className="text-sm text-slate-400">{errMsg}</p>
          <p className="text-xs text-slate-600">You may reapply after 90 days or contact support for assistance.</p>
        </div>
      )}

      <div className="card p-6 space-y-6">
        {/* Amount */}
        <div>
          <label htmlFor="loan-amount" className="label">
            Loan Amount
          </label>
          <div className="relative">
            <DollarSign
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="loan-amount"
              type="number"
              min="500"
              max="500000"
              step="500"
              placeholder="10,000"
              className={[
                'input pl-9',
                errors.amount ? 'border-red-500/50 focus:ring-red-500/30 focus:border-red-500/40' : '',
              ].join(' ')}
              value={form.amount}
              onChange={e => setField('amount', e.target.value)}
              disabled={isLoading}
              aria-describedby={errors.amount ? 'amount-error' : undefined}
              aria-invalid={!!errors.amount}
            />
          </div>
          {errors.amount && <FieldError msg={errors.amount} />}
        </div>

        <div className="divider" />

        {/* Purpose */}
        <div>
          <label htmlFor="loan-purpose" className="label">
            Loan Purpose
          </label>
          <select
            id="loan-purpose"
            className={[
              'input appearance-none cursor-pointer',
              errors.purpose ? 'border-red-500/50 focus:ring-red-500/30 focus:border-red-500/40' : '',
              !form.purpose  ? 'text-slate-600' : '',
            ].join(' ')}
            value={form.purpose}
            onChange={e => setField('purpose', e.target.value)}
            disabled={isLoading}
            aria-invalid={!!errors.purpose}
          >
            <option value="">Select a purpose…</option>
            {PURPOSE_OPTIONS.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {errors.purpose && <FieldError msg={errors.purpose} />}
        </div>

        <div className="divider" />

        {/* Duration slider */}
        <div>
          <label htmlFor="loan-duration" className="label">
            <span className="flex items-center justify-between w-full">
              <span className="flex items-center gap-1.5">
                <Calendar size={11} aria-hidden="true" />
                Repayment Period
              </span>
              <span className="text-gold-400 font-bold normal-case tracking-normal text-sm">
                {form.duration_months} month{parseInt(form.duration_months, 10) !== 1 ? 's' : ''}
              </span>
            </span>
          </label>
          <input
            id="loan-duration"
            type="range"
            min="1"
            max="360"
            step="1"
            className="w-full h-2 rounded-full cursor-pointer accent-gold-500 transition-all duration-150"
            style={{ accentColor: '#F59E0B' }}
            value={form.duration_months}
            onChange={e => setField('duration_months', e.target.value)}
            disabled={isLoading}
            aria-valuemin={1}
            aria-valuemax={360}
            aria-valuenow={parseInt(form.duration_months, 10)}
            aria-label="Repayment period in months"
          />
          <div className="flex justify-between text-2xs text-slate-600 mt-1.5 font-medium">
            <span>1 mo</span>
            <span>12 mo</span>
            <span>60 mo</span>
            <span>120 mo</span>
            <span>360 mo</span>
          </div>
          {errors.duration_months && <FieldError msg={errors.duration_months} />}
        </div>
      </div>

      {/* Live payment estimate */}
      {monthly && (
        <div className="card-gold p-5 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2 mb-0.5">
            <TrendingUp size={14} className="text-gold-400" aria-hidden="true" />
            <span className="text-xs font-bold text-gold-400 uppercase tracking-wider">Payment Estimate</span>
            <span className="text-xs text-slate-600 ml-auto">8% annual rate</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="px-4 py-3 rounded-xl bg-navy-700/60 border border-navy-600">
              <p className="text-xs text-slate-500 mb-1">Monthly Payment</p>
              <p className="text-xl font-black text-gold-400">${Number(monthly).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="px-4 py-3 rounded-xl bg-navy-700/60 border border-navy-600">
              <p className="text-xs text-slate-500 mb-1">Total Cost</p>
              <p className="text-xl font-black text-slate-200">${Number(totalCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
          <p className="text-xs text-slate-600">
            Estimates are indicative only. Final terms are determined after risk assessment.
          </p>
        </div>
      )}

      {/* Generic error */}
      {status === 'err' && <ErrorBanner msg={errMsg} />}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          className="btn-secondary"
          onClick={onBack}
          disabled={isLoading}
          aria-label="Go back to identity verification"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back
        </button>
        <button
          className="btn-primary flex-1"
          disabled={isLoading}
          onClick={submit}
          aria-label={isLoading ? 'Analysing application…' : 'Submit loan application'}
        >
          {isLoading ? (
            <>
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              Analysing…
            </>
          ) : (
            <>
              <Sparkles size={15} aria-hidden="true" />
              Submit &amp; Analyse
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Step 3 — Risk Assessment ──────────────────────────────────────────────────

function StepRiskReview({ loanData, identity, onDone, onBack }) {
  const [signingState, setSigningState] = useState('idle') // idle | step_b | step_t | step_x | done | err
  const [signErr,      setSignErr]      = useState('')

  const tier     = loanData.risk_tier || 'MEDIUM'
  const tierCfg  = TIER_CONFIG[tier] || TIER_CONFIG.MEDIUM
  const canProceed = ['LOW', 'MEDIUM', 'HIGH'].includes(tier)
  const isSigning  = ['step_b', 'step_t', 'step_x'].includes(signingState)

  const signingStepIndex = { step_b: 0, step_t: 1, step_x: 2 }

  async function proceedToSign() {
    setSigningState('step_b')
    setSignErr('')
    try {
      // Animate through steps while the real call runs
      const stepTimer1 = setTimeout(() => setSigningState('step_t'), 900)
      const stepTimer2 = setTimeout(() => setSigningState('step_x'), 1800)

      const { data } = await axios.post(
        `/loans/${loanData.loan_id}/sign`,
        {},
        { headers: { Authorization: `Bearer ${identity.token}` } }
      )

      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)
      setSigningState('done')

      // Brief pause to show final state before transitioning
      setTimeout(() => onDone({ ...loanData, ...data }), 600)
    } catch (e) {
      setSigningState('idle')
      setSignErr(
        e.response?.data?.detail ||
        e.response?.data?.message ||
        'Signing failed. Please retry.'
      )
    }
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <h2 className="text-xl font-bold text-white tracking-tight">AI Risk Assessment</h2>
        <p className="text-sm text-slate-400 flex items-center justify-center gap-1.5">
          <Sparkles size={12} className="text-violet-400" aria-hidden="true" />
          Powered by Amazon Bedrock · Nova AI
        </p>
      </div>

      {/* Score meter — full width card */}
      <div className={['card p-8 flex flex-col items-center gap-6', tierCfg.border, tierCfg.bg].join(' ')}>
        <TrustScoreMeter score={loanData.trust_score ?? 0} tier={tier} />
        <div className="w-full text-center space-y-1.5">
          <p className={['text-lg font-bold', tierCfg.color].join(' ')}>
            {tierCfg.headline}
          </p>
          <p className="text-sm text-slate-400 leading-relaxed max-w-sm mx-auto">
            {tierCfg.body}
          </p>
        </div>
      </div>

      {/* AI Narrative */}
      {loanData.risk_narrative && (
        <div className="card-violet p-5 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <Sparkles size={13} className="text-violet-400" aria-hidden="true" />
            <span className="text-xs font-bold text-violet-400 uppercase tracking-wider">AI Narrative</span>
          </div>
          <div
            className="border-l-2 border-violet-500/50 pl-4"
            aria-label="AI-generated risk narrative"
          >
            <p className="text-sm text-slate-300 leading-relaxed">{loanData.risk_narrative}</p>
          </div>
        </div>
      )}

      {/* Application summary */}
      <div className="card p-5 space-y-1">
        <div className="flex items-center gap-2 mb-2">
          <FileText size={13} className="text-slate-500" aria-hidden="true" />
          <span className="section-label">Application Summary</span>
        </div>
        <InfoRow label="Loan ID"   value={`#${loanData.loan_id}`}                              mono />
        <InfoRow label="Amount"    value={`$${Number(loanData.amount).toLocaleString('en-US')}`} highlight />
        <InfoRow label="Purpose"   value={loanData.purpose} />
        <InfoRow label="Term"      value={`${loanData.duration_months} months`} />
        <InfoRow label="Risk Tier" value={
          <span className={tierCfg.badgeClass}>
            <span className={['w-1.5 h-1.5 rounded-full', tierCfg.dot].join(' ')} aria-hidden="true" />
            {tier.replace('_', ' ')}
          </span>
        } />
      </div>

      {/* Signing progress */}
      {(isSigning || signingState === 'done') && (
        <div className="card p-5 space-y-4 animate-fade-in" aria-live="polite" aria-label="Signing progress">
          <div className="flex items-center gap-2">
            <PenLine size={14} className="text-gold-400" aria-hidden="true" />
            <span className="text-xs font-bold text-gold-400 uppercase tracking-wider">
              {signingState === 'done' ? 'Signing Complete' : 'Applying Digital Signatures…'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {SIGNING_STEPS.map((s, i) => {
              const currentIdx = signingStepIndex[signingState] ?? (signingState === 'done' ? 3 : -1)
              const isDone    = currentIdx > i || signingState === 'done'
              const isActive  = signingStepIndex[signingState] === i

              return (
                <div key={s.key} className="flex items-center gap-2 flex-1">
                  <div
                    className={[
                      'flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all duration-300 w-full justify-center',
                      isDone   ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : '',
                      isActive ? 'bg-gold-500/10 border-gold-500/30 text-gold-400 shadow-glow-gold-sm' : '',
                      !isDone && !isActive ? 'bg-navy-800 border-navy-700 text-slate-600' : '',
                    ].join(' ')}
                  >
                    {isDone ? (
                      <CheckCircle2 size={12} aria-hidden="true" />
                    ) : isActive ? (
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Clock size={12} aria-hidden="true" />
                    )}
                    {s.label}
                    {isActive && <SigningDots />}
                  </div>
                  {i < SIGNING_STEPS.length - 1 && (
                    <div
                      className={[
                        'w-4 h-px shrink-0 rounded-full transition-colors duration-300',
                        isDone ? 'bg-emerald-500/40' : 'bg-navy-600',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Error */}
      <ErrorBanner msg={signErr} />

      {/* Actions */}
      <div className="flex gap-3">
        <button
          className="btn-secondary"
          onClick={onBack}
          disabled={isSigning || signingState === 'done'}
          aria-label="Go back to loan application"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back
        </button>

        {canProceed && (
          <button
            className="btn-primary flex-1"
            disabled={isSigning || signingState === 'done'}
            onClick={proceedToSign}
            aria-label={isSigning ? 'Generating and signing agreement…' : 'Generate and sign loan agreement'}
          >
            {isSigning || signingState === 'done' ? (
              <>
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                {signingState === 'done' ? 'Finalising…' : 'Signing Agreement…'}
              </>
            ) : (
              <>
                <PenLine size={15} aria-hidden="true" />
                Generate &amp; Sign Agreement
              </>
            )}
          </button>
        )}

        {!canProceed && (
          <div className="flex-1 px-5 py-2.5 rounded-xl bg-navy-800 border border-navy-700 text-sm text-slate-500 font-medium text-center">
            No action available for this status
          </div>
        )}
      </div>
    </div>
  )
}

// ── Step 4 — Agreement Download ───────────────────────────────────────────────

const SIG_BADGES = [
  {
    key:   'pades_b',
    label: 'PAdES-B',
    desc:  'Baseline digital signature',
  },
  {
    key:   'pades_t',
    label: 'PAdES-T',
    desc:  'RFC 3161 timestamp authority',
  },
  {
    key:   'xades_t',
    label: 'XAdES-T',
    desc:  'XML advanced electronic signature',
  },
]

function StepAgreement({ loanData, identity }) {
  const [downloading, setDownloading] = useState(null) // null | 'signed' | 'unsigned'
  const [dlErr,       setDlErr]       = useState('')

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

      const suffix = type === 'signed' ? 'pades-t.pdf' : 'unsigned.pdf'
      const url    = URL.createObjectURL(resp.data)
      const a      = document.createElement('a')
      a.href       = url
      a.download   = `VaultIQ-Loan-${loanData.loan_id}-${suffix}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setDlErr('Download failed. Please check your connection and try again.')
    } finally {
      setDownloading(null)
    }
  }

  const isBusy = !!downloading

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <h2 className="text-xl font-bold text-white tracking-tight">Loan Agreement Ready</h2>
        <p className="text-sm text-slate-400">Your digitally-signed agreement is available for download</p>
      </div>

      {/* Success banner */}
      <div className="card p-8 flex flex-col items-center gap-5 border-emerald-500/20 bg-emerald-500/5 animate-scale-in">
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shadow-glow-green">
          <CheckCircle2 size={36} className="text-emerald-400" aria-hidden="true" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-xl font-bold text-white">All Signatures Applied</p>
          <p className="text-sm text-slate-400">Your agreement has been cryptographically signed and timestamped</p>
        </div>

        {/* Signature badge row */}
        <div className="w-full grid grid-cols-3 gap-3 mt-1" role="list" aria-label="Applied signatures">
          {SIG_BADGES.map(sig => (
            <div
              key={sig.key}
              className="flex flex-col items-center gap-2 px-3 py-4 rounded-xl bg-navy-800 border border-emerald-500/20 transition-all duration-200"
              role="listitem"
            >
              <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 size={15} className="text-emerald-400" aria-hidden="true" />
              </div>
              <span className="text-xs font-bold text-slate-200 font-mono">{sig.label}</span>
              <span className="text-[10px] text-slate-600 text-center leading-snug">{sig.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Download buttons */}
      <div className="space-y-3">
        <button
          className="btn-primary w-full"
          onClick={() => download('signed')}
          disabled={isBusy}
          aria-label="Download signed agreement in PAdES-T format"
        >
          {downloading === 'signed' ? (
            <>
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              Preparing download…
            </>
          ) : (
            <>
              <Download size={15} aria-hidden="true" />
              Download Signed Agreement (PAdES-T)
            </>
          )}
        </button>

        <button
          className="btn-secondary w-full"
          onClick={() => download('unsigned')}
          disabled={isBusy}
          aria-label="Download unsigned copy of the agreement"
        >
          {downloading === 'unsigned' ? (
            <>
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              Preparing download…
            </>
          ) : (
            <>
              <FileText size={15} aria-hidden="true" />
              Download Unsigned Copy
            </>
          )}
        </button>
      </div>

      {/* Download error */}
      <ErrorBanner msg={dlErr} />

      {/* Transaction details */}
      <div className="card p-5 space-y-1">
        <div className="flex items-center gap-2 mb-2">
          <CreditCard size={13} className="text-slate-500" aria-hidden="true" />
          <span className="section-label">Transaction Details</span>
        </div>
        <InfoRow label="Loan ID"        value={`#${loanData.loan_id}`}                               mono />
        <InfoRow label="Amount"         value={`$${Number(loanData.amount).toLocaleString('en-US')}`} highlight />
        <InfoRow label="Borrower"       value={identity.name} />
        <InfoRow label="Signing Status" value={
          <span className="badge-green">
            <CheckCircle2 size={10} aria-hidden="true" />
            Complete
          </span>
        } />
      </div>

      {/* Verify hint */}
      <div className="flex items-center justify-center gap-1.5">
        <a
          href="/admin"
          className="btn-ghost text-xs text-slate-500 hover:text-violet-400 transition-colors duration-150 cursor-pointer"
          aria-label="Verify this document in the admin dashboard"
        >
          <Hash size={11} aria-hidden="true" />
          Verify this document
          <ExternalLink size={10} aria-hidden="true" />
        </a>
      </div>

      {/* Footer trust signal */}
      <p className="text-center text-xs text-slate-600 flex items-center justify-center gap-1.5">
        <Lock size={10} aria-hidden="true" />
        Timestamped via RFC 3161 · freetsa.org · Compliant with eIDAS Regulation
      </p>
    </div>
  )
}

// ── Main BorrowerFlow ─────────────────────────────────────────────────────────

export default function BorrowerFlow() {
  const [step,       setStep]       = useState(0)
  const [identity,   setIdentity]   = useState(null)   // from KYC
  const [loanData,   setLoanData]   = useState(null)   // from /loans/apply
  const [signedData, setSignedData] = useState(null)   // merged with /sign response

  // Key each step to force remount + re-animate on step change
  const stepKey = `step-${step}`

  return (
    <div className="max-w-xl mx-auto px-4 py-10" aria-label="VaultIQ Loan Application Wizard">

      {/* Page hero */}
      <div className="text-center mb-8">
        <p className="section-label mb-2">VaultIQ Loan Application</p>
        <div className="w-12 h-px bg-gold-500/30 mx-auto rounded-full" aria-hidden="true" />
      </div>

      {/* Step indicator */}
      <StepIndicator steps={STEPS} current={step} />

      {/* Step content */}
      <main key={stepKey} className="animate-slide-up">
        {step === 0 && (
          <StepKYC
            onDone={id => {
              setIdentity(id)
              setStep(1)
            }}
          />
        )}

        {step === 1 && identity && (
          <StepLoanForm
            identity={identity}
            onBack={() => setStep(0)}
            onDone={data => {
              setLoanData(data)
              setStep(2)
            }}
          />
        )}

        {step === 2 && loanData && identity && (
          <StepRiskReview
            loanData={loanData}
            identity={identity}
            onBack={() => setStep(1)}
            onDone={data => {
              setSignedData(data)
              setStep(3)
            }}
          />
        )}

        {step === 3 && identity && (signedData || loanData) && (
          <StepAgreement
            loanData={signedData || loanData}
            identity={identity}
          />
        )}
      </main>
    </div>
  )
}
