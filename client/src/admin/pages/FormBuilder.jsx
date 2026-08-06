// =============================================================================
// Visual Form Builder — 3-panel drag-and-drop interface
// Left: field palette  |  Center: live canvas  |  Right: properties / settings
// =============================================================================
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFont, faEnvelope, faPhone, faHashtag, faLink, faAlignLeft,
  faCalendarDays, faClock, faChevronDown, faCircleDot, faSquareCheck,
  faListCheck, faStar, faSlidersH, faHeading, faMinus, faParagraph,
  faLock, faPaperclip, faFileContract, faArrowLeft, faTrash,
  faGripVertical, faFloppyDisk, faGear,
} from '@fortawesome/free-solid-svg-icons';
import api from '../../api/client.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const PALETTE = [
  { category: 'Basic', items: [
    { type: 'text',     icon: faFont,         label: 'Short Text'  },
    { type: 'email',    icon: faEnvelope,      label: 'Email'        },
    { type: 'phone',    icon: faPhone,         label: 'Phone'        },
    { type: 'number',   icon: faHashtag,       label: 'Number'       },
    { type: 'url',      icon: faLink,          label: 'URL'          },
    { type: 'textarea', icon: faAlignLeft,     label: 'Long Text'    },
    { type: 'date',     icon: faCalendarDays,  label: 'Date'         },
    { type: 'time',     icon: faClock,         label: 'Time'         },
  ]},
  { category: 'Choice', items: [
    { type: 'select',     icon: faChevronDown,  label: 'Dropdown'        },
    { type: 'radio',      icon: faCircleDot,    label: 'Radio Group'     },
    { type: 'checkbox',   icon: faSquareCheck,  label: 'Single Checkbox' },
    { type: 'checkboxes', icon: faListCheck,    label: 'Multi-Checkbox'  },
    { type: 'rating',     icon: faStar,         label: 'Star Rating'     },
    { type: 'range',      icon: faSlidersH,     label: 'Slider'          },
  ]},
  { category: 'Layout', items: [
    { type: 'heading',   icon: faHeading,      label: 'Heading'   },
    { type: 'divider',   icon: faMinus,        label: 'Divider'   },
    { type: 'paragraph', icon: faParagraph,    label: 'Paragraph' },
  ]},
  { category: 'Special', items: [
    { type: 'hidden', icon: faLock,         label: 'Hidden Field'       },
    { type: 'file',   icon: faPaperclip,    label: 'File Upload'        },
    { type: 'terms',  icon: faFileContract, label: 'Terms & Conditions' },
  ]},
];

const CRM_FIELDS = [
  { value: '',               label: '— No mapping —'    },
  { value: 'first_name',    label: 'First Name'         },
  { value: 'last_name',     label: 'Last Name'          },
  { value: 'email',         label: 'Email'              },
  { value: 'phone',         label: 'Phone'              },
  { value: 'mobile',        label: 'Mobile'             },
  { value: 'title',         label: 'Job Title'          },
  { value: 'department',    label: 'Department'         },
  { value: 'address_line1', label: 'Address Line 1'     },
  { value: 'address_line2', label: 'Address Line 2'     },
  { value: 'city',          label: 'City'               },
  { value: 'state',         label: 'State / Province'   },
  { value: 'postal_code',   label: 'Postal Code'        },
  { value: 'country',       label: 'Country'            },
  { value: 'linkedin_url',  label: 'LinkedIn URL'       },
  { value: 'lead_source',   label: 'Lead Source'        },
  { value: 'notes',         label: 'Notes'              },
];

const COND_OPS = ['equals','not_equals','contains','not_contains','is_empty','is_not_empty'];
const LAYOUT_TYPES = new Set(['heading','divider','paragraph']);

// ── Helpers ───────────────────────────────────────────────────────────────────

let _uid = 1;
function genId() { return `f${_uid++}`; }

function normalizeOptions(opts) {
  if (!Array.isArray(opts)) return null;
  return opts.map(o =>
    (o && typeof o === 'object') ? (o.label || o.value || '') : String(o)
  ).filter(Boolean);
}

function makeField(type) {
  const isLayout = LAYOUT_TYPES.has(type);
  return {
    _id:             genId(),
    field_type:      type,
    label:           type === 'heading'   ? 'Section Heading'
                   : type === 'divider'   ? ''
                   : type === 'paragraph' ? 'Paragraph text goes here.'
                   : type === 'terms'     ? 'I agree to the terms and conditions'
                   : type === 'rating'    ? 'Rate your experience'
                   : type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g,' '),
    field_key:       isLayout ? `layout_${type}_${_uid}` : type.replace(/-/g,'_'),
    placeholder:     '',
    help_text:       '',
    default_value:   '',
    is_required:     false,
    options_json:    ['select','radio','checkboxes'].includes(type) ? ['Option 1','Option 2','Option 3'] : null,
    validation_json: null,
    show_if_json:    null,
    sort_order:      0,
  };
}

// ── Field preview renderer ─────────────────────────────────────────────────────

function FieldPreview({ field }) {
  const { field_type: type, label, placeholder, options_json, help_text } = field;
  const opts = Array.isArray(options_json) ? options_json : [];

  const inputStyle = {
    width:'100%', padding:'6px 10px', border:'1px solid #ced4da',
    borderRadius:4, fontSize:'0.88rem', background:'#f8f9fa', color:'#555',
  };

  if (type === 'heading')   return <div style={{ fontWeight:700, fontSize:'1.1rem', color:'#1a1a2e' }}>{label}</div>;
  if (type === 'divider')   return <hr style={{ margin:'4px 0', borderColor:'#dee2e6' }} />;
  if (type === 'paragraph') return <p style={{ fontSize:'0.88rem', color:'#555', margin:0 }}>{label}</p>;
  if (type === 'hidden')    return (
    <div style={{ fontSize:'0.78rem', color:'#999', padding:'4px 8px', background:'#f8f9fa', borderRadius:4, fontStyle:'italic' }}>
      🔒 Hidden: <strong>{label}</strong>{field.default_value ? ` = "${field.default_value}"` : ''}
    </div>
  );

  return (
    <div>
      {type !== 'checkbox' && type !== 'terms' && (
        <label style={{ display:'block', fontSize:'0.82rem', fontWeight:600, marginBottom:3, color:'#333' }}>
          {label}{field.is_required && <span style={{ color:'#dc3545' }}> *</span>}
        </label>
      )}
      {help_text && <div style={{ fontSize:'0.75rem', color:'#888', marginBottom:3 }}>{help_text}</div>}

      {['text','email','phone','url'].includes(type) && <input type={type} style={inputStyle} placeholder={placeholder||''} disabled />}
      {type === 'number'   && <input type="number" style={inputStyle} placeholder={placeholder||''} disabled />}
      {type === 'date'     && <input type="date" style={inputStyle} disabled />}
      {type === 'time'     && <input type="time" style={inputStyle} disabled />}
      {type === 'textarea' && <textarea style={{ ...inputStyle, minHeight:72, resize:'none' }} placeholder={placeholder||''} disabled />}
      {type === 'file'     && <div style={{ ...inputStyle, cursor:'not-allowed', color:'#aaa' }}>Choose file…</div>}
      {type === 'select'   && (
        <select style={inputStyle} disabled>
          <option>{placeholder||'— Select —'}</option>
          {opts.map(o => <option key={o}>{o}</option>)}
        </select>
      )}
      {type === 'radio' && (
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {opts.map(o => (
            <label key={o} style={{ display:'flex', alignItems:'center', gap:6, fontSize:'0.85rem', fontWeight:'normal' }}>
              <input type="radio" disabled /> {o}
            </label>
          ))}
        </div>
      )}
      {(type === 'checkbox' || type === 'terms') && (
        <label style={{ display:'flex', alignItems:'flex-start', gap:8, fontSize:'0.85rem', fontWeight:'normal' }}>
          <input type="checkbox" disabled style={{ marginTop:2 }} /> {label}
        </label>
      )}
      {type === 'checkboxes' && (
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {opts.map(o => (
            <label key={o} style={{ display:'flex', alignItems:'center', gap:6, fontSize:'0.85rem', fontWeight:'normal' }}>
              <input type="checkbox" disabled /> {o}
            </label>
          ))}
        </div>
      )}
      {type === 'rating' && (
        <div style={{ display:'flex', gap:4 }}>
          {[1,2,3,4,5].map(n => <span key={n} style={{ fontSize:'1.4rem', color:'#ffc107' }}>★</span>)}
        </div>
      )}
      {type === 'range' && (
        <div>
          <input type="range" style={{ width:'100%' }} disabled />
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.72rem', color:'#999' }}>
            <span>{field.validation_json?.min ?? 0}</span>
            <span>{field.validation_json?.max ?? 100}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Properties panel ──────────────────────────────────────────────────────────

function PropertiesPanel({ field, allFields, onChange, onRemove, crmMapping, onCrmChange }) {
  const type = field.field_type;
  const isLayout  = LAYOUT_TYPES.has(type);
  const hasOptions = ['select','radio','checkboxes'].includes(type);
  const set = (k, v) => onChange({ ...field, [k]: v });
  const cond = field.show_if_json || { field:'', operator:'equals', value:'' };
  const vali = field.validation_json || {};
  const setVali = (k, v) => set('validation_json', { ...vali, [k]: v || undefined });
  const otherFields = allFields.filter(f => f._id !== field._id && !LAYOUT_TYPES.has(f.field_type));

  const sl = { fontSize:'0.75rem', fontWeight:600, color:'#555', display:'block', marginBottom:3, marginTop:8 };
  const ic = 'form-control form-control-sm';
  const is = 'form-select form-select-sm';

  return (
    <div style={{ padding:'12px 14px', overflowY:'auto', flex:1 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <span style={{ fontWeight:700, fontSize:'0.82rem', color:'#1a1a2e' }}>
          {PALETTE.flatMap(c=>c.items).find(i=>i.type===type)?.label || type}
        </span>
        <button onClick={onRemove} title="Remove field"
          style={{ background:'none', border:'1px solid #dc3545', color:'#dc3545', borderRadius:4, padding:'4px 8px', fontSize:'0.78rem', cursor:'pointer' }}>
          <FontAwesomeIcon icon={faTrash} />
        </button>
      </div>

      {/* Label */}
      {type !== 'divider' && (
        <><label style={sl}>Label</label>
        <input className={ic} value={field.label} onChange={e => set('label', e.target.value)} /></>
      )}

      {/* Field key */}
      {!isLayout && (
        <><label style={sl}>Field Key (ID)</label>
        <input className={ic} value={field.field_key}
          onChange={e => set('field_key', e.target.value.replace(/\s/g,'_').toLowerCase())} /></>
      )}

      {/* Placeholder */}
      {!isLayout && !['checkbox','terms','rating','range','file','hidden'].includes(type) && (
        <><label style={sl}>Placeholder</label>
        <input className={ic} value={field.placeholder||''} onChange={e => set('placeholder', e.target.value)} /></>
      )}

      {/* Help text */}
      {!isLayout && type !== 'hidden' && (
        <><label style={sl}>Help Text</label>
        <input className={ic} placeholder="Shown below field" value={field.help_text||''} onChange={e => set('help_text', e.target.value)} /></>
      )}

      {/* Default value */}
      {['text','email','phone','number','url','hidden','textarea'].includes(type) && (
        <><label style={sl}>Default Value</label>
        <input className={ic} value={field.default_value||''} onChange={e => set('default_value', e.target.value)} /></>
      )}

      {/* Required */}
      {!isLayout && type !== 'hidden' && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
          <input type="checkbox" id={`req_${field._id}`} checked={!!field.is_required}
            onChange={e => set('is_required', e.target.checked)} />
          <label htmlFor={`req_${field._id}`} style={{ fontSize:'0.82rem', marginBottom:0 }}>Required field</label>
        </div>
      )}

      {/* Column width */}
      {!isLayout && (
        <>
          <label style={{ ...sl, marginTop:12 }}>Column Width</label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginBottom:4 }}>
            {[
              { value:'full',       label:'Full',     desc:'100%' },
              { value:'half',       label:'Half',     desc:'50%'  },
              { value:'third',      label:'1/3',      desc:'33%'  },
              { value:'two-thirds', label:'2/3',      desc:'67%'  },
            ].map(opt => {
              const active = (field.col_width || 'full') === opt.value;
              return (
                <button key={opt.value} onClick={() => set('col_width', opt.value)}
                  style={{ padding:'5px 4px', border:`2px solid ${active ? '#4a2d82' : '#dee2e6'}`, borderRadius:4, background: active ? '#f0eeff' : '#fff', cursor:'pointer', fontSize:'0.72rem', fontWeight: active ? 700 : 400, color: active ? '#4a2d82' : '#555', textAlign:'center' }}>
                  <div>{opt.label}</div>
                  <div style={{ fontSize:'0.65rem', opacity:0.7 }}>{opt.desc}</div>
                </button>
              );
            })}
          </div>
          <p style={{ fontSize:'0.72rem', color:'#888', margin:0 }}>Adjacent half/third fields appear side-by-side.</p>
        </>
      )}

      {/* Options */}
      {hasOptions && (
        <><label style={{ ...sl, marginTop:12 }}>Options (one per line)</label>
        <textarea className={ic} rows={5}
          value={(field.options_json||[]).join('\n')}
          onChange={e => set('options_json', e.target.value.split('\n').map(s=>s.trim()).filter(Boolean))} /></>
      )}

      {/* Validation */}
      {['text','textarea','email','phone','url'].includes(type) && (<>
        <label style={sl}>Min length</label>
        <input type="number" className={ic} value={vali.minLength||''} onChange={e => setVali('minLength', e.target.value ? Number(e.target.value) : undefined)} />
        <label style={sl}>Max length</label>
        <input type="number" className={ic} value={vali.maxLength||''} onChange={e => setVali('maxLength', e.target.value ? Number(e.target.value) : undefined)} />
      </>)}
      {type === 'number' && (<>
        <label style={sl}>Min</label>
        <input type="number" className={ic} value={vali.min??''} onChange={e => setVali('min', e.target.value !== '' ? Number(e.target.value) : undefined)} />
        <label style={sl}>Max</label>
        <input type="number" className={ic} value={vali.max??''} onChange={e => setVali('max', e.target.value !== '' ? Number(e.target.value) : undefined)} />
      </>)}
      {type === 'range' && (<>
        <label style={sl}>Min</label>
        <input type="number" className={ic} value={vali.min??0} onChange={e => setVali('min', Number(e.target.value))} />
        <label style={sl}>Max</label>
        <input type="number" className={ic} value={vali.max??100} onChange={e => setVali('max', Number(e.target.value))} />
        <label style={sl}>Step</label>
        <input type="number" className={ic} value={vali.step??1} onChange={e => setVali('step', Number(e.target.value))} />
      </>)}

      {/* Conditional logic */}
      {!isLayout && otherFields.length > 0 && (<>
        <hr style={{ margin:'14px 0 6px' }} />
        <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#4a2d82', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Conditional Logic</div>
        <label style={sl}>Show this field when…</label>
        <select className={is} value={cond.field}
          onChange={e => set('show_if_json', e.target.value ? { ...cond, field: e.target.value } : null)}>
          <option value="">— Always show —</option>
          {otherFields.map(f => <option key={f._id} value={f.field_key}>{f.label}</option>)}
        </select>
        {cond.field && (<>
          <select className={is} value={cond.operator}
            onChange={e => set('show_if_json', { ...cond, operator: e.target.value })}>
            {COND_OPS.map(op => <option key={op} value={op}>{op.replace(/_/g,' ')}</option>)}
          </select>
          {!['is_empty','is_not_empty'].includes(cond.operator) && (
            <input className={ic} placeholder="Value" value={cond.value||''}
              onChange={e => set('show_if_json', { ...cond, value: e.target.value })} />
          )}
        </>)}
      </>)}

      {/* CRM Mapping */}
      {!isLayout && type !== 'hidden' && (<>
        <hr style={{ margin:'14px 0 6px' }} />
        <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#4a2d82', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>CRM Mapping</div>
        <label style={sl}>Map to contact field</label>
        <select className={is} value={crmMapping[field.field_key]||''}
          onChange={e => onCrmChange(field.field_key, e.target.value)}>
          {CRM_FIELDS.map(cf => <option key={cf.value} value={cf.value}>{cf.label}</option>)}
        </select>
        {crmMapping[field.field_key] && (
          <div style={{ fontSize:'0.72rem', color:'#28a745', marginTop:2 }}>
            ✓ Maps to <strong>{crmMapping[field.field_key]}</strong>
          </div>
        )}
      </>)}
    </div>
  );
}

// ── Settings panel ─────────────────────────────────────────────────────────────

function SettingsPanel({ meta, onChange }) {
  const set = (k, v) => onChange({ ...meta, [k]: v });
  const sl = { fontSize:'0.82rem', fontWeight:600, color:'#444', display:'block', marginBottom:4 };

  return (
    <div style={{ padding:24 }}>
      <h5 style={{ fontWeight:700, marginBottom:20 }}>Form Settings</h5>

      <div className="card mb-4">
        <div className="card-header fw-bold" style={{ fontSize:'0.85rem' }}>General</div>
        <div className="card-body">
          <label style={sl}>Form Name *</label>
          <input className="form-control form-control-sm mb-3" value={meta.name} onChange={e => set('name', e.target.value)} />
          <label style={sl}>Slug (URL identifier)</label>
          <input className="form-control form-control-sm mb-3" value={meta.slug} onChange={e => set('slug', e.target.value)} />
          <label style={sl}>Description</label>
          <textarea className="form-control form-control-sm mb-3" rows={2} value={meta.description||''} onChange={e => set('description', e.target.value)} />
          <div className="d-flex align-items-center gap-2">
            <input type="checkbox" id="is_active" checked={!!meta.is_active} onChange={e => set('is_active', e.target.checked)} />
            <label htmlFor="is_active" className="mb-0" style={{ fontSize:'0.85rem' }}>Form is active</label>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header fw-bold" style={{ fontSize:'0.85rem' }}>Submission</div>
        <div className="card-body">
          <label style={sl}>Submit Button Text</label>
          <input className="form-control form-control-sm mb-3" value={meta.submit_text||''} onChange={e => set('submit_text', e.target.value)} />
          <label style={sl}>Success Message</label>
          <textarea className="form-control form-control-sm mb-3" rows={2} value={meta.success_msg||''} onChange={e => set('success_msg', e.target.value)} />
          <label style={sl}>Redirect URL after submit (overrides success message)</label>
          <input className="form-control form-control-sm" placeholder="https://…" value={meta.redirect_url||''} onChange={e => set('redirect_url', e.target.value)} />
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header fw-bold" style={{ fontSize:'0.85rem' }}>Notifications</div>
        <div className="card-body">
          <label style={sl}>Notification Email</label>
          <input className="form-control form-control-sm" type="email" placeholder="you@example.com" value={meta.notify_email||''} onChange={e => set('notify_email', e.target.value)} />
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header fw-bold" style={{ fontSize:'0.85rem' }}>Security</div>
        <div className="card-body">
          <div className="d-flex align-items-center gap-2">
            <input type="checkbox" id="honeypot" checked={meta.honeypot !== false} onChange={e => set('honeypot', e.target.checked)} />
            <label htmlFor="honeypot" className="mb-0" style={{ fontSize:'0.85rem' }}>Honeypot spam protection</label>
          </div>
          <p className="text-muted mb-0 mt-1" style={{ fontSize:'0.77rem' }}>Adds an invisible field that only bots fill out — no CAPTCHA needed.</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header fw-bold" style={{ fontSize:'0.85rem' }}>CRM Integration</div>
        <div className="card-body">
          <label style={sl}>On Submission</label>
          <select className="form-select form-select-sm mb-2" value={meta.crm_action||'none'} onChange={e => set('crm_action', e.target.value)}>
            <option value="none">No CRM action</option>
            <option value="create_contact">Create / update contact</option>
            <option value="create_contact_deal">Create / update contact + create deal</option>
            <option value="volunteer_signup">Volunteer signup (tags contact "Volunteer")</option>
          </select>
          {meta.crm_action && meta.crm_action !== 'none' && meta.crm_action !== 'volunteer_signup' && (
            <div className="alert alert-info py-2 mb-0" style={{ fontSize:'0.82rem' }}>
              Map individual fields to CRM columns using the <strong>Properties panel</strong> — click any field on the canvas.
            </div>
          )}
          {meta.crm_action === 'volunteer_signup' && (
            <div className="alert alert-info py-2 mb-0" style={{ fontSize:'0.82rem' }}>
              Map name/email fields to CRM columns using the <strong>Properties panel</strong>, same as any other form.
              To sign volunteers up for one specific event, add a <strong>Hidden</strong> field with key <code>event_slug</code>
              and its default value set to that event's slug — leave it out for a general "become a volunteer" form.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function FormBuilder() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const isEdit    = Boolean(id);

  const [tab,        setTab]        = useState('build');
  const [fields,     setFields]     = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [meta,       setMeta]       = useState({
    name:'New Form', slug:'', description:'', submit_text:'Submit',
    success_msg:'Thank you! Your submission has been received.',
    notify_email:'', redirect_url:'', is_active:true, honeypot:true, crm_action:'none',
  });
  const [crmMapping, setCrmMapping] = useState({});
  const [saving,     setSaving]     = useState(false);
  const [saveMsg,    setSaveMsg]    = useState('');
  const [loading,    setLoading]    = useState(isEdit);
  const [loadError,  setLoadError]  = useState('');
  const [dragFrom,   setDragFrom]   = useState(null);
  const [dragOver,   setDragOver]   = useState(null);

  // Load existing form
  useEffect(() => {
    if (!isEdit) return;
    api.get(`/forms/${id}`).then(({ data }) => {
      const { fields: dbFields = [], crm_mapping_json, ...rest } = data;
      setMeta({
        name:         rest.name         || '',
        slug:         rest.slug         || '',
        description:  rest.description  || '',
        submit_text:  rest.submit_text  || 'Submit',
        success_msg:  rest.success_msg  || '',
        notify_email: rest.notify_email || '',
        redirect_url: rest.redirect_url || '',
        is_active:    rest.is_active    !== 0,
        honeypot:     rest.honeypot     !== 0,
        crm_action:   rest.crm_action   || 'none',
      });
      setCrmMapping(crm_mapping_json || {});
      setFields(dbFields.map(f => ({
        ...f,
        _id:             genId(),
        options_json:    normalizeOptions(f.options_json),
        show_if_json:    f.show_if_json    || null,
        validation_json: f.validation_json || null,
      })));
    }).catch((e) => {
      setLoadError(e?.response?.status === 404
        ? `Form not found (ID ${id}). The form may have been deleted or this URL is incorrect. Go to /forms to find the correct form.`
        : `Failed to load form: ${e?.response?.data?.error || e.message}`);
    }).finally(() => setLoading(false));
  }, [id, isEdit]);

  // Auto-slug for new forms
  useEffect(() => {
    if (!isEdit) {
      setMeta(m => ({ ...m, slug: m.name.toLowerCase().trim().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') }));
    }
  }, [meta.name, isEdit]); // eslint-disable-line

  const selectedField = fields.find(f => f._id === selectedId) || null;

  const addField = useCallback((type) => {
    const f = makeField(type);
    setFields(prev => [...prev, f]);
    setSelectedId(f._id);
  }, []);

  const updateField = useCallback((updated) => {
    setFields(prev => prev.map(f => f._id === updated._id ? updated : f));
  }, []);

  const removeField = useCallback((fid) => {
    setFields(prev => prev.filter(f => f._id !== fid));
    setSelectedId(null);
  }, []);

  const handleDrop = useCallback(() => {
    if (dragFrom === null || dragOver === null || dragFrom === dragOver) {
      setDragFrom(null); setDragOver(null); return;
    }
    setFields(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragFrom, 1);
      next.splice(dragOver, 0, moved);
      return next;
    });
    setDragFrom(null); setDragOver(null);
  }, [dragFrom, dragOver]);

  const handleCrmChange = useCallback((fieldKey, crmField) => {
    setCrmMapping(prev => {
      const next = { ...prev };
      if (crmField) next[fieldKey] = crmField; else delete next[fieldKey];
      return next;
    });
  }, []);

  async function save() {
    if (!meta.name.trim()) { setSaveMsg('Form name is required'); return; }
    setSaving(true); setSaveMsg('');
    try {
      const payload = {
        ...meta,
        is_active: Boolean(meta.is_active),
        honeypot:  Boolean(meta.honeypot),
        crm_mapping_json: Object.keys(crmMapping).length ? crmMapping : null,
        fields: fields.map((f, idx) => ({
          field_key:       f.field_key,
          label:           f.label,
          field_type:      f.field_type,
          placeholder:     f.placeholder     || null,
          help_text:       f.help_text       || null,
          default_value:   f.default_value   || null,
          col_width:       f.col_width       || 'full',
          options_json:    f.options_json     || null,
          validation_json: f.validation_json  || null,
          is_required:     Boolean(f.is_required),
          sort_order:      idx,
          show_if_json:    f.show_if_json     || null,
        })),
      };
      if (isEdit) {
        await api.put(`/forms/${id}`, payload);
        setSaveMsg('✓ Saved');
      } else {
        const { data } = await api.post('/forms', payload);
        setSaveMsg('✓ Created');
        navigate(`/admin/forms/${data.id}/edit`, { replace: true });
      }
    } catch (e) {
      setSaveMsg(`Error: ${e?.response?.data?.error || e.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  }

  if (loading) return (
    <div className="d-flex justify-content-center align-items-center" style={{ height:'60vh' }}>
      <div className="spinner-border text-primary" />
    </div>
  );

  if (loadError) return (
    <div className="d-flex justify-content-center align-items-center" style={{ height:'60vh' }}>
      <div className="alert alert-danger text-center" style={{ maxWidth: 480 }}>
        <iconify-icon icon="solar:danger-triangle-line-duotone" style={{ fontSize: '2rem' }} />
        <div className="mt-2 fw-semibold">Could not load form</div>
        <div className="mt-1 small">{loadError}</div>
        <a href="/admin/forms" className="btn btn-sm btn-outline-danger mt-3">Back to Forms</a>
      </div>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 64px)', overflow:'hidden', background:'#f4f6f9' }}>

      {/* Top bar */}
      <div style={{ background:'#1a1a2e', color:'#fff', padding:'0 16px', display:'flex', alignItems:'center', gap:14, height:52, flexShrink:0 }}>
        <button onClick={() => navigate('/admin/forms')}
          style={{ background:'rgba(255,255,255,0.15)', border:'none', color:'#fff', borderRadius:4, padding:'4px 12px', cursor:'pointer', fontSize:'0.82rem', display:'flex', alignItems:'center', gap:6 }}>
          <FontAwesomeIcon icon={faArrowLeft} /> Forms
        </button>
        <input value={meta.name} onChange={e => setMeta(m => ({ ...m, name: e.target.value }))}
          style={{ background:'rgba(255,255,255,0.1)', border:'none', borderBottom:'1px solid rgba(255,255,255,0.3)', color:'#fff', padding:'4px 8px', fontSize:'0.95rem', fontWeight:600, flex:1, maxWidth:320, outline:'none' }} />
        <div style={{ display:'flex', gap:0, borderRadius:6, overflow:'hidden', border:'1px solid rgba(255,255,255,0.2)' }}>
          {[['build', faFont, 'Build'],['settings', faGear, 'Settings']].map(([t, ico, lbl]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding:'5px 14px', border:'none', cursor:'pointer', fontSize:'0.82rem', fontWeight:600, display:'flex', alignItems:'center', gap:6,
                background: tab===t ? 'rgba(255,255,255,0.25)' : 'transparent', color:'#fff' }}>
              <FontAwesomeIcon icon={ico} style={{ fontSize:'0.78rem' }} />{lbl}
            </button>
          ))}
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
          {saveMsg && <span style={{ fontSize:'0.8rem', color: saveMsg.startsWith('✓') ? '#6fcf97' : '#ff8080' }}>{saveMsg}</span>}
          <button onClick={save} disabled={saving}
            style={{ background:'#4a2d82', border:'none', color:'#fff', borderRadius:6, padding:'6px 18px', fontWeight:700, fontSize:'0.85rem', cursor:'pointer', display:'flex', alignItems:'center', gap:7 }}>
            <FontAwesomeIcon icon={faFloppyDisk} />
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Form'}
          </button>
        </div>
      </div>

      {/* Build tab */}
      {tab === 'build' && (
        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

          {/* Left: Palette */}
          <div style={{ width:185, background:'#fff', borderRight:'1px solid #e0e0e0', overflowY:'auto', flexShrink:0 }}>
            <div style={{ padding:'10px 12px 4px', fontSize:'0.68rem', fontWeight:700, color:'#aaa', textTransform:'uppercase', letterSpacing:'0.06em' }}>Field Types</div>
            {PALETTE.map(cat => (
              <div key={cat.category}>
                <div style={{ padding:'8px 12px 2px', fontSize:'0.66rem', fontWeight:700, color:'#ccc', textTransform:'uppercase', letterSpacing:'0.05em' }}>{cat.category}</div>
                {cat.items.map(item => (
                  <button key={item.type} onClick={() => addField(item.type)}
                    title={`Add ${item.label}`}
                    style={{ display:'flex', alignItems:'center', gap:9, width:'100%', padding:'7px 12px', border:'none', background:'none', cursor:'pointer', fontSize:'0.82rem', color:'#444', textAlign:'left' }}
                    onMouseEnter={e => e.currentTarget.style.background='#f0eeff'}
                    onMouseLeave={e => e.currentTarget.style.background='none'}>
                    <FontAwesomeIcon icon={item.icon} style={{ width:14, color:'#4a2d82', flexShrink:0 }} />
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Center: Canvas */}
          <div style={{ flex:1, overflowY:'auto', padding:'24px', background:'#f4f6f9' }}
            onClick={() => setSelectedId(null)}>
            <div style={{ maxWidth:640, margin:'0 auto', background:'#fff', borderRadius:10, boxShadow:'0 2px 16px rgba(0,0,0,0.08)', padding:'24px 28px', minHeight:220 }}>
              <h4 style={{ fontWeight:800, marginBottom:4, color:'#1a1a2e' }}>{meta.name}</h4>
              {meta.description && <p style={{ color:'#888', fontSize:'0.88rem', marginBottom:16 }}>{meta.description}</p>}

              {fields.length === 0 && (
                <div style={{ border:'2px dashed #dee2e6', borderRadius:8, padding:'48px 20px', textAlign:'center', color:'#bbb' }}>
                  <div style={{ fontSize:'2.5rem', marginBottom:8 }}>+</div>
                  <div style={{ fontSize:'0.88rem' }}>Click a field type on the left to add it here</div>
                </div>
              )}

              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {fields.map((field, idx) => {
                const isSelected = field._id === selectedId;
                const isDragOver = dragOver === idx;
                const widthMap   = { full:'100%', half:'calc(50% - 4px)', third:'calc(33.33% - 6px)', 'two-thirds':'calc(66.66% - 4px)' };
                const colWidth   = widthMap[field.col_width || 'full'] || '100%';
                return (
                  <div key={field._id}
                    draggable
                    onClick={e => { e.stopPropagation(); setSelectedId(field._id); }}
                    onDragStart={() => setDragFrom(idx)}
                    onDragOver={e => { e.preventDefault(); setDragOver(idx); }}
                    onDragEnd={handleDrop}
                    style={{
                      width: colWidth, boxSizing:'border-box',
                      border: isSelected ? '2px solid #4a2d82' : `2px solid ${isDragOver ? '#b39ddb' : 'transparent'}`,
                      borderRadius:6, padding:'10px 12px', cursor:'pointer',
                      background: isSelected ? '#faf8ff' : isDragOver ? '#f0eeff' : '#fff',
                      position:'relative', transition:'border-color 0.1s',
                      boxShadow: isSelected ? '0 0 0 3px rgba(74,45,130,0.1)' : undefined,
                    }}>
                    <div style={{ position:'absolute', left:4, top:'50%', transform:'translateY(-50%)', opacity:0.3, cursor:'grab', color:'#555' }}>
                      <FontAwesomeIcon icon={faGripVertical} style={{ fontSize:'0.8rem' }} />
                    </div>
                    <div style={{ paddingLeft:16 }}>
                      <FieldPreview field={field} />
                    </div>
                    {isSelected && (
                      <div style={{ position:'absolute', top:4, right:8, fontSize:'0.65rem', color:'#4a2d82', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em', opacity:0.7 }}>
                        {field.col_width && field.col_width !== 'full' ? `${field.col_width} · ` : ''}{field.field_type}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>

              {fields.length > 0 && (
                <div style={{ marginTop:16 }}>
                  <button disabled style={{ background:'#4a2d82', color:'#fff', border:'none', borderRadius:4, padding:'8px 24px', fontWeight:600, fontSize:'0.9rem', opacity:0.75, cursor:'not-allowed' }}>
                    {meta.submit_text || 'Submit'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Properties */}
          <div style={{ width:265, background:'#fff', borderLeft:'1px solid #e0e0e0', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'10px 14px', borderBottom:'1px solid #eee', fontSize:'0.68rem', fontWeight:700, color:'#aaa', textTransform:'uppercase', letterSpacing:'0.05em', flexShrink:0 }}>
              Properties
            </div>
            {selectedField ? (
              <PropertiesPanel
                field={selectedField}
                allFields={fields}
                onChange={updateField}
                onRemove={() => removeField(selectedField._id)}
                crmMapping={crmMapping}
                onCrmChange={handleCrmChange}
              />
            ) : (
              <div style={{ padding:24, color:'#bbb', fontSize:'0.85rem', textAlign:'center' }}>
                <div style={{ fontSize:'2rem', marginBottom:8 }}>←</div>
                Click a field on the canvas to edit its properties
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings tab */}
      {tab === 'settings' && (
        <div style={{ flex:1, overflowY:'auto', background:'#f4f6f9', padding:24 }}>
          <div style={{ maxWidth:640, margin:'0 auto', background:'#fff', borderRadius:10, boxShadow:'0 2px 16px rgba(0,0,0,0.08)' }}>
            <SettingsPanel meta={meta} onChange={setMeta} />
          </div>
        </div>
      )}
    </div>
  );
}
