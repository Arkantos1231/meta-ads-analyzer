/**
 * login.js — login form logic
 */

import { t, applyI18n } from './i18n.js';

applyI18n();

const form       = document.getElementById('loginForm');
const loginBtn   = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginBtn.disabled    = true;
  loginBtn.textContent = t('signing_in');
  loginError.classList.add('hidden');
  loginError.textContent = '';

  try {
    const res = await fetch('/auth/login', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      loginError.textContent = json.error || t('login_failed');
      loginError.classList.remove('hidden');
    } else {
      window.location.href = '/';
    }
  } catch (err) {
    loginError.textContent = t('network_error');
    loginError.classList.remove('hidden');
  } finally {
    loginBtn.disabled    = false;
    loginBtn.textContent = t('btn_sign_in');
  }
});
