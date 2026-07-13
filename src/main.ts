import { Actor, log } from 'apify';

await Actor.init();
log.info('npm Supply Chain Risk Scanner initialized');
await Actor.exit();
