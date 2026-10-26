import { h, text } from '../../shared/ui';
import { requestLink } from './magicLink';

type Props = { sent?: string; error?: string };

// One email field and a button. Once the link is sent, it says where to look instead of showing the form again.
export function LoginScreen({ sent, error }: Props): string {
  if (sent) {
    return h('main', { class: 'login' },
      h('h1', {}, text('Check your email')),
      h('p', {}, text(`We sent a sign-in link to ${sent}. It works once, for 15 minutes.`)));
  }
  return h('main', { class: 'login' },
    h('h1', {}, text('Pocket Pantry')),
    h('form', { id: 'login' },
      h('input', { type: 'email', name: 'email', placeholder: 'you@example.com', autocomplete: 'email', required: '' }),
      h('button', { type: 'submit' }, text('Email me a link'))),
    error ? h('p', { class: 'error', role: 'alert' }, text(error)) : null);
}

// The form's submit: sends the link, then the screen to show, saying what happened.
export async function submitLogin(email: string): Promise<string> {
  try {
    await requestLink(email);
    return LoginScreen({ sent: email.trim() });
  } catch (e) {
    return LoginScreen({ error: e instanceof Error ? e.message : String(e) });
  }
}
