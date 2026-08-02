import { createService } from '@deepcs/shared/service';
import { SERVICES } from '@deepcs/shared/services';

const { app, start } = createService({ name: 'collab', port: SERVICES.collab.port });

app.get('/', async () => ({ service: 'collab', phase: 0 }));

await start();
