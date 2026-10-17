// Vercel serverless function → lib/routes.js
import { info } from '../lib/routes.js';

export const config = { maxDuration: 60 };
export default info;
