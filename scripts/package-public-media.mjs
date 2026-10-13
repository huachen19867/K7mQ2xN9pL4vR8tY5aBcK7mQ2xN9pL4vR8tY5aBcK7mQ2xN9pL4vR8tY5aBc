import fs from 'node:fs/promises';
const snapshot=JSON.parse(await fs.readFile('leaves.json','utf8'));
const media=new Set();
for(const record of snapshot.records){for(const item of record.details.proofs||[])media.add(item.url);for(const approval of Object.values(record.approvals||{}))if(approval.signature)media.add(approval.signature.url);}
for(const file of media){if(!/^assets\/uploads\/[a-f0-9]{64}\.(png|jpg|webp|pdf)$/.test(file))throw Error('Invalid public media path');await fs.mkdir('_site/assets/uploads',{recursive:true});await fs.copyFile(file,'_site/'+file);}
