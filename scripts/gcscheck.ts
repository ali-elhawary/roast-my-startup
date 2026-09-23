import 'dotenv/config';
import {
  isGcsEnabled,
  uploadBuffer,
  signedReadUrl,
  deleteObject,
} from '../server/storage';

async function main() {
  if (!isGcsEnabled()) {
    console.error('GCS not enabled (set GCS_BUCKET).');
    process.exit(1);
  }
  console.log('bucket:', process.env.GCS_BUCKET);
  console.log('impersonate:', process.env.GCS_IMPERSONATE_SA || '(none — plain ADC)');

  const key = `gcscheck/${Date.now()}.txt`;
  const body = Buffer.from('roast-my-startup gcs check\n', 'utf8');

  console.log('\n1) upload...');
  await uploadBuffer(key, body, 'text/plain');
  console.log('   uploaded', key);

  console.log('2) signed READ url...');
  const readUrl = await signedReadUrl(key);
  const r = await fetch(readUrl);
  const text = await r.text();
  console.log('   GET', r.status, '| body matches:', text === body.toString());

  console.log('3) signed DOWNLOAD url (content-disposition=attachment)...');
  const dlUrl = await signedReadUrl(key, { downloadFilename: 'roast-my-startup.txt' });
  const d = await fetch(dlUrl);
  const disp = d.headers.get('content-disposition');
  console.log('   GET', d.status, '| content-disposition:', disp);

  console.log('4) delete...');
  await deleteObject(key);
  const gone = await fetch(readUrl);
  console.log('   after delete, GET signed url ->', gone.status, '(expected 4xx)');

  const ok =
    r.status === 200 &&
    text === body.toString() &&
    d.status === 200 &&
    !!disp &&
    disp.includes('attachment') &&
    gone.status >= 400;
  console.log(ok ? '\nGCS CHECK OK' : '\nGCS CHECK FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('GCS CHECK ERROR:', e?.message || e);
  process.exit(1);
});
