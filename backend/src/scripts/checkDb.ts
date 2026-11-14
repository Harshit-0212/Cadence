import { getDb } from '../lib/db.js';

async function main() {
  const db = await getDb();
  const users = await db.collection('users').find({}).toArray();
  console.log('Users found:', users.length);
  for (const u of users) {
    console.log(`User: ${u._id} | email: ${u.email} | name: ${u.name} | tz: ${u.timezone} | createdAt: ${u.createdAt}`);
    const events = await db.collection('activity_events').find({ userId: String(u._id) }).toArray();
    console.log(`  activity_events count: ${events.length}`);
    for (const ev of events) {
      console.log(`    [${ev.type}] dateKey: ${ev.dateKey} points: ${ev.points} eventKey: ${ev.eventKey} meta: ${JSON.stringify(ev.meta)}`);
    }
    const assessments = await db.collection('assessment_results').find({ userId: String(u._id) }).toArray();
    console.log(`  assessment_results count: ${assessments.length}`);
    for (const a of assessments) {
      console.log(`    assessment id: ${a.id || a._id} takenAt: ${a.takenAt} testId: ${a.testId} score: ${a.scorePercent}`);
    }
    const interviews = await db.collection('interview_reports').find({ userId: String(u._id) }).toArray();
    console.log(`  interview_reports count: ${interviews.length}`);
    for (const i of interviews) {
      console.log(`    interview id: ${i.id} _id: ${i._id} createdAt: ${i.createdAt} overallScore: ${i.overallScore}`);
    }
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
