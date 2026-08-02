import { createService } from '@deepcs/shared/service';
import { SERVICES } from '@deepcs/shared/services';

const { app, start } = createService({ name: 'matching', port: SERVICES.matching.port });

app.get('/', async () => ({ service: 'matching', phase: 0 }));

await start();
