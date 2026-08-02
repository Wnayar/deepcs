import { createService } from '@deepcs/shared/service';
import { SERVICES } from '@deepcs/shared/services';

const { app, start } = createService({ name: 'users', port: SERVICES.users.port });

app.get('/', async () => ({ service: 'users', phase: 0 }));

await start();
