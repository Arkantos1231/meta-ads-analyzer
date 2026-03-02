/**
 * login.js — login form logic
 */

const form       = document.getElementById('loginForm');
const loginBtn   = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginBtn.disabled    = true;
  loginBtn.textContent = 'Signing in\u2026';
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
      loginError.textContent = json.error || 'Login failed. Check your username and password.';
      loginError.classList.remove('hidden');
    } else {
      window.location.href = '/';
    }
  } catch (err) {
    loginError.textContent = 'Network error — is the server running?';
    loginError.classList.remove('hidden');
  } finally {
    loginBtn.disabled    = false;
    loginBtn.textContent = 'Sign in';
  }
});
