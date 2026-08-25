import { useNode } from '@craftjs/core';
import { FieldGroup, ImageField, TextField, ToggleField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cx, useDomIdentity, useNodeRef } from './nodeUtils.js';

// Turns a YouTube/Vimeo page URL into its embed URL. Anything else is treated
// as a direct video file.
function parseVideo(url, { autoplay, loop, muted } = {}) {
  const value = String(url || '').trim();
  if (!value) return null;

  const yt = value.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i);
  if (yt) {
    const params = new URLSearchParams({ rel: '0' });
    if (autoplay) { params.set('autoplay', '1'); params.set('mute', '1'); }
    if (loop) { params.set('loop', '1'); params.set('playlist', yt[1]); }
    return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt[1]}?${params}` };
  }

  const vimeo = value.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) {
    const params = new URLSearchParams();
    if (autoplay) { params.set('autoplay', '1'); params.set('muted', '1'); }
    if (loop) params.set('loop', '1');
    return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}?${params}` };
  }

  return { kind: 'file', src: value, autoplay, loop, muted };
}

export default function VideoBlock({ url, poster, autoplay, loop, muted, controls }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('video');
  const video = parseVideo(url, { autoplay, loop, muted });

  return (
    <div ref={ref} id={domId} className={cx('bx-video', customClass)}>
      {!video && <div className="bx-editor-note">Paste a YouTube, Vimeo or video file URL in the settings panel</div>}
      {video?.kind === 'iframe' && (
        <iframe src={video.src} title="Video" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      )}
      {video?.kind === 'file' && (
        <video src={video.src} poster={poster || undefined} controls={controls} autoPlay={autoplay} loop={loop} muted={autoplay || muted} playsInline />
      )}
    </div>
  );
}

function VideoSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Video">
        <TextField
          label="URL"
          value={props.url}
          onChange={p('url')}
          placeholder="https://youtube.com/watch?v=…"
          hint="YouTube and Vimeo links are embedded automatically. Any other URL is treated as a video file."
        />
        <ImageField label="Poster image" value={props.poster} onChange={p('poster')} hint="Shown before a video file starts. Ignored for YouTube and Vimeo." />
      </FieldGroup>
      <FieldGroup title="Playback">
        <ToggleField label="Show controls" value={props.controls} onChange={p('controls')} />
        <ToggleField label="Autoplay" value={props.autoplay} onChange={p('autoplay')} hint="Browsers only allow autoplay when the video is muted." />
        <ToggleField label="Loop" value={props.loop} onChange={p('loop')} />
        <ToggleField label="Muted" value={props.muted} onChange={p('muted')} />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

VideoBlock.craft = {
  displayName: 'Video',
  props: { ...IDENTITY_DEFAULTS, url: '', poster: '', autoplay: false, loop: false, muted: false, controls: true },
  related: { settings: VideoSettings },
};
