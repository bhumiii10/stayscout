// Vercel serverless function → lib/routes.js
import { trip } from '../lib/routes.js';

export const config = { maxDuration: 60 };
export default trip;
