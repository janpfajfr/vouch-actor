import { Actor, log } from 'apify';

import { queryOsvBatch } from './osv-client.js';
import { createRegistryClient } from './registry.js';
import { fetchPublicUrl } from './remote.js';
import { runActor } from './run.js';

const registry = createRegistryClient({
    warn: (message) => log.warning(message),
});

await runActor({
    init: async () => Actor.init(),
    getInput: async () => Actor.getInput(),
    pushData: async (items) => Actor.pushData(items),
    setStatusMessage: async (message) => { await Actor.setStatusMessage(message); },
    exit: async (message) => Actor.exit(message),
    fail: async (message) => Actor.fail(message),
}, {
    registry,
    fetchRemote: async (url) => fetchPublicUrl(url),
    queryOsv: async (targets) => queryOsvBatch(targets),
});
