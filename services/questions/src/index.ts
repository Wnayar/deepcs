import { createService } from '@deepcs/shared/service';
import { SERVICES } from '@deepcs/shared/services';

const { app, start } = createService({ name: 'questions', port: SERVICES.questions.port });

app.get('/', async () => ({ service: 'questions', phase: 0 }));

await start();
