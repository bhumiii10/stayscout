// Vercel serverless function → lib/routes.js
import { city } from '../lib/routes.js';

export const config = { maxDuration: 60 };
export default city;
