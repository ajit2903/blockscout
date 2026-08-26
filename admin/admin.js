
'use strict';

const login = document.querySelector('#login');
const panel = document.querySelector('#panel');
const loginError = document.querySelector('#loginError');
const api = '/api/admin';

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

function showPanel() {
  login.hidden = true;
  panel.hidden = false;
}

function showLogin() {
  login.hidden = false;
  panel.hidden = true;
}

document.querySelector('#logout').addEventListener('click', async () => {
  try {
    await request(`${api}/logout`, {
      method: 'POST'
    });
  } finally {
    window.location.replace('/admin/login.html');
  }
});

async function refreshDashboard() {
  try {
    const data = await request(`${api}/dashboard`);

    document.querySelector('#rpcStatus').textContent = data.rpc.ok
      ? 'ONLINE'
      : 'OFFLINE';

    document.querySelector('#latency').textContent =
      `${data.rpc.latencyMs} ms`;

    document.querySelector('#chainId').textContent =
      data.network.chainId;

    document.querySelector('#latestBlock').textContent =
      data.network.latestBlock.toLocaleString();

    document.querySelector('#client').textContent =
      data.network.clientVersion;

    document.querySelector('#syncing').textContent =
      typeof data.network.syncing === 'object'
        ? JSON.stringify(data.network.syncing)
        : 'No';

    showPanel();
  } catch (error) {
    if (error.message === 'Authentication required') {
      window.location.replace('/admin/login.html');
      return;
    }

    document.querySelector('#rpcStatus').textContent = 'ERROR';
  }
}

document
  .querySelector('#refresh')
  .addEventListener('click', refreshDashboard);

document
  .querySelector('#blockForm')
  .addEventListener('submit', async event => {
    event.preventDefault();

    const result = document.querySelector('#blockResult');

    try {
      const block = await request(`${api}/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          number: document.querySelector('#blockNumber').value
        })
      });

      result.textContent = JSON.stringify(block, null, 2);
    } catch (error) {
      if (error.message === 'Authentication required') {
        window.location.replace('/admin/login.html');
        return;
      }

      result.textContent = error.message;
    }
  });

document
  .querySelector('#transactionForm')
  .addEventListener('submit', async event => {
    event.preventDefault();

    const result = document.querySelector('#transactionResult');

    try {
      const transaction = await request(`${api}/transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          hash: document
            .querySelector('#transactionHash')
            .value
            .trim()
        })
      });

      result.textContent = JSON.stringify(transaction, null, 2);
    } catch (error) {
      if (error.message === 'Authentication required') {
        window.location.replace('/admin/login.html');
        return;
      }

      result.textContent = error.message;
    }
  });

const authError = new URLSearchParams(
  window.location.search
).get('auth');

if (authError === 'denied') {
  loginError.textContent =
    'This GitHub account is not an approved admin.';
} else if (authError === 'failed') {
  loginError.textContent =
    'GitHub sign-in failed. Please try again.';
}

refreshDashboard();
