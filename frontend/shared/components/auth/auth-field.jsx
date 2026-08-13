'use client';

import { useState } from 'react';
import { AuthIcon } from './auth-icons.jsx';

export default function AuthField({
  icon,
  id,
  label,
  type = 'text',
  peek = false,
  bad = false,
  readOnly = false,
  describedBy,
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  ...rest
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && peek && show ? 'text' : type;
  const cls = 'field' + (bad ? ' bad' : '') + (readOnly ? ' readonly' : '');

  return (
    <div className={cls}>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="field-row">
        <AuthIcon name={icon} />
        <input
          className="input-field"
          id={id}
          type={inputType}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          aria-invalid={bad || undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {peek && isPassword && (
          <button
            type="button"
            className="peek"
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            onClick={() => setShow((v) => !v)}
          >
            <AuthIcon name={show ? 'eyeoff' : 'eye'} className="" />
          </button>
        )}
      </div>
    </div>
  );
}
