#!/usr/bin/env node

/**
 * OpenClaw-style PR approval monitor
 *
 * Watches for auto-fix PRs opened by Claude Code, waits for all CI checks
 * to pass, then calls your phone via Twilio to ask if you want to merge.
 *
 * Usage:
 *   GITHUB_TOKEN=xxx \
 *   GITHUB_OWNER=your-org \
 *   GITHUB_REPO=selfhealing \
 *   TWILIO_ACCOUNT_SID=ACxxx \
 *   TWILIO_AUTH_TOKEN=xxx \
 *   TWILIO_FROM_NUMBER=+1xxxxxxxxxx \
 *   PHONE_NUMBER=+1xxxxxxxxxx \
 *   node scripts/openclaw-monitor.js
 *
 * Press 1 to approve merge, 2 to keep open, 3 to close PR.
 */

const https = require('https');

const config = {
  github: {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo:  process.env.GITHUB_REPO,
  },
  twilio: {
    accountSid:  process.env.TWILIO_ACCOUNT_SID,
    authToken:   process.env.TWILIO_AUTH_TOKEN,
    fromNumber:  process.env.TWILIO_FROM_NUMBER,
  },
  phone:         process.env.PHONE_NUMBER,
  checkInterval: 120_000, // 2 minutes
};

const processedPRs = new Set();

// ─── GitHub helpers ────────────────────────────────────────────────────────

function githubRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${config.github.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'openclaw-monitor/1.0',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function listOpenPRs() {
  return githubRequest(`/repos/${config.github.owner}/${config.github.repo}/pulls?state=open`);
}

async function getChecks(ref) {
  return githubRequest(`/repos/${config.github.owner}/${config.github.repo}/commits/${ref}/check-runs`);
}

async function mergePR(prNumber, title) {
  return githubRequest(
    `/repos/${config.github.owner}/${config.github.repo}/pulls/${prNumber}/merge`,
    'PUT',
    { commit_title: `${title} (auto-merged via OpenClaw)`, merge_method: 'squash' }
  );
}

async function closePR(prNumber) {
  return githubRequest(
    `/repos/${config.github.owner}/${config.github.repo}/pulls/${prNumber}`,
    'PATCH',
    { state: 'closed' }
  );
}

async function commentOnPR(prNumber, body) {
  return githubRequest(
    `/repos/${config.github.owner}/${config.github.repo}/issues/${prNumber}/comments`,
    'POST',
    { body }
  );
}

// ─── Twilio helpers ────────────────────────────────────────────────────────

function twilioRequest(path, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const auth  = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
    const options = {
      hostname: 'api.twilio.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Make a Twilio call using TwiML that reads the PR details and
 * accepts a keypress to approve, skip, or close.
 *
 * After pressing a key, Twilio posts back to your server. For a local
 * demo, run `npx localtunnel --port 3001` and set WEBHOOK_BASE_URL.
 */
async function makeApprovalCall(pr, previewUrl) {
  const webhookBase = process.env.WEBHOOK_BASE_URL || 'https://your-tunnel.loca.lt';

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">
    Hello! This is your self-healing Laravel app.
    I fixed a bug automatically.
    Pull request number ${pr.number}: ${pr.title.replace(/[<>]/g, '')}.
    ${previewUrl ? `A preview environment is ready at: ${previewUrl}.` : ''}
    All tests have passed.
    Press 1 to approve and merge to production.
    Press 2 to keep the pull request open for manual review.
    Press 3 to close the pull request without merging.
  </Say>
  <Gather numDigits="1" action="${webhookBase}/voice-response?pr=${pr.number}" method="POST">
    <Say voice="Polly.Joanna">Waiting for your input.</Say>
  </Gather>
</Response>`;

  // Host the TwiML inline via Twilio's TwiML Bins or a tiny express server.
  // For simplicity here we use Twilio's twiml parameter directly.
  return twilioRequest(
    `/2010-04-01/Accounts/${config.twilio.accountSid}/Calls.json`,
    {
      To:    config.phone,
      From:  config.twilio.fromNumber,
      Twiml: twiml,
    }
  );
}

// ─── Main loop ─────────────────────────────────────────────────────────────

async function checkPRs() {
  console.log(`[${new Date().toISOString()}] Checking for auto-fix PRs...`);

  const prs = await listOpenPRs();
  if (!Array.isArray(prs)) return;

  for (const pr of prs) {
    const isAutoFix = pr.title.includes('Auto-Fix') || pr.title.includes('🔧') || pr.head.ref.startsWith('fix/auto-nightwatch-');
    if (!isAutoFix || processedPRs.has(pr.number)) continue;

    console.log(`  Found auto-fix PR #${pr.number}: ${pr.title}`);

    const { check_runs: runs = [] } = await getChecks(pr.head.sha);
    const allDone   = runs.every(r => r.status === 'completed');
    const allPassed = runs.every(r => r.conclusion === 'success' || r.conclusion === 'skipped');

    if (!allDone) { console.log(`  PR #${pr.number}: checks still running`); continue; }
    if (!allPassed) { console.log(`  PR #${pr.number}: checks failed — skipping`); continue; }

    const previewMatch = pr.body?.match(/https:\/\/[^\s)]+\.laravel\.cloud[^\s)]*/);
    const previewUrl   = previewMatch ? previewMatch[0] : null;

    console.log(`  PR #${pr.number}: all checks passed — calling ${config.phone}`);

    if (config.twilio.accountSid && config.twilio.accountSid !== 'ACxxx') {
      await makeApprovalCall(pr, previewUrl);
      await commentOnPR(pr.number, `🤖 **OpenClaw**: Calling ${config.phone} for merge approval. All tests passed.${previewUrl ? `\n\n🔗 Preview: ${previewUrl}` : ''}`);
    } else {
      console.log('  [DEMO MODE] Twilio not configured — posting comment instead of calling.');
      await commentOnPR(pr.number, `🤖 **OpenClaw (demo mode)**: Would call ${config.phone || 'your phone'} now.\n\nPR #${pr.number} is ready to merge. All tests passed.${previewUrl ? `\n\n🔗 Preview: ${previewUrl}` : ''}`);
    }

    processedPRs.add(pr.number);
  }
}

// ─── Tiny webhook server for Twilio keypress response ──────────────────────

function startWebhookServer() {
  const port = process.env.WEBHOOK_PORT || 3001;
  require('http').createServer(async (req, res) => {
    if (req.method !== 'POST') { res.end(); return; }
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      const params   = new URLSearchParams(body);
      const digit    = params.get('Digits');
      const prNumber = new URL(req.url, 'http://localhost').searchParams.get('pr');

      let twiml = '';
      if (digit === '1') {
        const pr = await githubRequest(`/repos/${config.github.owner}/${config.github.repo}/pulls/${prNumber}`);
        await mergePR(prNumber, pr.title);
        twiml = '<Response><Say voice="Polly.Joanna">Approved! Merging to production now. Goodbye!</Say></Response>';
        console.log(`  ✅ PR #${prNumber} merged by voice approval`);
      } else if (digit === '3') {
        await closePR(prNumber);
        twiml = '<Response><Say voice="Polly.Joanna">Pull request closed. Goodbye!</Say></Response>';
        console.log(`  ❌ PR #${prNumber} closed by voice`);
      } else {
        twiml = '<Response><Say voice="Polly.Joanna">Keeping the pull request open for manual review. Goodbye!</Say></Response>';
        console.log(`  ⏸️  PR #${prNumber} kept open`);
      }

      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(twiml);
    });
  }).listen(port, () => console.log(`Webhook server listening on port ${port}`));
}

// ─── Start ─────────────────────────────────────────────────────────────────

console.log('🤖 OpenClaw PR Monitor started');
console.log(`   Repo:     ${config.github.owner}/${config.github.repo}`);
console.log(`   Phone:    ${config.phone || '(not set)'}`);
console.log(`   Twilio:   ${config.twilio.accountSid ? 'configured' : 'DEMO MODE (no Twilio)'}`);
console.log(`   Interval: ${config.checkInterval / 1000}s\n`);

startWebhookServer();
checkPRs();
setInterval(checkPRs, config.checkInterval);
process.on('SIGINT', () => { console.log('\n👋 Stopped'); process.exit(0); });
