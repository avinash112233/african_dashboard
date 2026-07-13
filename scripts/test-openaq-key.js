import 'dotenv/config';

const key = process.env.OPENAQ_API_KEY?.trim();
if (!key) {
  console.error('OPENAQ_API_KEY is missing from .env');
  process.exit(1);
}

console.log(`Loaded key from .env (${key.length} chars, starts with ${key.slice(0, 4)}…)`);

const res = await fetch('https://api.openaq.org/v3/locations/2178', {
  headers: {
    'X-API-Key': key,
    Accept: 'application/json',
    'User-Agent': 'african-dashboard/1.0',
  },
});

const text = await res.text();
let detail = text.slice(0, 200);
try {
  const json = JSON.parse(text);
  detail = json.detail ?? json.message ?? detail;
} catch {
  /* keep raw snippet */
}

console.log(`OpenAQ response: HTTP ${res.status}`);
console.log(typeof detail === 'string' ? detail : JSON.stringify(detail));

if (res.ok) {
  console.log('OK — your API key works. Restart npm run backend if it is already running.');
  process.exit(0);
}

console.error('FAILED — OpenAQ rejected this key.');
console.error('1. Sign in at https://explore.openaq.org/account');
console.error('2. Click Regenerate API key and copy the new value immediately');
console.error('3. Set OPENAQ_API_KEY=... in .env (no quotes, one line)');
console.error('4. Run npm run test:openaq again until you see HTTP 200');
process.exit(1);

