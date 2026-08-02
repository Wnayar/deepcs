import { createService } from '@deepcs/shared/service';
import { SERVICES } from '@deepcs/shared/services';

const { app, start } = createService({ name: 'gateway', port: SERVICES.gateway.port });

app.get('/', async () => ({ service: 'gateway', phase: 0 }));

await start();
