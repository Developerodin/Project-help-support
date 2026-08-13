const ASIDE = {
  signin: [
    [
      'The error is deliberately vague',
      "Sign-in never reveals whether an address exists. A wrong password and an unknown address return the same message and the same response time, so the form can't be used to find out who works here.",
    ],
    [
      'Accounts are invite-only',
      'There is no sign-up. An admin invites you, the link lasts 72 hours, and accepting it is where you set your password.',
    ],
  ],
  invite: [
    [
      'What you can do as a Developer',
      "File tickets, work the ones assigned to you, and move those through Local and Ready for QA. Stage moves on other people's tickets stay visible and disabled, with the reason attached.",
    ],
    [
      'Your role can change',
      'An admin changes it from the People page. Nothing you filed or worked on moves with it.',
    ],
  ],
  reset: [
    [
      'One link, one hour',
      'A reset link works once and expires after an hour. Using it signs out every other session, which is the point: if someone else had the password, they lose it here.',
    ],
    [
      'Still locked out?',
      'Any admin can send a fresh invite from the People page. That is faster than waiting for a second reset mail.',
    ],
  ],
  sent: [
    [
      'Why it does not say more',
      'Every path through this form returns the same message and takes about the same time, whether or not the address is real.',
    ],
    [
      'Nothing has changed yet',
      'Your current password still works until the link is used.',
    ],
  ],
  expired: [
    [
      'Links expire on purpose',
      '72 hours for an invite, one hour for a reset. Long enough to act on, short enough that a forwarded mail is not a standing key.',
    ],
    [
      'Who can send a new one',
      'Any admin, from the People page. The old link stops working the moment a new one is made.',
    ],
  ],
};

export function AuthBrand() {
  return (
    <div className="brand">
      <span className="mark" aria-hidden="true">
        <span /><span /><span />
      </span>
      <b>Pipeline</b>
    </div>
  );
}

export function AuthAside({ view = 'signin' }) {
  const copy = ASIDE[view] || ASIDE.signin;
  return (
    <div className="auth-aside">
      {copy.map(([title, body]) => (
        <div key={title}>
          <span className="lbl">{title}</span>
          <p>{body}</p>
        </div>
      ))}
    </div>
  );
}

/** Two-column auth surface: card column + aside. */
export default function AuthFrame({ view = 'signin', children }) {
  return (
    <div className="auth">
      <div className="auth-form">{children}</div>
      <AuthAside view={view} />
    </div>
  );
}
