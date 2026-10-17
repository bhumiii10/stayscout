// Vercel serverless function → lib/routes.js
import { stay } from '../lib/routes.js';

export const config = { maxDuration: 60 };
export default stay;
