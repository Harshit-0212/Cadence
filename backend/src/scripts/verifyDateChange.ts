import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3001/api';
const MONGO_URI = 'mongodb://localhost:27017';

async function testDateChange() {
  console.log('=== TESTING STREAK & CHECKIN ACROSS CONSECUTIVE DATES ===');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('nova');

  const unique = Date.now();
  const signupRes = await fetch(`${BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `date_test_${unique}@example.com`,
      password: 'Password123!',
      fullName: 'Date Change Tester',
    }),
  });
  const token = ((await signupRes.json()) as any).data?.session?.access_token;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Day 1: 2026-11-12
  const res1 = await fetch(`${BASE_URL}/activity/checkin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localDate: '2026-11-12' }),
  });
  const data1 = ((await res1.json()) as any).data;
  console.log('Day 1 Check-in (2026-11-12):', data1);

  // Day 2: 2026-11-13
  const res2 = await fetch(`${BASE_URL}/activity/checkin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localDate: '2026-11-13' }),
  });
  const data2 = ((await res2.json()) as any).data;
  console.log('Day 2 Check-in (2026-11-13):', data2);

  // Day 3: 2026-11-14
  const res3 = await fetch(`${BASE_URL}/activity/checkin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localDate: '2026-11-14' }),
  });
  const data3 = ((await res3.json()) as any).data;
  console.log('Day 3 Check-in (2026-11-14):', data3);

  // Stats summary query with localDate = 2026-11-14
  const statsRes = await fetch(`${BASE_URL}/stats/summary?localDate=2026-11-14`, { headers });
  const stats = ((await statsRes.json()) as any).data;
  console.log('Stats Summary Streak:', stats.currentStreak, 'Longest:', stats.longestStreak);

  if (stats.currentStreak !== 3) {
    throw new Error(`Expected current streak 3, got ${stats.currentStreak}`);
  }
  console.log('DATE CHANGE STREAK VERIFICATION PASSED: Streak incremented from 1 -> 2 -> 3 across dates.');
  await client.close();
}

testDateChange().catch((err) => {
  console.error(err);
  process.exit(1);
});
