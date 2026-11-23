import { z } from 'zod';

// Stops zod probing `new Function`; a strict CSP reports that probe even though zod catches it.
z.config({ jitless: true });
