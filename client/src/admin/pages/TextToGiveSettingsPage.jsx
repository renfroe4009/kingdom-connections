import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

// Text to Give lives under Fundraising (not the general Settings > Twilio/SMS
// tab) since it's a fundraising-configured behavior, not a communications
// setting — but it still reads/writes the same sms_settings row those
// Twilio fields live on. We fetch and re-submit the full object so this
// page's Save never clobbers the Account SID / Auth Token / From Number
// configured over in Settings.
export default function TextToGiveSettingsPage() {
  const [sms, setSms] = useState({
    provider: 'dryrun', account_sid: '', api_key_sid: '', auth_token: '', from_number: '', is_active: true,
    text_to_give_enabled: false, text_to_give_keyword: 'GIVE', text_to_give_landing_path: '',
    text_to_give_reply_template: '', text_to_give_help_template: '',
  });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/settings/sms').then((r) => r.data && setSms((s) => ({ ...s, ...r.data, is_active: !!r.data.is_active }))).catch(() => {});
  }, []);

  async function save() {
    setMsg('');
    try {
      await api.put('/settings/sms', sms);
      setMsg('Text to Give settings saved.');
    } catch (e) { setMsg(e.response?.data?.error || 'Failed to save.'); }
  }

  const twilioReady = sms.provider === 'twilio' && sms.account_sid && sms.from_number;

  return (
    <div>
      <PageHeader title="Text to Give" subtitle="Let donors text a keyword to give — each fund/campaign gets its own keyword, set on its edit form under Funds & Campaigns." />

      <div className="card">
        <div className="card-body">
          {!twilioReady && (
            <div className="alert alert-warning d-flex align-items-center gap-2">
              <iconify-icon icon="solar:danger-triangle-line-duotone"></iconify-icon>
              Twilio isn't configured yet — Text to Give won't send or receive anything until it is.
              Set it up in <a href="/admin/settings?tab=sms">Settings → Twilio / SMS</a>.
            </div>
          )}

          {msg && (
            <div className={`alert ${msg.includes('saved') ? 'alert-success' : 'alert-info'} d-flex align-items-center gap-2`}>
              <iconify-icon icon={msg.includes('saved') ? 'solar:check-circle-line-duotone' : 'solar:info-circle-line-duotone'}></iconify-icon>
              {msg}
            </div>
          )}

          <p className="text-muted small mb-3">
            Donors text a keyword to your Twilio number (e.g. "GIVE SCHOLARSHIP", or bare "GIVE" for
            the general fund) and get back a link to complete their gift on the site. Each fund/campaign
            gets its own keyword — set it on the fund's edit form under Funds &amp; Campaigns.
          </p>

          <div className="form-check mb-3">
            <input type="checkbox" className="form-check-input" id="ttgEnabled"
              checked={!!sms.text_to_give_enabled} onChange={(e) => setSms({ ...sms, text_to_give_enabled: e.target.checked })} />
            <label className="form-check-label" htmlFor="ttgEnabled">Enable Text to Give</label>
          </div>

          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Trigger keyword</label>
              <input className="form-control" value={sms.text_to_give_keyword || ''} placeholder="GIVE"
                onChange={(e) => setSms({ ...sms, text_to_give_keyword: e.target.value.toUpperCase() })} />
              <div className="form-text">The word donors text first — "{sms.text_to_give_keyword || 'GIVE'} SCHOLARSHIP" or bare "{sms.text_to_give_keyword || 'GIVE'}".</div>
            </div>
            <div className="col-md-8">
              <label className="form-label">Donation page path</label>
              <input className="form-control" value={sms.text_to_give_landing_path || ''} placeholder="/donate"
                onChange={(e) => setSms({ ...sms, text_to_give_landing_path: e.target.value })} />
              <div className="form-text">Site-relative path to the page carrying your Donation Card block.</div>
            </div>
            <div className="col-12">
              <label className="form-label">Reply message (fund recognized)</label>
              <textarea className="form-control" rows="2" value={sms.text_to_give_reply_template || ''}
                onChange={(e) => setSms({ ...sms, text_to_give_reply_template: e.target.value })}
                placeholder='Thank you for supporting {{business.name}}! Complete your gift to {{fund.name}} here: {{link}} Reply STOP to opt out.' />
              <div className="form-text">Merge fields: <code>{'{{business.name}}'}</code>, <code>{'{{fund.name}}'}</code>, <code>{'{{link}}'}</code>, <code>{'{{contact.first_name}}'}</code>.</div>
            </div>
            <div className="col-12">
              <label className="form-label">Reply message (keyword not recognized)</label>
              <textarea className="form-control" rows="2" value={sms.text_to_give_help_template || ''}
                onChange={(e) => setSms({ ...sms, text_to_give_help_template: e.target.value })}
                placeholder="We didn't recognize that fund keyword. Text GIVE on its own to give to our general fund." />
            </div>
          </div>

          <div className="mt-3">
            <button className="btn btn-primary" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
