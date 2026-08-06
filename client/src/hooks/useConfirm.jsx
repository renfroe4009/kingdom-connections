// =============================================================================
// useConfirm() / usePrompt() — drop-in replacements for window.confirm() /
// window.prompt() that render an in-app ConfirmDialog instead of a native
// browser dialog (which can't be styled, blocks the whole tab, and reads as
// untrustworthy/dated).
//
// Usage mirrors the native functions as closely as possible so replacing a
// call site is a small diff:
//
//   const { confirm, dialog } = useConfirm();
//   ...
//   async function remove(o) {
//     if (!(await confirm(`Delete ${o.name}? This cannot be undone.`))) return;
//     await api.delete(`/things/${o.id}`);
//   }
//   ...
//   return <div>...{dialog}</div>;
//
// Render {dialog} once anywhere in the component's JSX tree (it renders
// nothing when not open).
// =============================================================================
import { useCallback, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

export function useConfirm() {
  const [state, setState] = useState(null); // { message, title, danger, confirmLabel, resolve }

  const confirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setState({
        message,
        title: opts.title,
        danger: opts.danger !== false,
        confirmLabel: opts.confirmLabel,
        resolve,
      });
    });
  }, []);

  function settle(result) {
    state?.resolve(result);
    setState(null);
  }

  const dialog = (
    <ConfirmDialog
      show={!!state}
      title={state?.title || (state?.danger === false ? 'Confirm' : 'Delete?')}
      message={state?.message}
      danger={state?.danger}
      confirmLabel={state?.confirmLabel || (state?.danger === false ? 'Confirm' : 'Delete')}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, dialog };
}

export function usePrompt() {
  const [state, setState] = useState(null); // { message, title, placeholder, required, resolve }
  const [value, setValue] = useState('');

  const prompt = useCallback((message, opts = {}) => {
    setValue(opts.defaultValue || '');
    return new Promise((resolve) => {
      setState({
        message,
        title: opts.title || 'Enter a value',
        placeholder: opts.placeholder,
        required: !!opts.required,
        resolve,
      });
    });
  }, []);

  function settle(confirmed) {
    state?.resolve(confirmed ? value : null);
    setState(null);
  }

  const dialog = (
    <ConfirmDialog
      show={!!state}
      title={state?.title}
      message={state?.message}
      danger={false}
      confirmLabel="OK"
      input={{ placeholder: state?.placeholder, required: state?.required }}
      inputValue={value}
      onInputChange={setValue}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { prompt, dialog };
}
